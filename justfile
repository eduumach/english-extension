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
