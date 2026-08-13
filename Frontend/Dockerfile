# syntax=docker/dockerfile:1.7
#
# Build multi-stage : compilation Vite dans un stage jetable, image finale à base
# de nginx-unprivileged qui ne contient que les fichiers statiques.
#
# Aligné sur le Dockerfile du site vitrine : pnpm épinglé, lockfile gelé, et
# validation de la config nginx au build.

# ── Stage 1 : build Vite ─────────────────────────────────────────────────────
FROM node:22-alpine AS build

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN apk update && apk upgrade --no-cache

# pnpm épinglé, comme dans le stage deps du backend et sur le site vitrine.
RUN npm install -g pnpm@10.33.4 --no-audit --no-fund

WORKDIR /app

# Manifestes seuls d'abord : le cache Docker reste valide tant qu'ils ne
# changent pas. .npmrc porte minimum-release-age=1440 et ignore-scripts=true.
COPY package.json pnpm-lock.yaml .npmrc ./

RUN pnpm install --frozen-lockfile

COPY . .

# `pnpm run build` = tsc -b && vite build : le typage est donc vérifié ici, et
# une erreur de type fait échouer l'image avant tout push.
RUN pnpm run build

# ── Stage 2 : runtime nginx ──────────────────────────────────────────────────
FROM nginxinc/nginx-unprivileged:alpine AS runtime

USER root
RUN apk update && apk upgrade --no-cache

# Active le renseignement de ${NGINX_LOCAL_RESOLVERS} depuis /etc/resolv.conf.
# Ce comportement est opt-in dans l'entrypoint officiel : sans cette variable,
# le script 15-local-resolvers.envsh sort immédiatement et le template est rendu
# avec un ${NGINX_LOCAL_RESOLVERS} littéral, ce qui empêche nginx de démarrer.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1

# La config est un TEMPLATE : l'entrypoint y substitue ${NGINX_LOCAL_RESOLVERS}
# au démarrage et écrit le résultat dans conf.d.
COPY nginx.conf /etc/nginx/templates/default.conf.template

# Le snippet d'en-têtes vit HORS de conf.d : tout *.conf présent dans conf.d est
# inclus automatiquement au niveau http, ce qui n'est pas ce qu'on veut pour un
# fragment destiné à être inclus dans chaque location.
RUN mkdir -p /etc/nginx/snippets
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf

# On retire la config par défaut de l'image : si le rendu du template échouait,
# nginx démarrerait sans server block et la readiness probe échouerait
# franchement, au lieu de servir silencieusement autre chose.
RUN rm -f /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

# Validation de la config au build : une erreur de syntaxe fait échouer l'image
# ici, avant tout push GHCR, plutôt qu'au démarrage du pod en production.
# On rend le template avec un résolveur factice, on teste, puis on nettoie —
# l'entrypoint regénérera le vrai fichier au démarrage.
RUN sed 's|${NGINX_LOCAL_RESOLVERS}|127.0.0.11|' /etc/nginx/templates/default.conf.template \
      > /etc/nginx/conf.d/default.conf \
    && nginx -t \
    && rm -f /etc/nginx/conf.d/default.conf /tmp/nginx.pid

USER 101

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --spider -q http://127.0.0.1:8080/healthz || exit 1
