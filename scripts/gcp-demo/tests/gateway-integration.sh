#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
fixture_source="$repo_root/scripts/gcp-demo/tests/gateway-fixture.js"
caddyfile_source="$repo_root/deploy/gcp/Caddyfile"
temp_dir="$(mktemp -d)"
suffix="$$-${RANDOM}"
network="tcc-gateway-test-$suffix"
fixture="tcc-gateway-fixture-$suffix"
gateway="tcc-gateway-$suffix"

to_host_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    realpath "$1"
  fi
}

docker_cmd() {
  MSYS_NO_PATHCONV=1 docker "$@"
}

cleanup() {
  docker_cmd rm -f "$gateway" "$fixture" >/dev/null 2>&1 || true
  docker_cmd network rm "$network" >/dev/null 2>&1 || true
  rm -rf -- "$temp_dir"
}
trap cleanup EXIT

fail() {
  printf 'gateway integration failed: %s\n' "$1" >&2
  docker_cmd logs "$gateway" >&2 || true
  docker_cmd logs "$fixture" >&2 || true
  exit 1
}

assert_equal() {
  local expected="$1"
  local actual="$2"
  local label="$3"
  [[ "$actual" == "$expected" ]] || fail "$label: expected '$expected', got '$actual'"
}

request() {
  local path="$1"
  docker_cmd run --rm \
    --network "$network" \
    --entrypoint wget \
    caddy:2.11.7-alpine \
    -qO- \
    --header='Host: exemplo.trycloudflare.com' \
    "http://gateway:8080$path"
}

printf 'demo-index' > "$temp_dir/index.html"

fixture_host="$(to_host_path "$fixture_source")"
caddyfile_host="$(to_host_path "$caddyfile_source")"
static_host="$(to_host_path "$temp_dir")"

docker_cmd network create "$network" >/dev/null
docker_cmd run -d \
  --name "$fixture" \
  --network "$network" \
  --network-alias api \
  --network-alias worker \
  --mount "type=bind,source=$fixture_host,target=/fixture.js,readonly" \
  node:24.22.2-bookworm-slim \
  node /fixture.js >/dev/null

docker_cmd run -d \
  --name "$gateway" \
  --network "$network" \
  --network-alias gateway \
  --mount "type=bind,source=$caddyfile_host,target=/etc/caddy/Caddyfile,readonly" \
  --mount "type=bind,source=$static_host,target=/srv,readonly" \
  tcc-gateway:test >/dev/null

ready=''
for _ in $(seq 1 30); do
  if ready="$(request / 2>/dev/null)"; then
    break
  fi
  sleep 0.2
done
assert_equal 'demo-index' "$ready" 'gateway readiness'

assert_equal 'demo-index' "$(request /rota-do-react)" 'SPA fallback'
assert_equal '/marker' "$(request /api/marker)" 'API prefix removal'
assert_equal '/socket.io/marker' "$(request /socket.io/marker)" 'Socket.IO path preservation'
assert_equal '/v1/pose' "$(request /v1/pose)" 'pose path preservation'

printf 'gateway integration: PASS\n'
