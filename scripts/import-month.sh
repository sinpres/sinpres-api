#!/usr/bin/env bash
# Import an entire SINAPI month end-to-end:
#   1. Run the Python extractor on the canonical files in sinapi-extractor/input/
#   2. Sync the generated JSONs into sinpres-api/input/
#   3. Run the Bun seed that consumes sinpres-api/input/
#
# Usage:
#   ./scripts/import-month.sh 2026-04
#   bun run import:month 2026-04
#
# The extractor's input/ should contain (renamed from the Caixa downloads):
#   reference.xlsx        -> SINAPI_Referência_AAAA_MM.xlsx       (required)
#   maintenances.xlsx     -> SINAPI_Manutenções_AAAA_MM.xlsx      (optional)
#   technical_sheets.pdf  -> SINAPI_Fichas_Especificacao_Tecnica_Insumos.pdf (optional, ~yearly)
# See sinapi-extractor/input/README.md for details.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <YYYY-MM>"
  echo "Example: $0 2026-04"
  exit 1
fi

MONTH="$1"

if [[ ! "$MONTH" =~ ^[0-9]{4}-[0-9]{2}$ ]]; then
  echo "Invalid month format: $MONTH (expected YYYY-MM, e.g. 2026-04)"
  exit 1
fi

API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTRACTOR_DIR="$(cd "$API_DIR/../sinapi-extractor" && pwd)"
EXTRACTOR_OUTPUT="$EXTRACTOR_DIR/output"
API_INPUT="$API_DIR/input"

if [[ ! -d "$EXTRACTOR_DIR" ]]; then
  echo "sinapi-extractor not found next to sinpres-api at $EXTRACTOR_DIR"
  echo "Clone it: git clone https://github.com/sinpres/sinapi-extractor $EXTRACTOR_DIR"
  exit 1
fi

echo ">>> [1/3] Running sinapi-extractor for month $MONTH"
cd "$EXTRACTOR_DIR"
python3 src/extract_all.py "$MONTH"

echo
echo ">>> [2/3] Syncing extractor outputs into $API_INPUT"
mkdir -p "$API_INPUT"
# rsync each artifact, only if present
[[ -d "$EXTRACTOR_OUTPUT/reference"   ]] && rsync -a --delete "$EXTRACTOR_OUTPUT/reference/" "$API_INPUT/reference/"   && echo "  synced reference/"
[[ -f "$EXTRACTOR_OUTPUT/maintenances.json" ]] && cp "$EXTRACTOR_OUTPUT/maintenances.json" "$API_INPUT/maintenances.json" && echo "  synced maintenances.json"
[[ -f "$EXTRACTOR_OUTPUT/items.json"  ]] && cp "$EXTRACTOR_OUTPUT/items.json"  "$API_INPUT/items.json"  && echo "  synced items.json"

echo
echo ">>> [3/3] Running sinpres-api seed"
cd "$API_DIR"
bun run db:seed

echo
echo ">>> Import complete for $MONTH"
