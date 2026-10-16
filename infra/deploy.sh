#!/usr/bin/env bash
# Updates a running install to a given commit and restarts it. Run on the VPS, from
# GitHub Actions (.github/workflows/deploy.yml) or by hand:
#
#   bash infra/deploy.sh [APP_DIR] [COMMIT]
#
#   APP_DIR  the clone with .env, data/ and backups/ (default /opt/mico-livrao)
#   COMMIT   commit to deploy (default: the newest on origin/main)
#
# .env, data/ and backups/ are ignored by git, so the reset below never touches them.
# Database migrations run when the API starts.
set -euo pipefail

APP_DIR="${1:-/opt/mico-livrao}"
COMMIT="${2:-origin/main}"

cd "$APP_DIR"
if [ ! -f .env ]; then
  echo "deploy: $APP_DIR/.env is missing; create it from .env.example first" >&2
  exit 1
fi

git fetch --quiet origin main
git checkout --quiet main
git reset --quiet --hard "$COMMIT"
echo "deploy: at $(git log -1 --format='%h %s')"

# Created here (not by Docker as root) so the Deploy workflow can upload the Android app into it.
mkdir -p downloads

# Builds the new images first (both at once), then replaces the running containers.
docker compose up -d --build --remove-orphans

echo "deploy: waiting for the API"
for _ in $(seq 1 60); do
  if docker compose exec -T api node -e \
    "fetch('http://localhost:3000/api/config').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))" \
    2>/dev/null; then
    docker image prune -f >/dev/null
    # Every deploy builds the images, and Docker keeps each build's layers as cache. Keep at most
    # 8 GB, dropping what was used longest ago (the latest builds stay cached, so the next one is
    # fast). --all: by default only dangling cache goes. Needs buildx (Ubuntu's docker-buildx
    # package); without it, or on any error, the deploy still succeeds and just says so.
    docker builder prune -af --max-used-space 8gb >/dev/null || echo "deploy: could not prune the build cache (is buildx installed?)" >&2
    echo "deploy: done"
    exit 0
  fi
  sleep 2
done

echo "deploy: the API did not answer within 2 minutes" >&2
docker compose logs --tail=80 api >&2
exit 1
