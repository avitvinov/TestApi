FROM node:20-alpine

RUN apk add --no-cache tzdata
ENV TZ=Europe/Moscow \
    NODE_ENV=production \
    PORT=3000

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.js docs.js ./
COPY public ./public

USER node
EXPOSE 3000
CMD ["node", "server.js"]
