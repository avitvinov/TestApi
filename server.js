'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const docs = require('./docs');

const PORT = Number(process.env.PORT) || 3000;
const SIGN_SECRET = process.env.SIGN_SECRET || 'junior-qa-secret-2026';
const MAX_CLOCK_SKEW_SEC = 300;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let db;

function seed() {
  db = {
    categories: [
      { id: 1, name: 'Электроника' },
      { id: 2, name: 'Бытовая техника' },
      { id: 3, name: 'Аксессуары' },
    ],
    products: [
      { id: 1, name: 'Смартфон Alpha', category_id: 1, price: 29990 },
      { id: 2, name: 'Ноутбук Beta', category_id: 1, price: 74990 },
      { id: 3, name: 'Планшет Gamma', category_id: 1, price: 39990 },
      { id: 4, name: 'Чайник Delta', category_id: 2, price: 2990 },
      { id: 5, name: 'Пылесос Epsilon', category_id: 2, price: 15990 },
      { id: 6, name: 'Микроволновка Zeta', category_id: 2, price: 8990 },
      { id: 7, name: 'Чехол Eta', category_id: 3, price: 990 },
      { id: 8, name: 'Кабель USB-C Theta', category_id: 3, price: 590 },
      { id: 9, name: 'Зарядка Iota', category_id: 3, price: 1990 },
    ],
    warehouses: [
      { id: 1, name: 'Москва' },
      { id: 2, name: 'Санкт-Петербург' },
    ],
    stock: [
      [1, 1, 15], [2, 1, 5], [1, 2, 3], [2, 2, 0], [1, 3, 8], [1, 4, 40], [2, 4, 25],
      [1, 5, 6], [2, 6, 12], [1, 7, 200], [2, 7, 150], [1, 8, 15], [1, 9, 4], [2, 9, 2],
    ].map(([warehouse_id, product_id, qty]) => ({ warehouse_id, product_id, qty })),
    sales: [
      ['2026-09-05', 1, 1, 2, 29990], ['2026-09-12', 2, 1, 1, 74990],
      ['2026-09-15', 3, 1, 1, 39990], ['2026-09-20', 4, 2, 5, 2990],
      ['2026-09-25', 7, 1, 10, 990], ['2026-10-02', 1, 1, 1, 29990],
      ['2026-10-03', 1, 2, 2, 27990], ['2026-10-05', 2, 1, 1, 72990],
      ['2026-10-07', 4, 1, 8, 2990], ['2026-10-10', 5, 1, 2, 15990],
      ['2026-10-12', 7, 1, 25, 990], ['2026-10-12', 8, 1, 40, 590],
      ['2026-10-15', 9, 1, 3, 1990], ['2026-10-18', 9, 2, 2, 1990],
      ['2026-10-20', 1, 1, 3, 29990], ['2026-10-22', 5, 1, 1, 14990],
      ['2026-10-25', 7, 2, 30, 890], ['2026-10-28', 8, 1, 35, 590],
      ['2026-10-30', 4, 2, 6, 2990],
    ].map(([sale_date, product_id, warehouse_id, qty, price], i) => (
      { id: i + 1, sale_date, product_id, warehouse_id, qty, price }
    )),
  };
  db.nextProductId = db.products.length + 1;
  db.nextSaleId = db.sales.length + 1;
}

// ---------- helpers ----------

function send(res, status, body) {
  if (body === undefined) {
    res.writeHead(status);
    return res.end();
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return reject(new ApiError(400, 'Некорректный JSON'));
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return reject(new ApiError(400, 'Тело запроса должно быть JSON-объектом'));
      }
      resolve(parsed);
    });
    req.on('error', reject);
  });
}

const isPosInt = (v) => Number.isInteger(v) && v > 0;
const hasTwoDecimals = (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
const round2 = (n) => Math.round(n * 100) / 100;

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function checkDate(v, name) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new ApiError(400, `${name}: дата в формате YYYY-MM-DD`);
  }
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw new ApiError(400, `${name}: несуществующая дата`);
  }
  return v;
}

