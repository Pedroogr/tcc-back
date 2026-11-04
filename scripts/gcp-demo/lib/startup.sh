#!/usr/bin/env bash
set -euo pipefail

GCP_DEMO_FRONT_ROOT="${GCP_DEMO_FRONT_ROOT:-$GCP_DEMO_REPO_ROOT/../tcc-front}"
GCP_DEMO_MODEL_PATH="${GCP_DEMO_MODEL_PATH:-$GCP_DEMO_REPO_ROOT/gesture-poc/yolo11s-pose.pt}"
GCP_DEMO_MODEL_SHA256="${GCP_DEMO_MODEL_SHA256:-1060bda4a27012060eca246f9b2adeea22eabb045a1e58f8d229be29b7ebc2ba}"
GCP_DEMO_CLEANUP_REQUIRED=0
GCP_DEMO_CLEANUP_DONE=0

preflight() {
  if (( BASH_VERSINFO[0] < 4 )); then
    printf 'Bash 4 or newer is required\n' >&2
    return 1
  fi

  local command_name
  for command_name in awk curl docker getent jq nvidia-smi openssl sha256sum; do
    command -v "$command_name" >/dev/null 2>&1 || {
      printf 'required host command is missing: %s\n' "$command_name" >&2
      return 1
    }
  done
  if ! docker compose version >/dev/null 2>&1 &&
    ! command -v docker-compose >/dev/null 2>&1; then
    printf 'Docker Compose is required\n' >&2
    return 1
  fi
  docker info >/dev/null
  nvidia-smi >/dev/null

  [[ -e "$GCP_DEMO_REPO_ROOT/.git" ]] || {
    printf 'backend repository metadata is missing\n' >&2
    return 1
  }
  [[ -e "$GCP_DEMO_FRONT_ROOT/.git" ]] || {
    printf 'sibling frontend repository is missing\n' >&2
    return 1
  }
  [[ -f "$GCP_DEMO_MODEL_PATH" ]] || {
    printf 'gesture model is missing\n' >&2
    return 1
  }

  local actual_hash
  actual_hash="$(sha256sum "$GCP_DEMO_MODEL_PATH" | awk '{print $1}')"
  [[ "$actual_hash" == "$GCP_DEMO_MODEL_SHA256" ]] || {
    printf 'gesture model hash mismatch\n' >&2
    return 1
  }

  docker run --rm --gpus all \
    nvidia/cuda:13.0.0-base-ubuntu22.04 nvidia-smi >/dev/null
}

