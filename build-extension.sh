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
if [ -d extension/icons ] && [ -n "$(ls -A extension/icons 2>/dev/null)" ]; then
  cp -r extension/icons extension/dist/
fi

if command -v zip >/dev/null 2>&1; then
  echo "🗜️ Creating ZIP..."
  rm -f context-memory-assistant.zip
  (cd extension/dist && zip -qr ../../context-memory-assistant.zip .)
  echo "✅ Done → context-memory-assistant.zip"
else
  echo "✅ Done → extension/dist (zip not installed; ZIP skipped)"
fi
