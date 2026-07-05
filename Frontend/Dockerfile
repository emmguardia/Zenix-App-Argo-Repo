FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund --loglevel=error

COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
