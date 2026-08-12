# syntax=docker/dockerfile:1.7
#
# Build multi-stage : les dépendances sont installées dans un stage `deps`, et
# l'image finale ne garde que node + node_modules + le code applicatif.
# npm/npx/corepack sont retirés du runtime car inutiles (on lance
# « node server.js »), ce qui élimine d'un coup les CVEs récurrentes des paquets
# bundlés par npm (tar, cross-spawn, glob, minimatch...). Plus de suppression
# ciblée à maintenir au fil des avis de sécurité.
#
# Aligné sur le Dockerfile du site vitrine : même gestionnaire de paquets, même
# durcissement, même utilisateur non-root.

# ── Stage 1 : install des dépendances de production ──────────────────────────
FROM node:22-alpine AS deps

ENV NODE_ENV=production \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

# Correctifs de sécurité système Alpine
RUN apk update && apk upgrade --no-cache

# pnpm épinglé. On passe par `npm install -g` plutôt que corepack : corepack a
# été retiré du bundle Node à partir de Node 25/26, cette méthode fonctionne sur
# toutes les versions. npm est de toute façon supprimé du stage runtime.
RUN npm install -g pnpm@10.33.4 --no-audit --no-fund

WORKDIR /app

# Manifestes seuls d'abord : le cache Docker reste valide tant qu'ils ne
# changent pas. .npmrc porte minimum-release-age=1440 et ignore-scripts=true,
# les deux protections supply-chain qui manquaient tant que ce dépôt était
# sous `npm ci` (lequel exécute tous les scripts d'installation).
COPY package.json pnpm-lock.yaml .npmrc ./

RUN pnpm install --prod --frozen-lockfile \
    && pnpm store prune 2>/dev/null || true

# ── Stage 2 : image runtime minimale ─────────────────────────────────────────
FROM node:22-alpine AS runtime

ENV NODE_ENV=production

RUN apk update && apk upgrade --no-cache

# Utilisateur non-root (uid 10000), aligné sur le securityContext du chart Helm.
RUN addgroup -g 10000 appuser && adduser -D -u 10000 -G appuser appuser

# HARDENING SUPPLY-CHAIN : npm, npx, corepack et leurs dépendances bundlées ne
# servent à rien au runtime. Les retirer supprime la principale source de CVEs
# de l'image sans toucher au binaire node.
RUN rm -rf \
      /usr/local/lib/node_modules/npm \
      /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/bin/corepack \
      /opt/yarn-* \
      /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg \
    && rm -rf /root/.npm /root/.cache 2>/dev/null || true

WORKDIR /app

COPY --from=deps --chown=10000:10000 /app/node_modules ./node_modules
COPY --chown=10000:10000 package.json ./

# Code applicatif, listé explicitement.
# L'ancien `COPY . .` embarquait aussi test/ et tout fichier traînant dans le
# dossier : une image de production ne doit contenir que ce qu'elle exécute.
COPY --chown=10000:10000 server.js ./
COPY --chown=10000:10000 config/ ./config/
COPY --chown=10000:10000 middleware/ ./middleware/
COPY --chown=10000:10000 routes/ ./routes/
COPY --chown=10000:10000 utils/ ./utils/
# scripts/ contient les migrations SQL, lancées ponctuellement en Job K8s.
COPY --chown=10000:10000 scripts/ ./scripts/

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const http=require('http');http.get('http://localhost:3000/api/health',(r)=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
