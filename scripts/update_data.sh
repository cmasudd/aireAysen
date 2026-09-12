#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

git pull --ff-only
python3 scripts/download_looker.py
git add data

if git diff --cached --quiet; then
  echo "Sin cambios de datos"
  exit 0
fi

git commit -m "datos: actualización desde Looker Studio $(date '+%Y-%m-%d %H:%M')"
git push origin main
