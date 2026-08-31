#!/usr/bin/env bash
#
# Provision the Supabase evidence bucket, then report what the app will use.
#
# Idempotent: it applies supabase/setup.sql, which only ever upserts one row in
# storage.buckets. It touches no application table and runs no Prisma
# migration, so it is safe against a live database.
#
#   ./scripts/supabase-bootstrap.sh              # uses DIRECT_URL from .env
#   ./scripts/supabase-bootstrap.sh --check      # report only, change nothing
#   DIRECT_URL=postgresql://... ./scripts/supabase-bootstrap.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."
CHECK_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --check)   CHECK_ONLY=true ;;
    -h|--help) sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$1"; }
die()  { printf '\033[31m  ✗ %s\033[0m\n' "$1" >&2; exit 1; }

# ── configuration ─────────────────────────────────────────────────────────────
# Read .env without sourcing it: values contain '&' and '?' (pgbouncer query
# strings) and quoting mistakes in a sourced file execute arbitrary shell.
env_get() {
  [ -f .env ] || return 0
  sed -n "s/^[[:space:]]*$1=//p" .env | tail -1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

DIRECT_URL="${DIRECT_URL:-$(env_get DIRECT_URL)}"
BUCKET="${SUPABASE_STORAGE_BUCKET:-$(env_get SUPABASE_STORAGE_BUCKET)}"
BUCKET="${BUCKET:-compliance-evidence}"

[ -n "$DIRECT_URL" ] || die "DIRECT_URL is not set. Copy .env.example to .env and fill in the Supabase connection strings."
case "$DIRECT_URL" in
  *"<project-ref>"*|*"<password>"*) die "DIRECT_URL still holds the .env.example placeholders." ;;
  *:6543/*) warn "DIRECT_URL points at port 6543 (the transaction pooler). DDL needs a session connection — port 5432." ;;
esac

command -v psql >/dev/null || die "psql is not installed. Install libpq (brew install libpq) or paste supabase/setup.sql into the Supabase SQL editor."

if [ "$BUCKET" != "compliance-evidence" ]; then
  warn "SUPABASE_STORAGE_BUCKET is '$BUCKET', but supabase/setup.sql creates 'compliance-evidence'. Edit both or the app will use a bucket that does not exist."
fi

# ── apply ─────────────────────────────────────────────────────────────────────
if [ "$CHECK_ONLY" = false ]; then
  say "Applying supabase/setup.sql"
  psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f supabase/setup.sql
else
  say "Checking the bucket (no changes)"
  psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -c \
    "select id, public, file_size_limit from storage.buckets where id = '$BUCKET';"
fi

# ── report ────────────────────────────────────────────────────────────────────
say "Storage driver the app will use"
# storageDriver flips to supabase only when both of these are present; either
# one missing silently falls back to local disk (src/config/env.ts).
if [ -n "${SUPABASE_URL:-$(env_get SUPABASE_URL)}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-$(env_get SUPABASE_SERVICE_ROLE_KEY)}" ]; then
  echo "  supabase — bucket '$BUCKET'"
else
  warn "local disk. Set BOTH SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env to use the bucket."
fi

say "Done"
echo "  Confirm against the running API:  curl -s localhost:4000/ready"
echo '  Expect:  {"status":"ready","database":"up","storage":"supabase",...}'
