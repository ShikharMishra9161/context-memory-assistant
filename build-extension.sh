#!/bin/bash
set -e

echo "🔨 Building popup..."
cd extension/popup
npm run build
cd ../..

echo "📦 Assembling dist/..."
rm -rf extension/dist
mkdir -p extension/dist/{popup,background,content,icons}

cp -r extension/popup/dist/* extension/dist/popup/
cp extension/manifest.json    extension/dist/
cp extension/background/service-worker.js  extension/dist/background/
cp extension/content/injector-utils.js     extension/dist/content/
cp extension/content/chatgpt-injector.js   extension/dist/content/
cp extension/content/gemini-injector.js    extension/dist/content/
cp extension/content/claude-injector.js    extension/dist/content/
cp -r extension/icons/*                    extension/dist/icons/

echo "🗜️ Creating ZIP..."
cd extension/dist
zip -r ../../context-memory-assistant.zip .
cd ../..

echo "✅ Done → context-memory-assistant.zip ready for Web Store"