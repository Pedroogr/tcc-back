#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/gcp-demo/lib/runtime.sh
source "$repo_root/scripts/gcp-demo/lib/runtime.sh"
# shellcheck source=scripts/gcp-demo/lib/startup.sh
source "$repo_root/scripts/gcp-demo/lib/startup.sh"

trap 'startup_exit_trap "$?"' EXIT
run_startup
