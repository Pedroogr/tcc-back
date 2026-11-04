#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
export UV_CACHE_DIR="${UV_CACHE_DIR:-$repo_root/.uv-cache-plan}"

while IFS= read -r -d '' script; do
  bash -n "$script"
done < <(find "$repo_root/scripts/gcp-demo" -type f -name '*.sh' -print0)

bash "$repo_root/scripts/gcp-demo/tests/runtime.test.sh"
bash "$repo_root/scripts/gcp-demo/tests/startup.test.sh"
bash "$repo_root/scripts/gcp-demo/tests/lifecycle.test.sh"
node --test "$repo_root/scripts/gcp-demo/tests/compose-contract.test.js"
node --test "$repo_root/scripts/gcp-demo/tests/socket-smoke.test.js"
(
  cd "$repo_root/gesture-server"
  uv run python -m pytest tests/test_public_smoke.py -q
)

printf 'gcp demo unit tests: PASS\n'
