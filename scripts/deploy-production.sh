#!/usr/bin/env bash
# Builds the frontend and API from source and ships the build artifacts to
# the live server - replaces the ad-hoc "hand-patch bundle.js over ssh"
# workflow used earlier. Run from the repo root: ./scripts/deploy-production.sh
#
# What this does NOT do: merge/push git, touch the database, or restart
# nginx (static files only, nginx just serves whatever's on disk).
set -euo pipefail

REMOTE="root@turevskiy.com"
REMOTE_FRONTEND="/var/www/html/karmameter.net"
REMOTE_API="/var/www/html/karmameter.net.api"
TS="$(date +%Y%m%d-%H%M%S)"

cd "$(dirname "$0")/.."

echo "==> Building frontend (root publicPath - NOT the GH-Pages build, content-hashed filenames)..."
npm run build >/tmp/karma-deploy-build.log 2>&1 || { echo "Build failed, see /tmp/karma-deploy-build.log"; exit 1; }

# docs/ always has the previously-committed (unhashed) GH-Pages bundle.js/
# main.css sitting in it too - the hashed glob below only matches the
# freshly-built ones (plain "bundle.js" has no second ".", doesn't match
# "bundle.*.js").
JS_FILE="$(find docs -maxdepth 1 -name 'bundle.*.js' | head -1)"
CSS_FILE="$(find docs -maxdepth 1 -name 'main.*.css' | head -1)"
if [ -z "$JS_FILE" ] || [ -z "$CSS_FILE" ]; then
  echo "Could not find freshly-built hashed bundle/css in docs/ - aborting."
  exit 1
fi
echo "    JS:  $(basename "$JS_FILE")"
echo "    CSS: $(basename "$CSS_FILE")"

STAGE="$(mktemp -d)"
cp "$JS_FILE" "$CSS_FILE" docs/index.html "$STAGE"/
ICONS_DIR="$(find docs -maxdepth 1 -type d -name 'icons-*' | head -1)"
if [ -n "$ICONS_DIR" ]; then
  cp -r "$ICONS_DIR" "$STAGE"/icons
fi

echo "==> Restoring docs/ to its committed (GH-Pages) state - this build never gets committed..."
git checkout -- docs/
git clean -fd docs/ >/dev/null 2>&1 || true

echo "==> Backing up current production frontend..."
ssh "$REMOTE" "mkdir -p /root/backups && tar -czf /root/backups/frontend-pre-deploy-$TS.tar.gz -C /var/www/html karmameter.net"

echo "==> Shipping frontend build..."
scp "$STAGE/$(basename "$JS_FILE")" "$REMOTE:$REMOTE_FRONTEND/"
scp "$STAGE/$(basename "$CSS_FILE")" "$REMOTE:$REMOTE_FRONTEND/"
scp "$STAGE/index.html" "$REMOTE:$REMOTE_FRONTEND/index.html"
if [ -d "$STAGE/icons" ]; then
  NEW_ICONS_NAME="$(basename "$ICONS_DIR")"
  ssh "$REMOTE" "mkdir -p $REMOTE_FRONTEND/$NEW_ICONS_NAME"
  scp -r "$STAGE/icons/"* "$REMOTE:$REMOTE_FRONTEND/$NEW_ICONS_NAME/"
fi

echo "==> Cleaning up old hashed bundle/css from previous deploys (keeping the 2 most recent of each) and any leftover unhashed bundle.js/main.css..."
ssh "$REMOTE" "cd $REMOTE_FRONTEND && ls -t bundle.*.js 2>/dev/null | tail -n +3 | xargs -r rm -f; ls -t main.*.css 2>/dev/null | tail -n +3 | xargs -r rm -f; rm -f bundle.js main.css"

echo "==> Backing up current production API..."
ssh "$REMOTE" "tar -czf /root/backups/api-pre-deploy-$TS.tar.gz -C /var/www/html --exclude=node_modules karmameter.net.api"

echo "==> Shipping API source..."
scp api/index.js api/routes.js api/config.js api/package.json api/package-lock.json "$REMOTE:$REMOTE_API/"
scp -r api/patches "$REMOTE:$REMOTE_API/" 2>/dev/null || true

echo "==> Installing API deps on server (patch-package postinstall applies automatically)..."
ssh "$REMOTE" "cd $REMOTE_API && npm install --no-audit --no-fund"

echo "==> Restarting API..."
ssh "$REMOTE" "pm2 restart index"

echo "==> Verifying..."
sleep 2
curl -s -o /dev/null -w 'Frontend:          HTTP %{http_code}\n' https://karmameter.net
curl -s -o /dev/null -w 'New bundle.js:     HTTP %{http_code}\n' "https://karmameter.net/$(basename "$JS_FILE")"
curl -s -o /dev/null -w 'API /places:       HTTP %{http_code}\n' "https://karmameter.net/api/places?limit=1"
curl -s -o /dev/null -w 'API /nearbySearch: HTTP %{http_code}\n' "https://karmameter.net/api/nearbySearch?lat=32.08&lng=34.78&radius=1000&type=restaurant"

rm -rf "$STAGE"
echo "==> Deploy complete. Backups: /root/backups/{frontend,api}-pre-deploy-$TS.tar.gz"
