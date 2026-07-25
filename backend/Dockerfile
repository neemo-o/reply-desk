# 📈 E2+E8 — Dockerfile para API e Worker via CMD override.
#
# Build:  docker build -t whatsapp-saas-backend .
# Run API:    docker run ... whatsapp-saas-backend                # usa CMD default
# Run Worker: docker run ... whatsapp-saas-backend node dist/src/worker.js
#
# Multi-stage reduz superfície (não traz dev-deps).
# Usuário não-root reduz privilégios.
# Healthcheck no CMD default (API).
# Entrypoint roda prisma migrate deploy + prisma generate antes de subir a app.

# ----------- ESTÁGIO 1: builder (deps + TS + Prisma) -----------
FROM node:22-alpine AS builder
RUN apk add --no-cache openssl ca-certificates
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig*.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src

RUN npx prisma generate
RUN npx nest build
RUN npx nest build -p tsconfig.worker.json
# O worker build gera arquivos em dist-worker/ (outDir custom)
# Vamos consolidar tudo em dist/ mantendo nomes únicos:
RUN cp -r dist-worker/src dist/ || true

# Compila o seed (prisma/seed.ts) para dist/seed.js — usado no entrypoint
# quando o banco é fresh. Usa tsc direto pois nest build só cobre src/.
RUN npx tsc prisma/seed.ts --outDir dist --module commonjs --target ES2022 \
  --moduleResolution node --skipLibCheck --esModuleInterop

# ----------- ESTÁGIO 2: runtime (imagem final) -----------
FROM node:22-alpine
RUN apk add --no-cache openssl ca-certificates curl netcat-openbsd
WORKDIR /app
ENV NODE_ENV=production

# Copia só prod deps
COPY package*.json ./
RUN npm install --omit=dev

# Copia Prisma Client gerado pelo builder (não vem no --omit=dev)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
# Copia prisma CLI do builder — necessário no runtime para `npx prisma migrate deploy`
# no entrypoint. Como é devDep, --omit=dev não o instala no stage de runtime.
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

# Copia Prisma schema + migrations + build artifacts
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist

# Entrypoint que roda migrations antes de iniciar
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Dropa privilégios para o usuário node (já existe na imagem base alpine)
USER node

EXPOSE 3000

# 📈 Default é API. Worker é invocado por override no docker-compose.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/v1/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/src/main.js"]
