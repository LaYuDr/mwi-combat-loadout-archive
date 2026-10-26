#!/bin/zsh
set -e
cd "$(dirname "$0")"
npm run release:dry-run
npm run release
