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

# Build cache diagnostics. Deploys rebuild every image layer although Docker keeps a build cache,
# and why is not known yet: these lines log the Docker setup and the cache size before and after
# the build and after each prune, so a deploy log shows where the cache goes. They never fail it.
cache_usage() {
  docker buildx du 2>/dev/null | awk '
    $1 == "Total:" { total = $2 }
    NR > 1 && NF >= 3 && $1 !~ /:$/ { records++ }
    END { if (total) printf "%s in %d records", total, records; else printf "unknown (needs buildx)" }' || true
}
builder=$(docker buildx inspect 2>/dev/null) || true
docker_root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null) || true
gc_policy=$(awk '/^GC Policy/ { p = 1 } p && /^[^ ]/ && !/^GC Policy/ { p = 0 } p' <<<"$builder" | tr -s ' \n' ' ' | sed 's/GC Policy //g') || true
echo "deploy: docker $(docker info --format '{{.ServerVersion}}, storage {{.Driver}} {{.DriverStatus}}' 2>/dev/null || echo unknown);" \
  "builder $(awk -F': *' '$1 == "Name" && !n { n = $2 } $1 == "Driver" { d = $2 } $1 == "BuildKit version" { v = $2 }
    END { if (n) printf "%s (%s driver, BuildKit %s)", n, d, v; else printf "unknown (needs buildx)" }' <<<"$builder");" \
  "disk free $(df -h --output=avail,size "${docker_root:-/}" 2>/dev/null | awk 'NR == 2 { print $1 " of " $2 }' | grep . || echo unknown)"
echo "deploy: builder GC policy: ${gc_policy:-unknown}"
echo "deploy: build cache before the build: $(cache_usage)"

# Builds the new images first (both at once), then replaces the running containers.
build_start=$SECONDS
docker compose build
echo "deploy: images built in $((SECONDS - build_start)) s; build cache now $(cache_usage)"
# The clamav image is not built here: fetch its tag's latest patch release (clamd restarts when
# it changed, and uploads wait for it to load its signatures again).
docker compose pull --quiet clamav || echo "deploy: could not pull the clamav image, keeping the current one" >&2
docker compose up -d --remove-orphans

echo "deploy: waiting for the API"
for _ in $(seq 1 60); do
  if docker compose exec -T api node -e \
    "fetch('http://localhost:3000/api/config').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))" \
    2>/dev/null; then
    docker image prune -f >/dev/null
    after_image_prune=$(cache_usage)
    # Every deploy builds the images, and Docker keeps each build's layers as cache. Keep at most
    # 8 GB, dropping what was used longest ago (the latest builds stay cached, so the next one is
    # fast). --all: by default only dangling cache goes. Needs buildx (Ubuntu's docker-buildx
    # package); without it, or on any error, the deploy still succeeds and just says so.
    docker builder prune -af --max-used-space 8gb >/dev/null || echo "deploy: could not prune the build cache (is buildx installed?)" >&2
    echo "deploy: build cache after image prune: $after_image_prune; after builder prune: $(cache_usage)"
    echo "deploy: done"
    exit 0
  fi
  sleep 2
done

echo "deploy: the API did not answer within 2 minutes" >&2
docker compose logs --tail=80 api >&2
exit 1
