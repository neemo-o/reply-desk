# ─── ESTÁGIO 1: builder (Vite build) ───────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json ./
COPY vite.config.ts ./
COPY index.html ./
COPY public ./public
COPY src ./src

# Build de produção — as variáveis VITE_* são injetadas via --build-arg ou .env
ARG VITE_API_URL=http://localhost:3000/api/v1
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ─── ESTÁGIO 2: runtime (Nginx serve SPA) ──────────────────────
FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
