#!/usr/bin/env bash
set -euo pipefail

GCP_DEMO_REPO_ROOT="${GCP_DEMO_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
GCP_DEMO_STATE_DIR="${GCP_DEMO_STATE_DIR:-$GCP_DEMO_REPO_ROOT/.runtime}"
GCP_DEMO_COMPOSE_FILE="${GCP_DEMO_COMPOSE_FILE:-$GCP_DEMO_REPO_ROOT/deploy/gcp/compose.yaml}"
GCP_DEMO_PROJECT_NAME="${GCP_DEMO_PROJECT_NAME:-tcc-gpu-demo}"

extract_quick_tunnel_url() {
  local input
  if (( $# > 0 )); then
    input="$(printf '%s\n' "$@")"
  else
    input="$(cat)"
  fi

  local -a urls=()
  mapfile -t urls < <(
    printf '%s\n' "$input" |
      grep -Eo 'https://[a-z0-9]+([a-z0-9-]*[a-z0-9])?\.trycloudflare\.com' |
      sort -u || true
  )
  [[ ${#urls[@]} -eq 1 ]] || return 1
  printf '%s\n' "${urls[0]}"
}

ensure_persistent_state() {
  local state_dir="$1"
  local volume_exists="$2"
  local persistent_file="$state_dir/persistent.env"

  if [[ -f "$persistent_file" ]]; then
    chmod 600 "$persistent_file"
    return 0
  fi
  if [[ "$volume_exists" == 'true' ]]; then
    printf 'persistent state is missing for the existing database volume\n' >&2
    return 1
  fi
  [[ "$volume_exists" == 'false' ]] || {
    printf 'volume_exists must be true or false\n' >&2
    return 1
  }

  umask 077
  mkdir -p "$state_dir"
  chmod 700 "$state_dir"

  local password temp_file
  password="$(openssl rand -hex 32)"
  temp_file="$(mktemp "$state_dir/.persistent.env.XXXXXX")"
  if ! printf '%s\n' \
    'POSTGRES_USER=tcc' \
    'POSTGRES_DB=cattle_auction_demo' \
    "POSTGRES_PASSWORD=$password" > "$temp_file"; then
    rm -f -- "$temp_file"
    return 1
  fi
  chmod 600 "$temp_file"
  mv -f -- "$temp_file" "$persistent_file"
}

_require_env_value() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" || "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    printf 'required runtime environment is invalid\n' >&2
    return 1
  fi
}

write_run_env() {
  local target="$1"
  local origin="$2"
  if [[ ! "$origin" =~ ^https://[a-z0-9]+([a-z0-9-]*[a-z0-9])?\.trycloudflare\.com$ ]]; then
    printf 'public origin must be an exact trycloudflare HTTPS origin\n' >&2
    return 1
  fi

  local name
  for name in \
    POSTGRES_USER POSTGRES_DB POSTGRES_PASSWORD \
    JWT_SECRET DEMO_PASSWORD GESTURE_TOKEN; do
    _require_env_value "$name" || return 1
  done

  umask 077
  local target_dir temp_file database_url
  target_dir="$(dirname "$target")"
  mkdir -p "$target_dir"
  chmod 700 "$target_dir"
  temp_file="$(mktemp "$target_dir/.run.env.XXXXXX")"
  database_url="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}"

  if ! printf '%s\n' \
    "DATABASE_URL=$database_url" \
    "JWT_SECRET=$JWT_SECRET" \
    "DEMO_PASSWORD=$DEMO_PASSWORD" \
    "GESTURE_TOKEN=$GESTURE_TOKEN" \
    "PUBLIC_ORIGIN=$origin" \
    "FRONTEND_URL=$origin" \
    "GESTURE_ALLOWED_ORIGINS=$origin" > "$temp_file"; then
    rm -f -- "$temp_file"
    return 1
  fi
  chmod 600 "$temp_file"
  mv -f -- "$temp_file" "$target"
}

compose() {
  local -a common=(
    --project-name "$GCP_DEMO_PROJECT_NAME"
    --env-file "$GCP_DEMO_STATE_DIR/persistent.env"
    --env-file "$GCP_DEMO_STATE_DIR/run.env"
    -f "$GCP_DEMO_COMPOSE_FILE"
  )
  if docker compose version >/dev/null 2>&1; then
    docker compose "${common[@]}" "$@"
  else
    docker-compose "${common[@]}" "$@"
  fi
}

assert_owned_project() {
  local actual_project="$1"
  local actual_config_files="$2"
  local expected_project="$3"
  local expected_config_file
  expected_config_file="$(realpath -m "$4")"

  [[ "$actual_project" == "$expected_project" ]] || {
    printf 'compose project ownership mismatch\n' >&2
    return 1
  }

  local candidate
  local -a config_files=()
  IFS=',' read -r -a config_files <<< "$actual_config_files"
  for candidate in "${config_files[@]}"; do
    candidate="${candidate#"${candidate%%[![:space:]]*}"}"
    candidate="${candidate%"${candidate##*[![:space:]]}"}"
    if [[ "$(realpath -m "$candidate")" == "$expected_config_file" ]]; then
      return 0
    fi
  done

  printf 'compose config ownership mismatch\n' >&2
  return 1
}

wait_http() {
  local url="$1"
  local attempts="${2:-30}"
  local delay_seconds="${3:-1}"
  local attempt
  for (( attempt = 1; attempt <= attempts; attempt++ )); do
    if curl --fail --silent --show-error --max-time 5 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay_seconds"
  done
  printf 'HTTP endpoint did not become ready\n' >&2
  return 1
}
