#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$repo_root/scripts/gcp-demo/tests/test-helper.sh"
source "$repo_root/scripts/gcp-demo/lib/runtime.sh"

temp_root="$(mktemp -d)"
cleanup() {
  rm -rf -- "$temp_root"
}
trap cleanup EXIT

status_state="$temp_root/status"
mkdir -p "$status_state"
cat > "$status_state/manifest.env" <<'EOF'
COMPOSE_PROJECT_NAME=tcc-gpu-demo
COMPOSE_FILE=/expected/compose.yaml
PUBLIC_ORIGIN=https://ready.trycloudflare.com
EOF
export GCP_DEMO_STATE_DIR="$status_state"
export GESTURE_TOKEN='status-gesture-secret'
export JWT_SECRET='status-jwt-secret'
export POSTGRES_PASSWORD='status-postgres-secret'
export DEMO_PASSWORD='status-demo-secret'

status_output="$({
  GCP_DEMO_SOURCE_ONLY=1 source "$repo_root/scripts/gcp-demo/status.sh"
  current_tunnel_origin() { printf 'https://ready.trycloudflare.com\n'; }
  compose_services_ready() { return 0; }
  internal_health_ready() { return 0; }
  wait_http() { return 0; }
  status_main
} 2>&1)"
[[ "$status_output" == *'status=ready'* ]] || fail 'ready status was not reported'
for secret in "$GESTURE_TOKEN" "$JWT_SECRET" "$POSTGRES_PASSWORD" "$DEMO_PASSWORD"; do
  [[ "$status_output" != *"$secret"* ]] || fail 'status leaked a secret'
done

invalid_output="$({
  GCP_DEMO_SOURCE_ONLY=1 source "$repo_root/scripts/gcp-demo/status.sh"
  current_tunnel_origin() { printf 'https://other.trycloudflare.com\n'; }
  status_main
} 2>&1 || true)"
[[ "$invalid_output" == *'status=invalid'* ]] || fail 'tunnel hostname mismatch was not invalid'

stop_log="$temp_root/stop.log"
if (
  GCP_DEMO_SOURCE_ONLY=1 source "$repo_root/scripts/gcp-demo/stop.sh"
  project_container_ids() { printf 'foreign-container\n'; }
  validate_owned_containers() { return 1; }
  compose() { printf '%s\n' "$*" >> "$stop_log"; }
  stop_main
); then
  fail 'stop accepted foreign labels'
fi
[[ ! -s "$stop_log" ]] || fail 'stop called Compose for foreign labels'

(
  GCP_DEMO_SOURCE_ONLY=1 source "$repo_root/scripts/gcp-demo/stop.sh"
  project_container_ids() { printf 'owned-container\n'; }
  validate_owned_containers() { return 0; }
  prepare_compose_for_down() { :; }
  compose() { printf '%s\n' "$*" >> "$stop_log"; }
  stop_main
)
assert_equal 'down --remove-orphans' "$(cat "$stop_log")" 'safe stop command'
if grep -Fq -- '--volumes' "$stop_log"; then
  fail 'stop removed volumes'
fi

reset_log="$temp_root/reset.log"
reset_state="$temp_root/reset-state"
mkdir -p "$reset_state"
touch "$reset_state/persistent.env" "$reset_state/run.env" "$reset_state/manifest.env"

for arguments in '' '--confirm WRONG'; do
  if (
    GCP_DEMO_STATE_DIR="$reset_state"
    GCP_DEMO_SOURCE_ONLY=1 source "$repo_root/scripts/gcp-demo/reset-data.sh"
    compose() { printf '%s\n' "$*" >> "$reset_log"; }
    # shellcheck disable=SC2086
    reset_main $arguments
  ); then
    fail 'reset accepted missing or incorrect confirmation'
  fi
done
[[ ! -s "$reset_log" ]] || fail 'unconfirmed reset called Compose'

if (
  GCP_DEMO_STATE_DIR="$reset_state"
  GCP_DEMO_SOURCE_ONLY=1 source "$repo_root/scripts/gcp-demo/reset-data.sh"
  running_project_container_ids() { printf 'active-container\n'; }
  compose() { printf '%s\n' "$*" >> "$reset_log"; }
  reset_main --confirm DELETE-DEMO-DATA
); then
  fail 'reset accepted an active stack'
fi
[[ ! -s "$reset_log" ]] || fail 'active reset called Compose'

(
  export GCP_DEMO_STATE_DIR="$reset_state"
  GCP_DEMO_SOURCE_ONLY=1 source "$repo_root/scripts/gcp-demo/reset-data.sh"
  running_project_container_ids() { :; }
  validate_owned_containers() { :; }
  validate_owned_volume() { :; }
  prepare_compose_for_down() { :; }
  compose() { printf 'compose:%s\n' "$*" >> "$reset_log"; }
  remove_owned_volume() {
    [[ -f "$reset_state/persistent.env" ]] || fail 'credential removed before volumes'
    printf 'volume:%s\n' "$1" >> "$reset_log"
  }
  reset_main --confirm DELETE-DEMO-DATA
)
assert_equal \
  $'compose:down --volumes --remove-orphans\nvolume:tcc-gpu-demo_postgres-data\nvolume:tcc-gpu-demo_uploads' \
  "$(cat "$reset_log")" \
  'confirmed reset order'
for state_file in persistent.env run.env manifest.env; do
  [[ ! -e "$reset_state/$state_file" ]] || fail "$state_file survived reset"
done

printf 'lifecycle tests: PASS\n'
