#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/gcp-demo/lib/runtime.sh
source "$repo_root/scripts/gcp-demo/lib/runtime.sh"

manifest_origin() {
  local manifest="$GCP_DEMO_STATE_DIR/manifest.env"
  [[ -f "$manifest" ]] || return 1
  local origin
  origin="$(grep -m1 '^PUBLIC_ORIGIN=' "$manifest" | cut -d= -f2-)"
  [[ -n "$origin" ]] || return 1
  [[ "$(printf '%s\n' "$origin" | extract_quick_tunnel_url)" == "$origin" ]] || return 1
  printf '%s\n' "$origin"
}

current_tunnel_origin() {
  compose logs --no-color cloudflared 2>/dev/null | extract_quick_tunnel_url
}

compose_services_ready() {
  compose ps --format json 2>/dev/null | jq -e -s '
    def rows: if length == 1 and (.[0] | type) == "array" then .[0] else . end;
    ["api", "cloudflared", "gateway", "postgres", "worker"] as $required |
    (rows | map(select(.Service as $service | $required | index($service)))) as $selected |
    ($selected | length) == 5 and
    all($selected[];
      ((.State // "") | ascii_downcase) == "running" and
      (((.Health // "") == "") or (((.Health // "") | ascii_downcase) == "healthy"))
    )
  ' >/dev/null
}

internal_health_ready() {
  compose exec -T api node -e \
    "fetch('http://127.0.0.1:3000/auctions/public').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))" \
    >/dev/null 2>&1 &&
  compose exec -T worker python -c \
    "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/health', timeout=3).read()" \
    >/dev/null 2>&1
}

status_main() {
  local expected_origin observed_origin
  if ! expected_origin="$(manifest_origin)"; then
    printf 'status=invalid\n'
    return 2
  fi
  if ! observed_origin="$(current_tunnel_origin)" ||
    [[ "$observed_origin" != "$expected_origin" ]]; then
    printf 'status=invalid\n'
    return 2
  fi
  if compose_services_ready &&
    internal_health_ready &&
    wait_http "$expected_origin/" 1 0; then
    printf 'status=ready\nurl=%s\n' "$expected_origin"
    return 0
  fi
  printf 'status=degraded\nurl=%s\n' "$expected_origin"
  return 1
}

if [[ "${GCP_DEMO_SOURCE_ONLY:-0}" != '1' ]]; then
  status_main "$@"
fi
