#!/bin/bash
# Syncs the current directory (Windows Source) to the separate WSL instance location
# Usage: ./sync_wsl.sh

DEST_DIR=~/mcp-local-memory

echo "Syncing to $DEST_DIR..."

# Ensure destination exists
mkdir -p $DEST_DIR/dist
mkdir -p $DEST_DIR/src

# Sync compiled output
cp -r ./dist/* $DEST_DIR/dist/

# Sync source (for debugging/maps)
cp -r ./src/* $DEST_DIR/src/

# Sync config/manifests
cp package.json $DEST_DIR/
cp tsconfig.json $DEST_DIR/

echo "✅ Synced Windows changes to WSL ($DEST_DIR)"
