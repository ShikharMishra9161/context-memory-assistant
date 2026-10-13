#!/bin/bash
# Builds a self-contained extension folder (extension/dist) and a Web Store ZIP.
# For local development you can instead load the extension/ folder directly
# after `npm run build` (the popup is built into extension/dist-popup).
set -e

echo "🔨 Building popup..."
npm run build --prefix extension/popup

echo "📦 Assembling extension/dist..."
rm -rf extension/dist
mkdir -p extension/dist

cp extension/manifest.json extension/dist/
cp -r extension/dist-popup  extension/dist/
cp -r extension/background  extension/dist/
cp -r extension/content     extension/dist/
cp -r extension/lib         extension/dist/
cp -r extension/icons       extension/dist/

rm -f context-memory-assistant.zip
node scripts/zip-dir.mjs extension/dist context-memory-assistant.zip

if [ -f context-memory-assistant.zip ]; then
  echo "✅ Done → context-memory-assistant.zip (upload this to the Chrome Web Store)"
else
  echo "✅ Done → extension/dist (no zip tool found; ZIP skipped)"
fi
