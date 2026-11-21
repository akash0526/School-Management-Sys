#!/usr/bin/env bash
# =====================================================================
# Rebuild the school database from school_db/sms (DESTROYS ALL DATA).
#
#   npm run db:reset -- --admin-user admin --admin-pass 'a-long-strong-password'
#        → empty school: schema + roles/permissions + grading scale + one super admin
#   npm run db:demo
#        → same, then loads the demo school (scripts/seed-demo.ts)
#
# Options:  --yes             don't ask for confirmation
#           --demo            load the demo school (what `npm run db:demo` does)
#           --admin-user/--admin-pass   first super admin (empty mode; or ADMIN_USER / ADMIN_PASS)
#
# Connection: the drop/create/install needs a PostgreSQL SUPERUSER (extensions, grants).
#   PSQL="psql"                    default — uses PGHOST/PGUSER/PGPASSWORD from the environment
#   PSQL="sudo -u postgres psql"   typical on a single Linux server
# The database name is read from DATABASE_URL in .env. SCHEMA_DIR defaults to ../school_db/sms.
# Refuses to run when NODE_ENV=production unless --i-know-this-is-production is given.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

DEMO=0; YES=0; PROD_OK=0
ADMIN_USER="${ADMIN_USER:-}"; ADMIN_PASS="${ADMIN_PASS:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --demo) DEMO=1 ;;
    --yes|-y) YES=1 ;;
    --admin-user) ADMIN_USER="$2"; shift ;;
    --admin-pass) ADMIN_PASS="$2"; shift ;;
    --i-know-this-is-production) PROD_OK=1 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

[[ -f .env ]] || { echo "✘ .env not found (copy .env.example first)" >&2; exit 1; }
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'; }
DATABASE_URL="$(env_get DATABASE_URL)"
NODE_ENV="${NODE_ENV:-$(env_get NODE_ENV)}"
DB_NAME="$(echo "$DATABASE_URL" | sed -E 's#^[^/]*//[^/]*/([^?]+).*$#\1#')"
SCHEMA_DIR="${SCHEMA_DIR:-../school_db/sms}"
PSQL="${PSQL:-psql}"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"

[[ "$DB_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "✘ Could not read a database name from DATABASE_URL" >&2; exit 1; }
[[ -f "$SCHEMA_DIR/install.sql" ]] || { echo "✘ $SCHEMA_DIR/install.sql not found (set SCHEMA_DIR)" >&2; exit 1; }
if [[ "${NODE_ENV:-}" == "production" && $PROD_OK -ne 1 ]]; then
  echo "✘ NODE_ENV=production — refusing to wipe a live database. Add --i-know-this-is-production if you really mean it." >&2; exit 1
fi
if [[ $DEMO -eq 0 ]]; then
  [[ -n "$ADMIN_USER" && -n "$ADMIN_PASS" ]] || { echo "✘ Empty mode needs --admin-user and --admin-pass (or ADMIN_USER / ADMIN_PASS)" >&2; exit 2; }
fi

MODE=$([[ $DEMO -eq 1 ]] && echo "DEMO school" || echo "EMPTY school (admin: $ADMIN_USER)")
echo "This will DELETE database '$DB_NAME' and rebuild it as: $MODE"
if [[ $YES -ne 1 ]]; then
  read -r -p "Type the database name to continue: " answer
  [[ "$answer" == "$DB_NAME" ]] || { echo "Cancelled."; exit 1; }
fi

SCHEMA_ABS="$(cd "$SCHEMA_DIR" && pwd)"
echo "• Dropping and recreating $DB_NAME"
$PSQL -X -q -v ON_ERROR_STOP=1 -d postgres \
  -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE);" \
  -c "CREATE DATABASE \"$DB_NAME\";"
echo "• Installing schema, seed and security (install.sql)"
# the \ir includes are inlined and piped through stdin, so a sudo'd psql never needs to read this folder
# (client_min_messages goes in the stream too: sudo drops PGOPTIONS, and "does not exist, skipping" notices alarm people)
{ echo "SET client_min_messages = warning;"
  awk -v dir="$SCHEMA_ABS" '/^\\ir /{ f = dir "/" $2; while ((getline line < f) > 0) print line; close(f); next } { print }' "$SCHEMA_ABS/install.sql"
} | $PSQL -X -q -v ON_ERROR_STOP=1 -d "$DB_NAME" >/dev/null

# A fresh install already has the current schema, so record the shipped migrations as
# applied. Without this the API would report the database as "4 migrations behind".
echo "• Recording schema migrations"
npx tsx scripts/db-migrate.ts

if [[ $DEMO -eq 1 ]]; then
  echo "• Loading demo school (takes a minute or two)"
  npx tsx scripts/seed-demo.ts
else
  echo "• Creating super admin"
  npx tsx scripts/create-admin.ts --username "$ADMIN_USER" --password "$ADMIN_PASS"
  echo "✔ Empty school ready. Sign in as '$ADMIN_USER', then: Settings → School profile, Academic setup, Staff, Students."
fi
echo "ℹ Restart the API if it was running, and re-create the website key: npm run create-api-key"
