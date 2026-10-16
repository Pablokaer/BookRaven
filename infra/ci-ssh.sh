#!/usr/bin/env bash
# Sets up SSH to the VPS for a GitHub Actions job (.github/workflows/deploy.yml) and waits until
# the VPS answers, so a brief network hiccup between a runner and the VPS doesn't fail a deploy.
# Afterwards the job reaches the server with `ssh vps ...`.
#
#   SSH_KEY, KNOWN_HOSTS, VPS_HOST, VPS_USER   from the production environment's secrets
#   SSH_PORT                                   default 22
#   SSH_TRIES, SSH_PAUSE                       how often to try, and the seconds between tries
#                                              (default 4 and 15)
#
# Each try is one `ssh vps true`, which itself makes 3 connection attempts of up to 20 s, so the
# worst case is about 5 minutes. Only this harmless command is retried, never a deploy: the
# commands that follow run once.
set -euo pipefail

: "${SSH_KEY:?}" "${KNOWN_HOSTS:?}" "${VPS_HOST:?}" "${VPS_USER:?}"
tries="${SSH_TRIES:-4}"
pause="${SSH_PAUSE:-15}"

install -d -m 700 ~/.ssh
printf '%s\n' "$SSH_KEY" > ~/.ssh/id_deploy
printf '%s\n' "$KNOWN_HOSTS" > ~/.ssh/known_hosts
# ServerAlive*: a connection that stops answering (mid-build) fails after 3 minutes instead of
# holding the job until its timeout.
cat > ~/.ssh/config <<EOF
Host vps
  HostName $VPS_HOST
  User $VPS_USER
  Port ${SSH_PORT:-22}
  IdentityFile ~/.ssh/id_deploy
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  BatchMode yes
  ConnectTimeout 20
  ConnectionAttempts 3
  ServerAliveInterval 30
  ServerAliveCountMax 6
EOF
chmod 600 ~/.ssh/id_deploy ~/.ssh/known_hosts ~/.ssh/config

for try in $(seq 1 "$tries"); do
  if ssh vps true; then
    [ "$try" -gt 1 ] && echo "::notice::The VPS answered on try $try of $tries"
    exit 0
  fi
  if [ "$try" -lt "$tries" ]; then
    echo "::warning::The VPS did not answer over SSH (try $try of $tries); trying again in ${pause}s"
    sleep "$pause"
  fi
done
echo "::error::The VPS did not answer over SSH after $tries tries"
exit 1