function queryInt(query, name) {
  const v = query.get(name);
  if (v === null) return undefined;
  if (!/^\d+$/.test(v) || Number(v) < 1) {
    throw new ApiError(400, `Параметр ${name} должен быть целым числом больше 0`);
  }
  return Number(v);
}

function queryNumber(query, name) {
  const v = query.get(name);
  if (v === null) return undefined;
  const n = Number(v);
  if (v.trim() === '' || !Number.isFinite(n) || n < 0) {
    throw new ApiError(400, `Параметр ${name} должен быть неотрицательным числом`);
  }
  return n;
}

function queryDate(query, name, required = false) {
  const v = query.get(name);
  if (v === null) {
    if (required) throw new ApiError(400, `Параметр ${name} обязателен`);
    return undefined;
  }
  return checkDate(v, name);
}

function pathId(raw) {
  if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new ApiError(400, 'Некорректный id');
  return Number(raw);
}

function findProduct(id) {
  const product = db.products.find((p) => p.id === id);
  if (!product) throw new ApiError(404, 'Товар не найден');
  return product;
}

function validateProduct(body, current) {
  const partial = Boolean(current);
  const errors = [];

  if (body.name !== undefined || !partial) {
    if (typeof body.name !== 'string' || body.name.length === 0 || body.name.length > 100) {
      errors.push('name: строка от 1 до 100 символов');
    } else if (db.products.some((p) => p.name === body.name && p !== current)) {
      errors.push('name: товар с таким названием уже существует');
    }
  }

  if (body.category_id !== undefined || !partial) {
    if (!isPosInt(body.category_id)) errors.push('category_id: целое число больше 0');
  }

  if (body.price !== undefined || !partial) {
    if (typeof body.price !== 'number' || body.price < 0 || !hasTwoDecimals(body.price)) {
      errors.push('price: число больше 0, не более 2 знаков после запятой');
    }
  }

  if (errors.length) throw new ApiError(400, errors.join('; '));
}

// ---------- auth ----------

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Подпись: hex(HMAC-SHA256(secret, "<X-Timestamp>\n<METHOD>\n<path?query>")).
// Путь принимается как в закодированном (как ушёл по сети), так и в декодированном виде.
function verifySignature(req) {
  const ts = req.headers['x-timestamp'];
  const sig = req.headers['x-signature'];
  if (!ts || !sig) throw new ApiError(401, 'Требуются заголовки X-Timestamp и X-Signature');
  if (!/^\d+$/.test(ts)) throw new ApiError(401, 'X-Timestamp должен быть Unix-временем в секундах');
  if (Math.abs(Date.now() / 1000 - Number(ts)) > MAX_CLOCK_SKEW_SEC) {
    throw new ApiError(401, 'Подпись просрочена: X-Timestamp отличается от времени сервера больше чем на 5 минут');
  }

  const given = Buffer.from(String(sig).toLowerCase());
  const ok = [...new Set([req.url, safeDecode(req.url)])].some((path) => {
    const expected = Buffer.from(crypto
      .createHmac('sha256', SIGN_SECRET)
      .update(`${ts}\n${req.method}\n${path}`)
      .digest('hex'));
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  });
  if (!ok) throw new ApiError(401, 'Неверная подпись');
}

// ---------- routes ----------

const routes = [];

function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
  routes.push({ method, re, keys, handler });
}

route('GET', '/', () => [200, { name: 'Shop API', version: '1.0.0', docs: '/docs', openapi: '/openapi.json' }]);

route('POST', '/api/reset', () => {
  seed();
  return [204];
});

route('GET', '/api/categories', () => [200, db.categories]);

route('GET', '/api/warehouses', () => [200, db.warehouses]);

