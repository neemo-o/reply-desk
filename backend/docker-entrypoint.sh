#!/bin/sh
set -e

# ─── Extrai o host da DATABASE_URL para o healthcheck do Postgres ───
# DATABASE_URL chega como: postgresql://user:pass@postgres:5432/db?schema=public
DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\):.*/\1/p')
DB_HOST="${DB_HOST:-postgres}"
echo "🔹 [entrypoint] Aguardando Postgres em $DB_HOST:5432..."

until nc -z "$DB_HOST" 5432 2>/dev/null; do
  echo "   Postgres ($DB_HOST) ainda não está pronto, aguardando..."
  sleep 2
done
echo "✅ [entrypoint] Postgres ($DB_HOST) acessível."

echo "🔹 [entrypoint] Aplicando migrations (prisma migrate deploy)..."
# prisma CLI foi copiado do builder (devDep não instalado via --omit=dev).
# Rodamos direto via node para evitar npx tentar baixar algo.
node node_modules/prisma/build/index.js migrate deploy
echo "✅ [entrypoint] Migrations aplicadas."

# ─── Seed automático quando o banco está fresh ───────────────────
# Verifica se a tabela permissions já tem dados. Se estiver vazia,
# é a primeira execução (ou após reset de volumes) → roda o seed.
# O seed usa upsert, mas criamos produtos no Stripe a cada execução,
# então só rodamos quando o banco está realmente fresh (count == 0).
PERMISSION_COUNT=$(node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  p.permission.count()
    .then(c => { console.log(c); return p.\$disconnect(); })
    .catch(() => { console.log('0'); process.exit(0); });
" 2>/dev/null || echo "0")

if [ "$PERMISSION_COUNT" -eq 0 ] 2>/dev/null; then
  echo "🔹 [entrypoint] Banco fresh (sem permissions) — executando seed..."
  node dist/seed.js
  echo "✅ [entrypoint] Seed concluído."
else
  echo "🔹 [entrypoint] Banco já tem $PERMISSION_COUNT permissions — seed não necessário."
fi

echo "✅ [entrypoint] Banco de dados pronto. Iniciando aplicação..."

# Executa o comando original (CMD do Dockerfile ou override do compose)
exec "$@"
