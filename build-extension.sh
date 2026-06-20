#!/bin/bash
set -e

echo "🔨 Building popup..."
cd extension/popup
npm run build
cd ../..

echo "📦 Assembling dist/..."
rm -rf extension/dist
mkdir -p extension/dist/popup
mkdir -p extension/dist/background
mkdir -p extension/dist/content
mkdir -p extension/dist/icons

# Copy built popup
cp -r extension/popup/dist/popup/* extension/dist/popup/

# Copy static files
cp extension/manifest.json extension/dist/
cp extension/background/service-worker.js extension/dist/background/
cp extension/content/chatgpt-injector.js extension/dist/content/
cp extension/content/gemini-injector.js extension/dist/content/
cp -r extension/icons/* extension/dist/icons/

echo "✅ Done → extension/dist/ ready to load in Chrome"