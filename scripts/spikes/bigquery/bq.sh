#!/usr/bin/env bash
# Throwaway helper for the BigQuery spike.
#   ./bq.sh dry FILE.sql            -> dry run, prints bytes that would be processed
#   ./bq.sh run FILE.sql [FORMAT]   -> dry run, refuses if > guard, then runs with maximum_bytes_billed
# Every real run is appended to ledger.csv (file, bytes_processed, bytes_billed). Params via BQ_PARAMS.
set -euo pipefail
GUARD=${GUARD_BYTES:-53687091200}   # 50 GiB guard
mode=$1; file=$2; fmt=${3:-csv}
dry_json=$(bq query --nouse_legacy_sql --dry_run --format=json ${BQ_PARAMS:-} < "$file" 2>&1) || { echo "DRY RUN FAILED: $dry_json"; exit 2; }
bytes=$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(d["statistics"]["totalBytesProcessed"])' "$dry_json" 2>/dev/null || echo "?")
echo "DRY $file bytes=$bytes ($(python3 -c "print(f'{int(\"$bytes\")/1e9:.3f} GB')" 2>/dev/null || echo ?))" >&2
[ "$mode" = dry ] && exit 0
if [ "$bytes" = "?" ] || [ "$bytes" -gt "$GUARD" ]; then echo "REFUSED: over guard or unknown ($bytes)" >&2; exit 3; fi
max=$(( bytes + bytes / 10 + 10485760 ))   # estimate +10% +10 MiB, never above guard
[ "$max" -gt "$GUARD" ] && max=$GUARD
out=$(mktemp)
if ! bq query --nouse_legacy_sql --maximum_bytes_billed="$max" --format="$fmt" --max_rows=1000000 ${BQ_PARAMS:-} < "$file" > "$out" 2>"$out.err"; then
  echo "QUERY FAILED:" >&2; cat "$out" "$out.err" >&2; rm -f "$out" "$out.err"; exit 4
fi
cat "$out"
# fetch job statistics of the last job for the ledger
job=$(bq ls -j -n 1 --format=json | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["jobReference"]["jobId"])')
stats=$(bq show --format=json -j "$job" | python3 -c 'import json,sys; s=json.load(sys.stdin)["statistics"]; q=s.get("query",{}); print(q.get("totalBytesProcessed","?"), q.get("totalBytesBilled","?"), q.get("cacheHit", False))')
echo "$file,$stats,$job" >> "${LEDGER:-ledger.csv}"
echo "RAN $file processed/billed/cacheHit: $stats job=$job" >&2
rm -f "$out" "$out.err"