route('GET', '/api/products', ({ query }) => {
  const categoryId = queryInt(query, 'category_id');
  const minPrice = queryNumber(query, 'min_price');
  const maxPrice = queryNumber(query, 'max_price');
  const search = query.get('search');
  const page = queryInt(query, 'page') ?? 1;
  const limit = queryInt(query, 'limit') ?? 10;
  if (limit > 100) throw new ApiError(400, 'Параметр limit не может быть больше 100');

  const items = db.products
    .filter((p) =>
      (categoryId === undefined || p.category_id === categoryId) &&
      (minPrice === undefined || p.price >= minPrice) &&
      (maxPrice === undefined || p.price < maxPrice) &&
      (!search || p.name.includes(search)))
    .sort((a, b) => a.id - b.id);

  const offset = page > 1 ? (page - 1) * limit + 1 : 0;
  return [200, { items: items.slice(offset, offset + limit), total: items.length, page, limit }];
});

route('GET', '/api/products/:id', ({ params }) => {
  const id = Number(BigInt(params.id));
  return [200, findProduct(id)];
});

route('POST', '/api/products', ({ body }) => {
  validateProduct(body);
  const product = { id: db.nextProductId++, name: body.name, category_id: body.category_id, price: body.price };
  db.products.push(product);
  return [200, product];
});

route('PATCH', '/api/products/:id', ({ params, body }) => {
  const product = findProduct(pathId(params.id));
  validateProduct(body, product);
  Object.assign(product, {
    name: body.name ?? product.name,
    category_id: body.category_id ?? null,
    price: body.price ?? product.price,
  });
  return [200, product];
});

route('DELETE', '/api/products/:id', ({ params }) => {
  const product = findProduct(pathId(params.id));
  db.products = db.products.filter((p) => p !== product);
  db.stock = db.stock.filter((s) => s.product_id !== product.id);
  return [204];
});

route('GET', '/api/products/:id/stock', ({ params }) => {
  const product = findProduct(pathId(params.id));
  const rows = db.stock
    .filter((s) => s.product_id === product.id)
    .map((s) => ({ warehouse_id: s.warehouse_id, qty: s.qty }));
  return [200, { product_id: product.id, total: rows.reduce((sum, r) => sum + r.qty, 0), by_warehouse: rows }];
});

route('GET', '/api/stock', ({ query }) => {
  const warehouseId = queryInt(query, 'warehouse_id');
  const productId = queryInt(query, 'product_id');
  return [200, db.stock.filter((s) =>
    (warehouseId === undefined || s.warehouse_id === warehouseId) &&
    (productId === undefined || s.product_id === productId))];
});

route('POST', '/api/sales', ({ body }) => {
  const { product_id, warehouse_id, qty } = body;
  if (!isPosInt(product_id) || !db.products.some((p) => p.id === product_id)) {
    throw new ApiError(400, 'product_id: товар не найден');
  }
  if (!isPosInt(warehouse_id) || !db.warehouses.some((w) => w.id === warehouse_id)) {
    throw new ApiError(400, 'warehouse_id: склад не найден');
  }
  if (!Number.isInteger(qty)) throw new ApiError(400, 'qty: целое число больше 0');

  let price = findProduct(product_id).price;
  if (body.price !== undefined) {
    if (typeof body.price !== 'number' || !(body.price > 0) || !hasTwoDecimals(body.price)) {
      throw new ApiError(400, 'price: число больше 0, не более 2 знаков после запятой');
    }
    price = body.price;
  }

  const saleDate = body.sale_date === undefined ? today() : checkDate(body.sale_date, 'sale_date');

  const available = db.stock
    .filter((s) => s.product_id === product_id)
    .reduce((sum, s) => sum + s.qty, 0);
  if (available < qty) throw new ApiError(409, 'Недостаточно товара на складе');

  let row = db.stock.find((s) => s.product_id === product_id && s.warehouse_id === warehouse_id);
  if (!row) {
    row = { warehouse_id, product_id, qty: 0 };
    db.stock.push(row);
  }
  row.qty -= qty;

  const sale = { id: db.nextSaleId++, sale_date: saleDate, product_id, warehouse_id, qty, price };
  db.sales.push(sale);
  return [201, sale];
});

