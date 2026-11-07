#!/usr/bin/env bash
# Merges APP_DIR/.env.incoming into APP_DIR/.env, then removes it. The Deploy workflow
# (.github/workflows/deploy.yml) writes .env.incoming from its GitHub secrets (KEY=value lines),
# so settings such as the Stripe keys reach the server without anyone editing .env by hand.
# A key already in .env gets the new value; a new key is added. Values are never printed.
#
#   bash infra/set-env.sh [APP_DIR]
set -euo pipefail

APP_DIR="${1:-/opt/mico-livrao}"
cd "$APP_DIR"
trap 'rm -f .env.incoming .env.next' EXIT
[ -s .env.incoming ] || exit 0

cp .env .env.next
while IFS= read -r line || [ -n "$line" ]; do
  key=${line%%=*}
  [[ $key =~ ^[A-Z][A-Z0-9_]*$ ]] || continue
  if grep -q "^${key}=" .env.next; then
    grep -v "^${key}=" .env.next > .env.next.tmp || true
    cat .env.next.tmp > .env.next && rm -f .env.next.tmp
  fi
  printf '%s\n' "$line" >> .env.next
  echo "set-env: $key set"
done < .env.incoming
# Rewritten in place, so .env keeps its owner and permissions.
cat .env.next > .env
