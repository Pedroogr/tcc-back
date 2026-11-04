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

noisy_log=$'noise before\nhttps://demo-123.trycloudflare.com\nnoise after'
assert_equal \
  'https://demo-123.trycloudflare.com' \
  "$(printf '%s\n' "$noisy_log" | extract_quick_tunnel_url)" \
  'quick tunnel URL extraction'

assert_failure extract_quick_tunnel_url <<< 'no URL here'
assert_failure extract_quick_tunnel_url <<'EOF'
https://first.trycloudflare.com
https://second.trycloudflare.com
EOF

state_dir="$temp_root/state"
ensure_persistent_state "$state_dir" false
persistent_file="$state_dir/persistent.env"
[[ -f "$persistent_file" ]] || fail 'persistent.env was not created'
assert_file_mode 600 "$persistent_file"
first_contents="$(cat "$persistent_file")"
[[ "$first_contents" == *'POSTGRES_DB=cattle_auction_demo'* ]] || fail 'demo database missing'
[[ "$first_contents" == *'POSTGRES_PASSWORD='* ]] || fail 'database password missing'

ensure_persistent_state "$state_dir" false
assert_equal "$first_contents" "$(cat "$persistent_file")" 'persistent password reuse'

orphan_state="$temp_root/orphan"
assert_failure ensure_persistent_state "$orphan_state" true
[[ ! -e "$orphan_state/persistent.env" ]] || fail 'orphan state created a credential'

export POSTGRES_USER=tcc
export POSTGRES_DB=cattle_auction_demo
export POSTGRES_PASSWORD=postgres-secret-for-test
export JWT_SECRET=jwt-secret-for-test
export DEMO_PASSWORD=demo-secret-for-test
export GESTURE_TOKEN=gesture-secret-for-test

run_env="$state_dir/run.env"
origin='https://demo-123.trycloudflare.com'
write_run_env "$run_env" "$origin"
assert_file_mode 600 "$run_env"
assert_equal 3 "$(grep -Fc "$origin" "$run_env")" 'public origin fan-out'
grep -Fq 'DATABASE_URL=postgresql://tcc:postgres-secret-for-test@postgres:5432/cattle_auction_demo' "$run_env" ||
  fail 'DATABASE_URL was not written from the environment'

for invalid_origin in \
  'http://demo-123.trycloudflare.com' \
  'https://demo-123.trycloudflare.com/path' \
  'https://trycloudflare.com' \
  'https://demo.example.com' \
  'https://demo-123.trycloudflare.com:443'; do
  assert_failure write_run_env "$temp_root/invalid.env" "$invalid_origin"
done

expected_config="$(realpath -m "$repo_root/deploy/gcp/compose.yaml")"
assert_owned_project \
  'tcc-gpu-demo' \
  "$expected_config" \
  'tcc-gpu-demo' \
  "$expected_config"
assert_failure assert_owned_project \
  'foreign-project' \
  "$expected_config" \
  'tcc-gpu-demo' \
  "$expected_config"
assert_failure assert_owned_project \
  'tcc-gpu-demo' \
  "$temp_root/foreign-compose.yaml" \
  'tcc-gpu-demo' \
  "$expected_config"

for secret in \
  "$POSTGRES_PASSWORD" \
  "$JWT_SECRET" \
  "$DEMO_PASSWORD" \
  "$GESTURE_TOKEN"; do
  output="$(assert_failure write_run_env "$temp_root/invalid.env" 'http://invalid.example' 2>&1)"
  [[ "$output" != *"$secret"* ]] || fail 'secret leaked in validation output'
done

printf 'runtime tests: PASS\n'
