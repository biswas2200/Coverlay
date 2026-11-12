# The web client: a React + TypeScript app built with Vite, served by nginx.
#   stage 1 builds the static files (npm ci, typecheck, vite build);
#   stage 2 is nginx with those files. nginx.conf is a template the image fills in at start-up:
#     API_BASE_URL  where the app sends API calls (default: the backend's published port, as in the
#                   local Docker Compose stack; "/api" when deployed behind the proxy)
#     BACKEND_URL   where /api/ is proxied to (the backend container)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY app ./app
COPY public ./public
COPY src ./src
COPY dev ./dev
COPY preview ./preview
RUN npm run build

FROM nginx:1.27-alpine
ENV API_BASE_URL=http://localhost:8080 \
    BACKEND_URL=http://backend:8080
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist/ /usr/share/nginx/html/
EXPOSE 80
