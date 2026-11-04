#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
source "$repo_root/scripts/gcp-demo/tests/test-helper.sh"
source "$repo_root/scripts/gcp-demo/lib/runtime.sh"
source "$repo_root/scripts/gcp-demo/lib/startup.sh"

temp_root="$(mktemp -d)"
cleanup() {
  rm -rf -- "$temp_root"
}
trap cleanup EXIT

missing_state="$temp_root/missing-preflight-state"
if PATH="$temp_root/empty-path" GCP_DEMO_STATE_DIR="$missing_state" preflight >/dev/null 2>&1; then
  fail 'preflight unexpectedly passed without required commands'
fi
[[ ! -e "$missing_state" ]] || fail 'preflight created runtime state before validation'

active_log="$temp_root/active.log"
(
  preflight() { printf 'preflight\n' >> "$active_log"; }
  assert_no_active_runtime() { printf 'active\n' >> "$active_log"; return 1; }
  prepare_runtime_state() { printf 'prepare\n' >> "$active_log"; }
  assert_failure run_startup
)
assert_equal $'preflight\nactive' "$(cat "$active_log")" 'active runtime refusal'

migration_log="$temp_root/migration.log"
(
  preflight() { printf 'preflight\n' >> "$migration_log"; }
  assert_no_active_runtime() { printf 'ownership\n' >> "$migration_log"; }
  prepare_runtime_state() { printf 'prepare\n' >> "$migration_log"; }
  build_images() { printf 'build\n' >> "$migration_log"; }
  phase1_up() { printf 'phase1\n' >> "$migration_log"; }
  discover_public_origin() { printf 'url\n' >> "$migration_log"; printf 'https://demo.trycloudflare.com\n'; }
  apply_public_origin() { printf 'origin\n' >> "$migration_log"; }
  migrate_and_seed() { printf 'migrate\n' >> "$migration_log"; return 1; }
  phase2_up() { printf 'phase2\n' >> "$migration_log"; }
  smoke_public_stack() { printf 'smoke\n' >> "$migration_log"; }
  publish_summary() { printf 'publish\n' >> "$migration_log"; }
  cleanup_incomplete() {
    GCP_DEMO_CLEANUP_DONE=1
    GCP_DEMO_CLEANUP_REQUIRED=0
    printf 'cleanup\n' >> "$migration_log"
  }
  assert_failure run_startup
)
grep -Fq 'migrate' "$migration_log" || fail 'migration was not attempted'
grep -Fq 'cleanup' "$migration_log" || fail 'migration failure did not clean up'
if grep -Eq 'phase2|smoke|publish' "$migration_log"; then
  fail 'migration failure started or published later phases'
fi

smoke_log="$temp_root/smoke.log"
(
  preflight() { :; }
  assert_no_active_runtime() { :; }
  prepare_runtime_state() { :; }
  build_images() { :; }
  phase1_up() { :; }
  discover_public_origin() { printf 'https://demo.trycloudflare.com\n'; }
  apply_public_origin() { :; }
  migrate_and_seed() { :; }
  phase2_up() { :; }
  smoke_public_stack() { return 1; }
  publish_summary() { printf 'publish\n' >> "$smoke_log"; }
  compose() { printf '%s\n' "$*" >> "$smoke_log"; }
  assert_failure run_startup
)
assert_equal 'down --remove-orphans' "$(cat "$smoke_log")" 'smoke cleanup command'
[[ "$(grep -Fc 'down --remove-orphans' "$smoke_log")" -eq 1 ]] || fail 'cleanup ran more than once'
if grep -Fq -- '--volumes' "$smoke_log"; then
  fail 'incomplete cleanup removed persistent volumes'
fi

origin_state="$temp_root/origin-state"
mkdir -p "$origin_state"
export GCP_DEMO_STATE_DIR="$origin_state"
export POSTGRES_USER=tcc
export POSTGRES_DB=cattle_auction_demo
export POSTGRES_PASSWORD=postgres-secret
export JWT_SECRET=jwt-secret
export DEMO_PASSWORD=demo-secret
export GESTURE_TOKEN=gesture-secret
write_run_env "$origin_state/run.env" 'https://pending.trycloudflare.com'
apply_public_origin 'https://final.trycloudflare.com'
grep -Fxq 'FRONTEND_URL=https://final.trycloudflare.com' "$origin_state/run.env" ||
  fail 'frontend origin was not updated'
grep -Fxq 'GESTURE_ALLOWED_ORIGINS=https://final.trycloudflare.com' "$origin_state/run.env" ||
  fail 'gesture origin was not updated'
grep -Fq 'PUBLIC_ORIGIN=https://final.trycloudflare.com' "$origin_state/run.env" ||
  fail 'public origin was not updated'

success_log="$temp_root/success.log"
(
  preflight() { printf 'preflight\n' >> "$success_log"; }
  assert_no_active_runtime() { :; }
  prepare_runtime_state() { :; }
  build_images() { printf 'build\n' >> "$success_log"; }
  phase1_up() { printf 'phase1\n' >> "$success_log"; }
  discover_public_origin() { printf 'url\n' >> "$success_log"; printf 'https://demo.trycloudflare.com\n'; }
  apply_public_origin() { :; }
  migrate_and_seed() { printf 'migrate\n' >> "$success_log"; }
  phase2_up() { printf 'phase2\n' >> "$success_log"; }
  smoke_public_stack() { printf 'smoke\n' >> "$success_log"; }
  publish_summary() { printf 'publish\n' >> "$success_log"; }
  run_startup
)
assert_equal \
  $'preflight\nbuild\nphase1\nurl\nmigrate\nphase2\nsmoke\npublish' \
  "$(cat "$success_log")" \
  'successful startup order'

printf 'startup tests: PASS\n'
