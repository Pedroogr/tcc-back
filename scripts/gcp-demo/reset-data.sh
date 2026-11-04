#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/gcp-demo/lib/runtime.sh
source "$repo_root/scripts/gcp-demo/lib/runtime.sh"
# shellcheck source=scripts/gcp-demo/lib/lifecycle.sh
source "$repo_root/scripts/gcp-demo/lib/lifecycle.sh"

reset_main() {
  if [[ $# -ne 2 || "$1" != '--confirm' || "$2" != 'DELETE-DEMO-DATA' ]]; then
    printf 'reset requires --confirm DELETE-DEMO-DATA\n' >&2
    return 2
  fi
  if [[ -n "$(running_project_container_ids)" ]]; then
    printf 'stop the demo stack before resetting data\n' >&2
    return 1
  fi

  validate_owned_containers || return 1
  validate_owned_volume "${GCP_DEMO_PROJECT_NAME}_postgres-data" || return 1
  validate_owned_volume "${GCP_DEMO_PROJECT_NAME}_uploads" || return 1
  prepare_compose_for_down || return 1
  compose down --volumes --remove-orphans || return 1
  remove_owned_volume "${GCP_DEMO_PROJECT_NAME}_postgres-data" || return 1
  remove_owned_volume "${GCP_DEMO_PROJECT_NAME}_uploads" || return 1

  rm -f -- \
    "$GCP_DEMO_STATE_DIR/persistent.env" \
    "$GCP_DEMO_STATE_DIR/run.env" \
    "$GCP_DEMO_STATE_DIR/manifest.env"
  printf 'status=data-reset\n'
}

if [[ "${GCP_DEMO_SOURCE_ONLY:-0}" != '1' ]]; then
  reset_main "$@"
fi
