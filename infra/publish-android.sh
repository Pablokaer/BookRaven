#!/usr/bin/env bash
# Publishes the Android release the Deploy workflow uploaded to APP_DIR/downloads/.incoming
# (see apps/web/scripts/android-release.mjs). Caddy serves APP_DIR/downloads at /downloads.
#
#   bash infra/publish-android.sh [APP_DIR]
#
# android.json is replaced last, so apps never see a release whose files are not there yet.
set -euo pipefail

DIR="${1:-/opt/mico-livrao}/downloads"
IN="$DIR/.incoming"
cd "$DIR"

apk=$(basename "$(ls "$IN"/bookraven-*.apk)")
mkdir -p bundles
mv -f "$IN"/bundles/*.zip bundles/
mv -f "$IN/$apk" "$apk"
# bookraven.apk is always the newest version (the download page links to it).
ln -f "$apk" .bookraven.apk.tmp
mv -f .bookraven.apk.tmp bookraven.apk
mv -f "$IN/android.json" android.json
rm -rf "$IN"

# Keep a few older versions for apps that are downloading one right now.
ls -t bookraven-*.apk | tail -n +4 | xargs -r rm -f
ls -t bundles/*.zip | tail -n +11 | xargs -r rm -f

echo "publish-android: $apk is live"
