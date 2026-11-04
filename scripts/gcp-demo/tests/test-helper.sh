#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_equal() {
  local expected="$1"
  local actual="$2"
  local label="${3:-values differ}"
  [[ "$actual" == "$expected" ]] || fail "$label: expected '$expected', got '$actual'"
}

assert_failure() {
  if "$@"; then
    fail "command unexpectedly succeeded: $*"
  fi
}

assert_file_mode() {
  local expected="$1"
  local path="$2"
  assert_equal "$expected" "$(stat -c '%a' "$path")" "mode for $path"
}
