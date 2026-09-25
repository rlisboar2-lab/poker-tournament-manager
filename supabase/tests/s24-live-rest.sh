#!/usr/bin/env bash
# S24 — filas do admin (identificação, lote inicial, rebuy/add-on) contra o PostgREST local.
#
# Rodar SOMENTE no stack local do Supabase CLI, nunca no banco em uso:
#
#   bash supabase/tests/s24-live-rest.sh
#
# Reaproveita o admin local da S22 e roda
# src/services/__tests__/operationalLive.integration.test.ts com a URL e as chaves locais.
# Exige banco sem torneio aberto do fluxo 2 (rode depois de `npx supabase db reset` e do
# s22-admin-rest.sh, e ANTES do s23-portal-rest.sh). O torneio criado termina finalizado.

set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-supabase_db_poker-tournament-manager}"
EMAIL="${S22_ADMIN_EMAIL:-s22-admin@local.test}"
PASSWORD="${S22_ADMIN_PASSWORD:-s22-local-only-password}"

eval "$(npx supabase status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
case "$API_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "API_URL não é local: $API_URL" >&2; exit 1 ;;
esac

# Usuário confirmado via API admin do GoTrue local. 422 = já existe.
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"email_confirm\":true}")
case "$code" in 200|201|422) ;; *) echo "criação do admin local falhou: HTTP $code" >&2; exit 1 ;; esac

docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -q -At -U postgres -d postgres <<SQL
insert into public.app_admins (user_id)
select id from auth.users where email = '$EMAIL'
on conflict do nothing;
SQL

S24_LOCAL=1 S22_ADMIN_EMAIL="$EMAIL" S22_ADMIN_PASSWORD="$PASSWORD" \
VITE_SUPABASE_URL="$API_URL" VITE_SUPABASE_ANON_KEY="$ANON_KEY" \
  npx vitest run src/services/__tests__/operationalLive.integration.test.ts