route('GET', '/api/sales', ({ query }) => {
  const from = queryDate(query, 'date_from');
  const to = queryDate(query, 'date_to');
  if (from && to && from > to) throw new ApiError(400, 'date_from не может быть больше date_to');
  const productId = queryInt(query, 'product_id');
  const warehouseId = queryInt(query, 'warehouse_id');

  const items = db.sales
    .filter((s) =>
      (!from || s.sale_date >= from) &&
      (!to || s.sale_date <= to) &&
      (productId === undefined || s.product_id === productId) &&
      (warehouseId === undefined || s.warehouse_id === warehouseId))
    .sort((a, b) => a.sale_date.localeCompare(b.sale_date) || a.id - b.id)
    .map((s) => ({ ...s, product_name: db.products.find((p) => p.id === s.product_id).name }));
  return [200, items];
});

route('GET', '/api/reports/revenue-by-category', ({ query }) => {
  const from = queryDate(query, 'date_from', true);
  const to = queryDate(query, 'date_to', true);
  if (from > to) throw new ApiError(400, 'date_from не может быть больше date_to');

  const totals = new Map();
  for (const s of db.sales) {
    if (s.sale_date < from || s.sale_date >= to) continue;
    const product = db.products.find((p) => p.id === s.product_id);
    const row = totals.get(product.category_id) ?? { category_id: product.category_id, qty: 0, revenue: 0 };
    row.qty += s.qty;
    row.revenue += s.qty * product.price;
    totals.set(product.category_id, row);
  }

  const result = [...totals.values()]
    .map((r) => ({
      category_id: r.category_id,
      category: db.categories.find((c) => c.id === r.category_id)?.name ?? null,
      qty: r.qty,
      revenue: round2(r.revenue),
    }))
    .sort((a, b) => b.revenue - a.revenue);
  return [200, result];
});

// ---------- docs ----------

const swaggerDir = require('swagger-ui-dist').getAbsoluteFSPath();
const staticFiles = {
  '/docs/swagger-ui.css': [path.join(swaggerDir, 'swagger-ui.css'), 'text/css; charset=utf-8'],
  '/docs/swagger-ui-bundle.js': [path.join(swaggerDir, 'swagger-ui-bundle.js'), 'application/javascript; charset=utf-8'],
  '/docs/hmac.js': [path.join(__dirname, 'public', 'hmac.js'), 'application/javascript; charset=utf-8'],
};

function serveDocs(req, res, pathname) {
  if (req.method !== 'GET') return false;
  if (pathname === '/docs' || pathname === '/docs/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(docs.html);
    return true;
  }
  if (pathname === '/openapi.json') {
    send(res, 200, docs.openapi);
    return true;
  }
  const file = staticFiles[pathname];
  if (file) {
    res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'public, max-age=3600' });
    fs.createReadStream(file[0]).pipe(res);
    return true;
  }
  return false;
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let status = 500;
  try {
    if (serveDocs(req, res, url.pathname)) {
      status = 200;
      return;
    }
    if (url.pathname.startsWith('/api/')) verifySignature(req);
    const matched = routes.filter((r) => r.re.test(url.pathname));
    if (!matched.length) throw new ApiError(404, 'Маршрут не найден');
    const r = matched.find((x) => x.method === req.method);
    if (!r) throw new ApiError(405, 'Метод не поддерживается');

    const m = url.pathname.match(r.re);
    const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
    const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
    const [s, payload] = await r.handler({ params, query: url.searchParams, body });
    status = s;
    send(res, status, payload);
  } catch (err) {
    if (err instanceof ApiError) {
      status = err.status;
      send(res, status, { error: err.message });
    } else {
      console.error(err);
      send(res, status, { error: 'Внутренняя ошибка сервера' });
    }
  } finally {
    console.log(`${req.method} ${req.url} -> ${status}`);
  }
});

seed();
server.listen(PORT, () => console.log(`Shop API: http://localhost:${PORT}`));
