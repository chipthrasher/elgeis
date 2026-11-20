# One Dockerfile for every service that runs our code. compose.yaml picks the
# stage for each.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# The bundled frontend JavaScript and CSS, in dist/.
FROM deps AS frontend
COPY src src
COPY shared shared
RUN npx esbuild src/main.ts --bundle --format=esm --outdir=dist --loader:.png=file --minify

FROM caddy:2-alpine AS proxy
COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html style.css favicon.png dynmap.jpg /srv/site/
COPY --from=frontend /app/dist /srv/dist

FROM node:22-alpine AS backend
RUN apk add --no-cache git openssh-client
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY shared shared
COPY scripts scripts
COPY backend backend
ENV NODE_ENV=production
CMD ["node", "backend/main.ts"]