assert_no_active_runtime() {
  local -a running=()
  mapfile -t running < <(
    docker ps -q --filter "label=com.docker.compose.project=$GCP_DEMO_PROJECT_NAME"
  )
  if (( ${#running[@]} > 0 )); then
    printf 'the demo project already has running containers\n' >&2
    return 1
  fi

  local -a existing=()
  mapfile -t existing < <(
    docker ps -aq --filter "label=com.docker.compose.project=$GCP_DEMO_PROJECT_NAME"
  )
  local container labels actual_project actual_configs
  for container in "${existing[@]}"; do
    labels="$(docker inspect "$container")"
    actual_project="$(jq -r '.[0].Config.Labels["com.docker.compose.project"] // ""' <<< "$labels")"
    actual_configs="$(jq -r '.[0].Config.Labels["com.docker.compose.project.config_files"] // ""' <<< "$labels")"
    assert_owned_project \
      "$actual_project" \
      "$actual_configs" \
      "$GCP_DEMO_PROJECT_NAME" \
      "$GCP_DEMO_COMPOSE_FILE"
  done
}

_load_env_file() {
  local path="$1"
  [[ -f "$path" ]] || return 1
  set -a
  # shellcheck disable=SC1090
  source "$path"
  set +a
}

prepare_runtime_state() {
  local volume_exists=false
  if docker volume inspect "${GCP_DEMO_PROJECT_NAME}_postgres-data" >/dev/null 2>&1; then
    volume_exists=true
  fi
  ensure_persistent_state "$GCP_DEMO_STATE_DIR" "$volume_exists"
  _load_env_file "$GCP_DEMO_STATE_DIR/persistent.env"

  export JWT_SECRET GESTURE_TOKEN DEMO_PASSWORD
  JWT_SECRET="$(openssl rand -hex 32)"
  GESTURE_TOKEN="$(openssl rand -hex 32)"
  DEMO_PASSWORD="$(openssl rand -hex 16)"
  write_run_env \
    "$GCP_DEMO_STATE_DIR/run.env" \
    'https://pending.trycloudflare.com'
}

build_images() {
  compose --profile tools build api migrate worker gateway
}

phase1_up() {
  compose up -d --wait postgres gateway cloudflared
}

discover_public_origin() {
  local deadline logs origin
  deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    logs="$(compose logs --no-color cloudflared 2>/dev/null || true)"
    if origin="$(printf '%s\n' "$logs" | extract_quick_tunnel_url)"; then
      printf '%s\n' "$origin"
      return 0
    fi
    sleep 1
  done
  printf 'Quick Tunnel URL was not announced in time\n' >&2
  return 1
}

apply_public_origin() {
  local origin="$1"
  write_run_env "$GCP_DEMO_STATE_DIR/run.env" "$origin"
  export PUBLIC_ORIGIN="$origin"
  export FRONTEND_URL="$origin"
  export GESTURE_ALLOWED_ORIGINS="$origin"
}

migrate_and_seed() {
  compose --profile tools run --rm migrate
}

phase2_up() {
  compose up -d --wait api worker
  compose exec -T worker python -c \
    'import torch; raise SystemExit(0 if torch.cuda.is_available() else 1)'
}

smoke_public_stack() {
  local hostname websocket_url image_tag
  hostname="${PUBLIC_ORIGIN#https://}"
  getent hosts "$hostname" >/dev/null
  wait_http "$PUBLIC_ORIGIN/"
  wait_http "$PUBLIC_ORIGIN/api/auctions/public"

  image_tag="${IMAGE_TAG:-local}"
  docker run --rm \
    --network "${GCP_DEMO_PROJECT_NAME}_edge" \
    "tcc-demo-api-tools:$image_tag" \
    node scripts/gcp-demo/socket-smoke.js --url "$PUBLIC_ORIGIN"

  websocket_url="wss://${hostname}/v1/pose"
  docker run --rm \
    --network "${GCP_DEMO_PROJECT_NAME}_edge" \
    --env-file "$GCP_DEMO_STATE_DIR/run.env" \
    "tcc-demo-worker:$image_tag" \
    python scripts/public_smoke.py \
    --url "$websocket_url" \
    --origin "$PUBLIC_ORIGIN"
}

publish_summary() {
  umask 077
  local manifest temp_file
  manifest="$GCP_DEMO_STATE_DIR/manifest.env"
  temp_file="$(mktemp "$GCP_DEMO_STATE_DIR/.manifest.env.XXXXXX")"
  printf '%s\n' \
    "COMPOSE_PROJECT_NAME=$GCP_DEMO_PROJECT_NAME" \
    "COMPOSE_FILE=$(realpath -m "$GCP_DEMO_COMPOSE_FILE")" \
    "PUBLIC_ORIGIN=$PUBLIC_ORIGIN" > "$temp_file"
  chmod 600 "$temp_file"
  mv -f -- "$temp_file" "$manifest"

  printf '\nDemonstração pronta\n'
  printf 'URL: %s\n' "$PUBLIC_ORIGIN"
  printf 'Leiloeira: escritorio.demo@tcc.local\n'
  printf 'Comprador: comprador.demo@tcc.local\n'
  printf 'Senha demo: %s\n' "$DEMO_PASSWORD"
  printf 'Token de gestos: %s\n' "$GESTURE_TOKEN"
}

cleanup_incomplete() {
  if (( GCP_DEMO_CLEANUP_DONE == 1 )); then
    return 0
  fi
  GCP_DEMO_CLEANUP_DONE=1
  if (( GCP_DEMO_CLEANUP_REQUIRED == 1 )); then
    compose down --remove-orphans || true
  fi
  GCP_DEMO_CLEANUP_REQUIRED=0
}

startup_exit_trap() {
  local status="$1"
  if (( status != 0 && GCP_DEMO_CLEANUP_REQUIRED == 1 )); then
    cleanup_incomplete
  fi
  return "$status"
}

run_startup() {
  GCP_DEMO_CLEANUP_REQUIRED=0
  GCP_DEMO_CLEANUP_DONE=0

  preflight || return 1
  assert_no_active_runtime || return 1
  prepare_runtime_state || return 1
  build_images || return 1

  GCP_DEMO_CLEANUP_REQUIRED=1
  if ! phase1_up; then
    cleanup_incomplete
    return 1
  fi

  local public_origin
  if ! public_origin="$(discover_public_origin)"; then
    cleanup_incomplete
    return 1
  fi
  if ! apply_public_origin "$public_origin"; then
    cleanup_incomplete
    return 1
  fi
  if ! migrate_and_seed; then
    cleanup_incomplete
    return 1
  fi
  if ! phase2_up; then
    cleanup_incomplete
    return 1
  fi
  if ! smoke_public_stack; then
    cleanup_incomplete
    return 1
  fi
  if ! publish_summary; then
    cleanup_incomplete
    return 1
  fi

  GCP_DEMO_CLEANUP_REQUIRED=0
}
