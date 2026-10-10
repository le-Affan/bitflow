# Build context: frontend/
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Unit tests (Vitest): docker compose --profile test run --rm frontend-test
FROM build AS test
CMD ["npm", "test"]

FROM build AS dist
# Vite inlines VITE_* variables at build time, so the API base URL is a build argument.
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
# "true" only for the image the end-to-end tests run against (attaches window.__bitflowGraph).
ARG VITE_E2E_INSPECTOR=false
ENV VITE_E2E_INSPECTOR=${VITE_E2E_INSPECTOR}
RUN npm run build

FROM nginx:1.29-alpine AS serve
COPY --from=dist /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
