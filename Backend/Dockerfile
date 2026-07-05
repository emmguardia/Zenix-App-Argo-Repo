FROM node:22-alpine AS runtime

WORKDIR /app

RUN apk update && apk upgrade --no-cache && rm -rf /var/cache/apk/*

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund --loglevel=error

COPY . .

RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

CMD ["node", "server.js"]
