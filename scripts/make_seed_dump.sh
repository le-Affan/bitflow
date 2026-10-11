#!/bin/sh
# Writes seed/bitflow.dump (pg_dump custom format) from the running stack's database. Run from the repository root.
# The file is not committed (seed/ is gitignored); share it separately. A fresh stack restores it on first start.
set -eu
cd "$(dirname "$0")/.."
mkdir -p seed
tmp=seed/bitflow.dump.partial
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$tmp"
mv "$tmp" seed/bitflow.dump
echo "seed/bitflow.dump written: $(du -h seed/bitflow.dump | cut -f1)"
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) || '"' days, latest '"' || max(day) FROM ingested_days"'
