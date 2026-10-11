#!/bin/sh
# One-shot, before migrations (the `db-init` service): seed an EMPTY database from /seed/bitflow.dump.
# Never touches a database that already has tables, so it only ever seeds the first start.
set -eu
export PGHOST=postgres PGUSER="$POSTGRES_USER" PGPASSWORD="$POSTGRES_PASSWORD" PGDATABASE="$POSTGRES_DB"
DUMP=/seed/bitflow.dump

tables=$(psql -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
if [ "$tables" != "0" ]; then
  echo "db-init: database already has $tables tables; not seeding."
  exit 0
fi
if [ ! -f "$DUMP" ]; then
  echo "db-init: database is empty and no seed file was found at ./seed/bitflow.dump."
  echo "db-init: starting with an EMPTY database. The scheduler will ingest days from 2026-10-09 on, one by one."
  echo "db-init: to start with the shared data instead: stop the stack, run 'docker compose down -v', put bitflow.dump in ./seed/, start again."
  exit 0
fi
echo "db-init: database is empty; restoring $DUMP ($(du -h "$DUMP" | cut -f1)). This takes a few minutes."
start=$(date +%s)
# One transaction: if the restore fails, nothing is kept and the next start tries again.
pg_restore --single-transaction --no-owner --no-acl --exit-on-error -d "$PGDATABASE" "$DUMP"
echo "db-init: seed restored in $(( $(date +%s) - start )) s: $(psql -Atc "SELECT count(*) || ' days, ' || coalesce(min(day)::text, '-') || ' .. ' || coalesce(max(day)::text, '-') FROM ingested_days")."
