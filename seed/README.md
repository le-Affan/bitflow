# seed/

Put the shared database dump here as `bitflow.dump` (pg_dump custom format) before the first `docker compose up`.
A fresh stack (empty database volume) restores it once; later starts never seed again.
Make a new one from a running stack with `scripts/make_seed_dump.sh`. The dump is not committed.
