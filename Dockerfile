# syntax=docker/dockerfile:1.7
FROM oven/bun:1.2.15-alpine AS deps
WORKDIR /app
COPY package.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY integrated-pipeline/server ./integrated-pipeline/server
RUN bun install

FROM deps AS api
WORKDIR /app
RUN apk add --no-cache ffmpeg ca-certificates font-dejavu
COPY database ./database
COPY integrated-pipeline ./integrated-pipeline
RUN chown -R bun:bun /app
USER bun
ENV NODE_ENV=production
EXPOSE 8080
CMD ["bun", "run", "--filter", "@hendy/core-server", "start"]

FROM deps AS web-build
ARG APP=admin-web
ENV VITE_API_BASE_URL=/api/v1
RUN bun run --filter @hendy/${APP} build

FROM nginx:1.27-alpine AS admin-web
COPY --from=web-build /app/apps/admin-web/dist /usr/share/nginx/html
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf

FROM web-build AS studio-build
ARG APP=studio-web
RUN bun run --filter @hendy/${APP} build

FROM nginx:1.27-alpine AS studio-web
COPY --from=studio-build /app/apps/studio-web/dist /usr/share/nginx/html
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
