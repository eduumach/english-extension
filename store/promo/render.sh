#!/usr/bin/env bash
# Renders the promo tiles with headless Chrome, then flattens them to 24-bit PNG (the store rejects alpha).
set -euo pipefail
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
render() {
  "$CHROME" --headless=new --hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=4000 \
    --window-size="$2,$3" --screenshot="$PWD/../$4" "file://$PWD/$1" >/dev/null 2>&1
  uv run -q --with pillow python -c "from PIL import Image; Image.open('../$4').convert('RGB').save('../$4')"
}
render small.html 440 280 promo-small-440x280.png
render marquee.html 1400 560 promo-marquee-1400x560.png
