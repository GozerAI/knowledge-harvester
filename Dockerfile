FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN addgroup -g 1001 harvester && adduser -u 1001 -G harvester -D harvester
RUN chown -R harvester:harvester /app

EXPOSE 8011

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:8011/health || exit 1

USER harvester

CMD ["node", "src/server.js"]
