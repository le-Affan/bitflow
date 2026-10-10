#!/usr/bin/env bash
# Throwaway: blockchain.info counts for the sample days, strictly one day after another.
cd "$(dirname "$0")"
for spec in "2025-11-27 925343 925485" "2026-01-24 933583 933680" "2026-05-15 949434 949578" "2026-08-15 962499 962643" "2026-10-05 969924 970101"; do
  set -- $spec
  python3 bci_day_counts.py "$1" "$2" "$3" 2>> bci_progress.log >> bci_counts.jsonl || echo "FAILED $1" >> bci_counts.jsonl
done
echo DONE >> bci_counts.jsonl
