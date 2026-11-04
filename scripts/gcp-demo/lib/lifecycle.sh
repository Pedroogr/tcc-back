#!/usr/bin/env bash
set -euo pipefail

project_container_ids() {
  docker ps -aq --filter "label=com.docker.compose.project=$GCP_DEMO_PROJECT_NAME"
}

running_project_container_ids() {
  docker ps -q --filter "label=com.docker.compose.project=$GCP_DEMO_PROJECT_NAME"
}

validate_owned_containers() {
  local container labels actual_project actual_configs
  while IFS= read -r container; do
    [[ -n "$container" ]] || continue
    labels="$(docker inspect "$container")"
    actual_project="$(jq -r '.[0].Config.Labels["com.docker.compose.project"] // ""' <<< "$labels")"
    actual_configs="$(jq -r '.[0].Config.Labels["com.docker.compose.project.config_files"] // ""' <<< "$labels")"
    assert_owned_project \
      "$actual_project" \
      "$actual_configs" \
      "$GCP_DEMO_PROJECT_NAME" \
      "$GCP_DEMO_COMPOSE_FILE"
  done < <(project_container_ids)
}

validate_owned_volume() {
  local volume="$1"
  local details actual_project
  if ! details="$(docker volume inspect "$volume" 2>/dev/null)"; then
    return 0
  fi
  actual_project="$(jq -r '.[0].Labels["com.docker.compose.project"] // ""' <<< "$details")"
  [[ "$actual_project" == "$GCP_DEMO_PROJECT_NAME" ]] || {
    printf 'volume ownership mismatch\n' >&2
    return 1
  }
}

remove_owned_volume() {
  local volume="$1"
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    validate_owned_volume "$volume"
    docker volume rm "$volume" >/dev/null
  fi
}

prepare_compose_for_down() {
  export POSTGRES_USER="${POSTGRES_USER:-tcc}"
  export POSTGRES_DB="${POSTGRES_DB:-cattle_auction_demo}"
  export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-reset-placeholder}"
  export DATABASE_URL="${DATABASE_URL:-postgresql://tcc:reset-placeholder@postgres:5432/cattle_auction_demo}"
  export JWT_SECRET="${JWT_SECRET:-reset-placeholder}"
  export DEMO_PASSWORD="${DEMO_PASSWORD:-reset-placeholder}"
  export GESTURE_TOKEN="${GESTURE_TOKEN:-reset-placeholder}"
  export FRONTEND_URL="${FRONTEND_URL:-https://pending.trycloudflare.com}"
  export GESTURE_ALLOWED_ORIGINS="${GESTURE_ALLOWED_ORIGINS:-https://pending.trycloudflare.com}"
}
