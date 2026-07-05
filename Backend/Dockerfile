FROM node:22-alpine AS runtime

WORKDIR /app

RUN apk update && apk upgrade --no-cache && rm -rf /var/cache/apk/*

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund --loglevel=error && npm cache clean --force

COPY . .

# npm/yarn/corepack inutiles au runtime (CMD = node server.js) → suppression.
# Élimine aussi leurs deps vulnérables (picomatch/sigstore du npm global, CVE-2026-33671 / CVE-2026-48815).
RUN rm -rf /usr/local/lib/node_modules /opt/yarn* \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg

RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

CMD ["node", "server.js"]
