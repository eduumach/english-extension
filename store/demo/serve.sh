#!/usr/bin/env bash
# Serves the built hub with demo data at http://localhost:8765/demo.html (for store screenshots).
set -euo pipefail
cd "$(dirname "$0")/../.."
DIST=dist/chrome-mv3
cp store/demo/demo.js "$DIST/demo.js"
# demo.html = the built hub.html with the fake chrome API loaded first.
sed 's|<script type="module"|<script src="/demo.js"></script><script type="module"|' "$DIST/hub.html" > "$DIST/demo.html"
exec python3 -m http.server 8765 --bind 127.0.0.1 --directory "$DIST"
