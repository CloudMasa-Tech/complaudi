#!/usr/bin/env bash
#
# Apply the committed database migrations to a hosted (production) Supabase
# project, then provision the evidence bucket.
#
# It only ever runs `prisma migrate deploy`, which applies the migrations in
# prisma/migrations that the database has not seen yet. It never generates a
# migration, never resets, and never seeds — so it cannot invent DDL against a
# live database, and re-running it after a full run is a no-op.
#
#   ./scripts/migrate-production.sh              # show what is pending, confirm, apply
#   ./scripts/migrate-production.sh --check      # report only, change nothing
#   ./scripts/migrate-production.sh --yes        # no prompt (CI)
#   ./scripts/migrate-production.sh --skip-storage
#
# Environment comes from the process first, then .env. On a deploy platform the
# process already carries DATABASE_URL and DIRECT_URL, and there is no .env.
#
set -euo pipefail

cd "$(dirname "$0")/.."
CHECK_ONLY=false
ASSUME_YES=false
WITH_STORAGE=true
for arg in "$@"; do
  case "$arg" in
    --check|--dry-run) CHECK_ONLY=true ;;
    --yes|-y)          ASSUME_YES=true ;;
    --skip-storage)    WITH_STORAGE=false ;;
    -h|--help)         sed -n '3,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$1"; }
die()  { printf '\033[31m  ✗ %s\033[0m\n' "$1" >&2; exit 1; }

# ── configuration ─────────────────────────────────────────────────────────────
# Read .env without sourcing it: the connection strings contain '&' and '?', and
# a quoting mistake in a sourced file executes arbitrary shell.
env_get() {
  [ -f .env ] || return 0
  sed -n "s/^[[:space:]]*$1=//p" .env | tail -1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

DATABASE_URL="${DATABASE_URL:-$(env_get DATABASE_URL)}"
DIRECT_URL="${DIRECT_URL:-$(env_get DIRECT_URL)}"

[ -n "$DIRECT_URL" ] || die "DIRECT_URL is not set. It is the session pooler string (port 5432) — see DEPLOYMENT.md, Step 1.2."

# Prisma validates the whole datasource block before it looks at directUrl, so
# DATABASE_URL has to be present even though migrations do not travel over it.
if [ -z "$DATABASE_URL" ]; then
  warn "DATABASE_URL is not set — using DIRECT_URL for both. Fine for a one-off migration, wrong for the running app."
  DATABASE_URL="$DIRECT_URL"
fi

case "$DIRECT_URL" in
  *"<project-ref>"*|*"<password>"*|*"<ref>"*|*"<pw>"*)
    die "DIRECT_URL still holds the .env.example placeholders." ;;
esac

# Migrations must not travel over the transaction pooler. DDL and Prisma's
# migration advisory lock both need a real session; over pgbouncer the lock is
# taken and dropped on different backends, and a half-applied migration is the
# failure mode you find out about later.
case "$DIRECT_URL" in
  *:6543/*|*pgbouncer=true*)
    die "DIRECT_URL points at the transaction pooler (port 6543 / pgbouncer=true). Migrations need the session pooler on port 5432." ;;
esac

case "$DATABASE_URL" in
  *:6543/*)
    case "$DATABASE_URL" in
      *pgbouncer=true*) : ;;
      *) warn "DATABASE_URL uses port 6543 without ?pgbouncer=true — the app will hit intermittent 'prepared statement \"s0\" already exists' under load." ;;
    esac ;;
esac

export DATABASE_URL DIRECT_URL

# Redact the password before anything reaches a CI log.
target=$(printf '%s' "$DIRECT_URL" | sed -E 's#(://[^:/]+):[^@]*@#\1:***@#')

# ── what is pending ───────────────────────────────────────────────────────────
say "Target"
echo "  $target"

npx prisma generate >/dev/null || die "prisma generate failed."

say "Migration status"
# `migrate status` exits non-zero when migrations are pending — that is the
# normal case here, not an error, so read the output rather than the code.
status_out=$(npx prisma migrate status 2>&1) || true
printf '%s\n' "$status_out" | sed 's/^/  /'

if printf '%s' "$status_out" | grep -qi "failed migration\|migration started at .* failed"; then
  die "The database holds a failed migration. Resolve it by hand before deploying:
    npx prisma migrate resolve --rolled-back <migration_name>   # it did not apply
    npx prisma migrate resolve --applied     <migration_name>   # it did apply
  See DEPLOYMENT.md before choosing."
fi

if printf '%s' "$status_out" | grep -qi "database schema is up to date"; then
  PENDING=false
else
  PENDING=true
fi

if [ "$CHECK_ONLY" = true ]; then
  say "Check only — nothing was applied"
  [ "$PENDING" = true ] && echo "  migrations are pending" || echo "  up to date"
  exit 0
fi

# ── apply ─────────────────────────────────────────────────────────────────────
if [ "$PENDING" = true ]; then
  if [ "$ASSUME_YES" = false ]; then
    if [ ! -t 0 ]; then
      die "Migrations are pending and this is not an interactive shell. Re-run with --yes once you are sure of the target."
    fi
    warn "This applies the migrations above to the database at $target."
    warn "Take a backup first if the project has no PITR (Supabase → Database → Backups)."
    printf '  Type the word apply to continue: '
    read -r reply
    [ "$reply" = "apply" ] || die "Aborted."
  fi

  say "Applying migrations"
  npx prisma migrate deploy

  say "Migration status after deploy"
  npx prisma migrate status 2>&1 | sed 's/^/  /' || true
else
  say "No migrations pending — schema is already up to date"
fi

# ── storage ───────────────────────────────────────────────────────────────────
# Separate concern, separate script: the bucket lives in the `storage` schema and
# is outside Prisma's migration history entirely.
if [ "$WITH_STORAGE" = true ]; then
  if command -v psql >/dev/null; then
    say "Provisioning the evidence bucket"
    bash scripts/supabase-bootstrap.sh
  else
    warn "psql is not installed — skipping the storage bucket."
    warn "Run supabase/setup.sql in the Supabase SQL editor, or install libpq and re-run with --skip-storage removed."
  fi
fi

say "Done"
cat <<'NEXT'
  Not done by this script, on purpose:
    npm run seed        demo data — never against production
    supabase/pg_cron.sql  schedules the daily sweep, if you use Option C

  Verify against the running API:
    curl -s "$APP_BASE_URL/ready"
    # {"status":"ready","database":"up","storage":"supabase","mail":"smtp"}
NEXT
