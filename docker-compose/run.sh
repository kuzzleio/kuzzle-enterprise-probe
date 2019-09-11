#!/bin/sh

set -e

log () {
  echo "[$(date --rfc-3339 seconds)] - $1"
}

log "Install plugins..."

/var/app/install-plugins.sh

log "Starting Kuzzle..."

exec ./bin/kuzzle start
