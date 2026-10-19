'use strict';

// OpenAPI-описание Shop API и страница Swagger UI (/docs).

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema, description = 'Успешно') => ({ description, content: { 'application/json': { schema } } });
const err = (description) => json(ref('Error'), description);

const E400 = err('Некорректные данные: не прошла валидация, неверный параметр или id');
const E401 = err('Нет подписи, подпись неверная или просрочена');
const E404 = err('Объект не найден');
const E409 = err('Конфликт с текущим состоянием данных');

const idParam = {
  name: 'id', in: 'path', required: true,
  description: 'Целое число больше 0. Иначе — 400',
  schema: { type: 'integer', minimum: 1 },
};
const q = (name, description, schema = { type: 'integer', minimum: 1 }, required = false) => (
  { name, in: 'query', required, description, schema }
);
const dateQ = (name, description, required = false) => q(name, description, { type: 'string', format: 'date' }, required);

const description = `
REST API интернет-магазина: товары, склады, остатки и продажи.

## Общие правила
- Формат запросов и ответов — JSON, UTF-8.
- Деньги — в рублях, не более 2 знаков после запятой. Даты — \`YYYY-MM-DD\`.
- Ошибка возвращается в виде \`{"error": "описание"}\`.
- Ответ \`500\` не предусмотрен ни для одного запроса.
- \`id\` в пути — целое число больше 0. Если передано что-то другое (\`abc\`, \`1.5\`, \`-1\`, \`0\`) — \`400\`. Если id корректный, но объекта нет — \`404\`.
- Данные хранятся в памяти. \`POST /api/reset\` возвращает исходное состояние.

## Авторизация
Каждый запрос к \`/api/*\` должен содержать заголовки:

| Заголовок | Значение |
|---|---|
| \`X-Timestamp\` | Unix-время в секундах. Допустимое расхождение с сервером — 5 минут |
| \`X-Signature\` | hex(HMAC-SHA256(секрет, строка подписи)) |

**Секретный ключ:** \`junior-qa-secret-2026\`

**Строка подписи** — три части через перевод строки \`\\n\`:
\`\`\`
<X-Timestamp>
<HTTP-метод заглавными>
<путь вместе с query-строкой>
\`\`\`
Например: \`1792400000\\nGET\\n/api/products?page=2\`. Тело запроса в подписи не участвует.

Без подписи, с неверной или просроченной подписью — \`401\`.

**На этой странице** введите секрет в поле вверху — тогда «Try it out» подписывает запросы автоматически.

**Postman** — скрипт для вкладки Scripts → Pre-request коллекции:
\`\`\`javascript
const secret = 'junior-qa-secret-2026';
const ts = Math.floor(Date.now() / 1000).toString();
const path = pm.variables.replaceIn(pm.request.url.getPathWithQuery());
const sig = CryptoJS.HmacSHA256(\`\${ts}\\n\${pm.request.method}\\n\${path}\`, secret).toString(CryptoJS.enc.Hex);
pm.request.headers.upsert({ key: 'X-Timestamp', value: ts });
pm.request.headers.upsert({ key: 'X-Signature', value: sig });
\`\`\`
`;

