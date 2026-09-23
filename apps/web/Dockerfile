# Stage 1: Build
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

COPY apps/web ./apps/web/

WORKDIR /app/apps/web

ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

RUN pnpm exec vite build

# Stage 2: Serve with nginx
FROM nginx:alpine AS runner

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# nginx.conf is a template; envsubst fills in $PORT at container start.
# The official nginx image auto-processes files in /etc/nginx/templates/.
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template

# Default port when Railway does not inject one (e.g. local docker run).
ENV PORT=80
# Only substitute ${PORT}; leave nginx runtime vars like $uri untouched.
ENV NGINX_ENVSUBST_FILTER=PORT

EXPOSE 80

# Base image entrypoint runs envsubst on templates, then starts nginx.
