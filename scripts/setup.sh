#!/usr/bin/env bash
#
# One-shot setup for a fresh machine or VPS.
#
# Idempotent: safe to re-run after a pull, a failed attempt, or a config change.
# It never overwrites an existing .env and never touches your data — the only
# database call it makes is `prisma migrate deploy`, which applies committed
# migrations and nothing else.
#
#   ./scripts/setup.sh              # install, configure, migrate, build
#   ./scripts/setup.sh --local-db   # also start the bundled Postgres container
#   ./scripts/setup.sh --no-build   # skip the production build (dev machines)
#
set -euo pipefail

cd "$(dirname "$0")/.."
LOCAL_DB=false
BUILD=true
for arg in "$@"; do
  case "$arg" in
    --local-db) LOCAL_DB=true ;;
    --no-build) BUILD=false ;;
    -h|--help)  sed -n '3,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$1"; }
die()  { printf '\033[31m  ✗ %s\033[0m\n' "$1" >&2; exit 1; }

# ── 1. toolchain ──────────────────────────────────────────────────────────────
say "Checking the toolchain"
command -v node >/dev/null || die "Node is not installed. Node 20 or newer is required."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || die "Node $(node -v) is too old — 20 or newer is required."
echo "  node $(node -v), npm $(npm -v)"

# ── 2. dependencies ───────────────────────────────────────────────────────────
say "Installing dependencies"
# `npm ci` needs a lockfile in step with package.json; fall back rather than fail
# a first-time setup on a machine that has just pulled a dependency change.
npm ci 2>/dev/null || npm install
npm ci --prefix web 2>/dev/null || npm install --prefix web

# ── 3. configuration ──────────────────────────────────────────────────────────
say "Configuring .env"
if [ -f .env ]; then
  echo "  .env exists — left untouched"
else
  cp .env.example .env
  # Secrets are generated rather than copied: the example file ships obvious
  # placeholders, and a placeholder JWT secret in production is a live account
  # takeover, not a configuration nit.
  for key in JWT_ACCESS_SECRET JWT_REFRESH_SECRET JOB_TRIGGER_SECRET; do
    secret=$(openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-48)
    #  BSD sed (macOS) and GNU sed (Linux) disagree about -i, so write via a temp file.
    awk -v k="$key" -v v="$secret" -F= 'BEGIN{OFS="="} $1==k {print k, v; next} {print}' .env > .env.tmp
    mv .env.tmp .env
  done
  echo "  .env created from .env.example, with fresh JWT and job secrets"
  warn "Set DATABASE_URL and DIRECT_URL in .env before continuing (see SETUP.md)."
fi

# ── 4. database ───────────────────────────────────────────────────────────────
if [ "$LOCAL_DB" = true ]; then
  say "Starting the bundled Postgres"
  command -v docker >/dev/null || die "Docker is not installed, so --local-db cannot start Postgres."
  docker compose up -d
  # The container reports healthy before it accepts connections is a myth in the
  # other direction: wait for the healthcheck, then migrate.
  for _ in $(seq 1 30); do
    status=$(docker inspect -f '{{.State.Health.Status}}' compliance-postgres 2>/dev/null || echo starting)
    [ "$status" = healthy ] && break
    sleep 1
  done
  echo "  postgres: ${status:-unknown}"
fi

say "Applying database migrations"
npx prisma generate
npx prisma migrate deploy
npx prisma migrate status || true

# ── 5. build ──────────────────────────────────────────────────────────────────
if [ "$BUILD" = true ]; then
  say "Building"
  npm run build
  npm run web:build
fi

say "Done"
cat <<'NEXT'
  Next:
    npm run dev:all     start the API and the dashboard for development
    npm start           run the built API   (set SERVE_WEB=true to serve the SPA too)
    npm run seed        load the demo organisation — never in production

  First real account: POST /api/v1/auth/register, or the "Enrol your company"
  link on the sign-in page.
NEXT