const openapi = {
  openapi: '3.0.3',
  info: { title: 'Shop API', version: '1.0.0', description },
  tags: [
    { name: 'Служебные' },
    { name: 'Справочники' },
    { name: 'Товары' },
    { name: 'Остатки' },
    { name: 'Продажи' },
    { name: 'Отчёты' },
  ],
  security: [{ Timestamp: [], Signature: [] }],
  paths: {
    '/api/reset': {
      post: {
        tags: ['Служебные'], summary: 'Сбросить данные к исходному состоянию',
        responses: { 204: { description: 'Данные сброшены' }, 401: E401 },
      },
    },
    '/api/categories': {
      get: {
        tags: ['Справочники'], summary: 'Список категорий',
        responses: { 200: json({ type: 'array', items: ref('Category') }), 401: E401 },
      },
    },
    '/api/warehouses': {
      get: {
        tags: ['Справочники'], summary: 'Список складов',
        responses: { 200: json({ type: 'array', items: ref('Warehouse') }), 401: E401 },
      },
    },
    '/api/products': {
      get: {
        tags: ['Товары'], summary: 'Список товаров',
        description: 'Сортировка по `id` по возрастанию. `total` — сколько всего товаров подходит под фильтры, без учёта пагинации. '
          + 'Каждый подходящий товар попадает **ровно на одну** страницу. Некорректное значение параметра — 400.',
        parameters: [
          q('category_id', 'Только товары этой категории'),
          q('min_price', 'Цена **больше или равна** значению', { type: 'number', minimum: 0 }),
          q('max_price', 'Цена **меньше или равна** значению', { type: 'number', minimum: 0 }),
          q('search', 'Название содержит подстроку, **без учёта регистра**', { type: 'string' }),
          q('page', 'Номер страницы, начиная с 1. По умолчанию 1'),
          q('limit', 'Размер страницы, от 1 до 100. По умолчанию 10', { type: 'integer', minimum: 1, maximum: 100 }),
        ],
        responses: { 200: json(ref('ProductList')), 400: E400, 401: E401 },
      },
      post: {
        tags: ['Товары'], summary: 'Создать товар',
        requestBody: { required: true, content: { 'application/json': { schema: ref('ProductCreate') } } },
        responses: { 201: json(ref('Product'), 'Товар создан'), 400: E400, 401: E401 },
      },
    },
    '/api/products/{id}': {
      parameters: [idParam],
      get: {
        tags: ['Товары'], summary: 'Один товар',
        responses: { 200: json(ref('Product')), 400: E400, 401: E401, 404: E404 },
      },
      patch: {
        tags: ['Товары'], summary: 'Частично изменить товар',
        description: '**Изменяются только переданные поля, остальные остаются прежними.** Правила валидации — как при создании.',
        requestBody: { required: true, content: { 'application/json': { schema: ref('ProductPatch') } } },
        responses: { 200: json(ref('Product')), 400: E400, 401: E401, 404: E404 },
      },
      delete: {
        tags: ['Товары'], summary: 'Удалить товар',
        description: 'Товар, по которому **есть продажи**, удалить нельзя — 409. Товар без продаж удаляется вместе со своими остатками.',
        responses: { 204: { description: 'Товар удалён' }, 400: E400, 401: E401, 404: E404, 409: E409 },
      },
    },
    '/api/products/{id}/stock': {
      parameters: [idParam],
      get: {
        tags: ['Товары'], summary: 'Остатки товара по складам',
        responses: { 200: json(ref('ProductStock')), 400: E400, 401: E401, 404: E404 },
      },
    },
    '/api/stock': {
      get: {
        tags: ['Остатки'], summary: 'Остатки',
        parameters: [q('warehouse_id', 'Фильтр по складу'), q('product_id', 'Фильтр по товару')],
        responses: { 200: json({ type: 'array', items: ref('StockRow') }), 400: E400, 401: E401 },
      },
    },
    '/api/sales': {
      get: {
        tags: ['Продажи'], summary: 'Список продаж',
        description: 'Сортировка по дате, затем по `id`. Обе границы дат — **включительно**. Если `date_from` > `date_to` — 400.',
        parameters: [
          dateQ('date_from', 'Дата продажи не раньше'),
          dateQ('date_to', 'Дата продажи не позже'),
          q('product_id', 'Фильтр по товару'),
          q('warehouse_id', 'Фильтр по складу'),
        ],
        responses: { 200: json({ type: 'array', items: ref('SaleWithName') }), 400: E400, 401: E401 },
      },
      post: {
        tags: ['Продажи'], summary: 'Зарегистрировать продажу',
        description: 'Товар списывается **с указанного склада**. Если на этом складе товара меньше, чем `qty` '
          + '(или его там нет совсем), продажа не регистрируется — 409, остатки не меняются. '
          + 'После успешной продажи остаток на складе уменьшается на `qty`. Остаток никогда не может быть отрицательным.',
        requestBody: { required: true, content: { 'application/json': { schema: ref('SaleCreate') } } },
        responses: { 201: json(ref('Sale'), 'Продажа зарегистрирована'), 400: E400, 401: E401, 409: E409 },
      },
    },
    '/api/reports/revenue-by-category': {
      get: {
        tags: ['Отчёты'], summary: 'Выручка по категориям',
        description: 'Выручка считается по **фактической цене продажи**: сумма `qty × price`. Обе границы дат — **включительно**. '
          + 'В отчёт попадают только категории с продажами за период. Сортировка по выручке по убыванию.\n\n'
          + 'Пример: для `date_from=2026-10-01&date_to=2026-10-31` на исходных данных у категории «Электроника» qty = 7, revenue = 248930.',
        parameters: [
          dateQ('date_from', 'Начало периода', true),
          dateQ('date_to', 'Конец периода', true),
        ],
        responses: { 200: json({ type: 'array', items: ref('RevenueRow') }), 400: E400, 401: E401 },
      },
    },
  },
  components: {
    securitySchemes: {
      Timestamp: { type: 'apiKey', in: 'header', name: 'X-Timestamp', description: 'Unix-время в секундах' },
      Signature: { type: 'apiKey', in: 'header', name: 'X-Signature', description: 'hex(HMAC-SHA256(секрет, строка подписи))' },
    },
    schemas: {
      Error: { type: 'object', properties: { error: { type: 'string' } }, example: { error: 'Товар не найден' } },
      Category: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } }, example: { id: 1, name: 'Электроника' } },
      Warehouse: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } }, example: { id: 1, name: 'Москва' } },
      Product: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          category_id: { type: 'integer' },
          price: { type: 'number' },
        },
        example: { id: 1, name: 'Смартфон Alpha', category_id: 1, price: 29990 },
      },
      ProductCreate: {
        type: 'object',
        required: ['name', 'category_id', 'price'],
        properties: {
          name: {
            type: 'string', minLength: 1, maxLength: 100,
            description: 'Пробелы по краям обрезаются; после обрезки 1–100 символов. Уникально **без учёта регистра**',
          },
          category_id: { type: 'integer', minimum: 1, description: 'Категория должна существовать' },
          price: { type: 'number', exclusiveMinimum: true, minimum: 0, description: 'Строго больше 0, не более 2 знаков после запятой' },
        },
        example: { name: 'Утюг Kappa', category_id: 2, price: 4990 },
      },
      ProductPatch: {
        type: 'object',
        description: 'Любой набор полей. Правила — как в ProductCreate',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          category_id: { type: 'integer', minimum: 1 },
          price: { type: 'number', exclusiveMinimum: true, minimum: 0 },
        },
        example: { price: 3190 },
      },
      ProductList: {
        type: 'object',
        properties: {
          items: { type: 'array', items: ref('Product') },
          total: { type: 'integer' },
          page: { type: 'integer' },
          limit: { type: 'integer' },
        },
      },
      StockRow: {
        type: 'object',
        properties: { warehouse_id: { type: 'integer' }, product_id: { type: 'integer' }, qty: { type: 'integer', minimum: 0 } },
        example: { warehouse_id: 1, product_id: 1, qty: 15 },
      },
      ProductStock: {
        type: 'object',
        properties: {
          product_id: { type: 'integer' },
          total: { type: 'integer' },
          by_warehouse: {
            type: 'array',
            items: { type: 'object', properties: { warehouse_id: { type: 'integer' }, qty: { type: 'integer' } } },
          },
        },
        example: { product_id: 1, total: 20, by_warehouse: [{ warehouse_id: 1, qty: 15 }, { warehouse_id: 2, qty: 5 }] },
      },
      Sale: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          sale_date: { type: 'string', format: 'date' },
          product_id: { type: 'integer' },
          warehouse_id: { type: 'integer' },
          qty: { type: 'integer' },
          price: { type: 'number', description: 'Фактическая цена продажи за единицу' },
        },
        example: { id: 1, sale_date: '2026-09-05', product_id: 1, warehouse_id: 1, qty: 2, price: 29990 },
      },
      SaleWithName: {
        allOf: [ref('Sale'), { type: 'object', properties: { product_name: { type: 'string' } } }],
      },
      SaleCreate: {
        type: 'object',
        required: ['product_id', 'warehouse_id', 'qty'],
        properties: {
          product_id: { type: 'integer', description: 'Товар должен существовать, иначе 400' },
          warehouse_id: { type: 'integer', description: 'Склад должен существовать, иначе 400' },
          qty: { type: 'integer', minimum: 1, description: 'Целое число больше 0' },
          price: { type: 'number', description: 'Необязательное, больше 0. По умолчанию — текущая цена товара' },
          sale_date: { type: 'string', format: 'date', description: 'Необязательное. По умолчанию — сегодня' },
        },
        example: { product_id: 1, warehouse_id: 1, qty: 1 },
      },
      RevenueRow: {
        type: 'object',
        properties: {
          category_id: { type: 'integer' },
          category: { type: 'string' },
          qty: { type: 'integer' },
          revenue: { type: 'number' },
        },
        example: { category_id: 1, category: 'Электроника', qty: 7, revenue: 248930 },
      },
    },
  },
};

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shop API — документация</title>
<link rel="stylesheet" href="/docs/swagger-ui.css">
<style>
  body { margin: 0; background: #fff; font-family: sans-serif; }
  .signbar { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; padding: 12px 20px;
             background: #1f3864; color: #fff; font-size: 14px; }
  .signbar input { width: 260px; max-width: 100%; padding: 6px 8px; border: 0; border-radius: 4px; font: inherit; }
  .signbar .hint { opacity: .8; }
</style>
</head>
<body>
<div class="signbar">
  <label>Секрет подписи: <input id="secret" type="text" autocomplete="off" placeholder="см. раздел «Авторизация»"></label>
  <span class="hint">Если поле заполнено, «Try it out» подписывает запросы автоматически.</span>
</div>
<div id="swagger"></div>
<script src="/docs/hmac.js"></script>
<script src="/docs/swagger-ui-bundle.js"></script>
<script>
  const secretInput = document.getElementById('secret');
  try { secretInput.value = localStorage.getItem('shopApiSecret') || ''; } catch (e) {}
  secretInput.addEventListener('input', () => {
    try { localStorage.setItem('shopApiSecret', secretInput.value); } catch (e) {}
  });

  window.ui = SwaggerUIBundle({
    url: '/openapi.json',
    dom_id: '#swagger',
    docExpansion: 'list',
    defaultModelsExpandDepth: 0,
    requestInterceptor: (req) => {
      const secret = secretInput.value;
      const u = new URL(req.url, location.origin);
      if (!secret || !u.pathname.startsWith('/api/')) return req;
      const ts = Math.floor(Date.now() / 1000).toString();
      req.headers['X-Timestamp'] = ts;
      req.headers['X-Signature'] = hmacSha256Hex(secret, ts + '\\n' + req.method.toUpperCase() + '\\n' + u.pathname + u.search);
      return req;
    },
  });
</script>
</body>
</html>
`;

module.exports = { openapi, html };
