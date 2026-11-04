#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/gcp-demo/lib/runtime.sh
source "$repo_root/scripts/gcp-demo/lib/runtime.sh"
# shellcheck source=scripts/gcp-demo/lib/lifecycle.sh
source "$repo_root/scripts/gcp-demo/lib/lifecycle.sh"

stop_main() {
  local containers
  containers="$(project_container_ids)"
  if [[ -z "$containers" ]]; then
    printf 'status=stopped\n'
    return 0
  fi
  validate_owned_containers || return 1
  prepare_compose_for_down || return 1
  compose down --remove-orphans || return 1
  printf 'status=stopped\n'
}

if [[ "${GCP_DEMO_SOURCE_ONLY:-0}" != '1' ]]; then
  stop_main "$@"
fi
