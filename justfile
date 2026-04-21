default: package

# Build extension zip for Chrome Web Store, named by manifest version.
# Whitelists files explicitly para nao vazar .git, .claude, README, zips antigos, etc.
package:
    #!/usr/bin/env bash
    set -euo pipefail
    version=$(grep '"version"' manifest.json | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
    mkdir -p out
    outfile="out/english-extension-${version}.zip"
    rm -f "$outfile"
    zip -r "$outfile" \
        manifest.json \
        content.js content.css \
        popup.html popup.js popup.css \
        icons
    echo ""
    echo "built: $outfile"
    unzip -l "$outfile"

# Remove all generated zip files
clean:
    rm -rf out
