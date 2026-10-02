default: package

# Dev mode with hot reload (opens a Chrome instance with the extension loaded)
dev:
    npm run dev

# Build the extension into dist/chrome-mv3
build:
    npm run build

# Type-check and build the Chrome Web Store zip (dist/*.zip), named by package.json version
package:
    npm run compile
    npm run zip

# Remove build outputs
clean:
    rm -rf dist .output out

# Regenerate the extension icons (public/icons) and the store icon from scripts/icon.py
icons:
    uv run scripts/icon.py

# Render the Chrome Web Store promo tiles (store/promo/*.html -> store/promo-*.png)
promo:
    store/promo/render.sh

# Serve the built hub with sample data at http://localhost:8765/demo.html (for store screenshots)
demo: build
    store/demo/serve.sh

# Frame the raw screenshots (store/screens/raw) into 1280x800 store screenshots
screens:
    store/screens/render.sh
