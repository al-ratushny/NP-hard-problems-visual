#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

WITH_LINKS=0
if [[ "${1:-}" == "--with-links" ]]; then
  WITH_LINKS=1
fi

echo "==> Schema validation"
python3 scripts/validate/schema_validate.py

echo "==> Integrity check"
python3 scripts/validate/integrity_check.py

if [[ "$WITH_LINKS" -eq 1 ]]; then
  echo "==> Link check"
  python3 scripts/validate/check_links.py
fi

echo "All validation checks passed."
