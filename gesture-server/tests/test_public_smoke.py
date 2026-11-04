from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

import pytest
from websockets.sync.server import serve


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "public_smoke.py"
TOKEN = "public-smoke-secret-that-must-not-leak"
ORIGIN = "https://demo-123.trycloudflare.com"


def run_client(url: str, *, include_token: bool = True) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    if include_token:
        environment["GESTURE_TOKEN"] = TOKEN
    else:
        environment.pop("GESTURE_TOKEN", None)
    return subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--url",
            url,
            "--origin",
            ORIGIN,
            "--timeout",
            "2",
        ],
        check=False,
        capture_output=True,
        text=True,
        env=environment,
    )


def serve_once(response: dict[str, Any]) -> tuple[str, list[dict[str, Any]], Any, threading.Thread]:
    observed: list[dict[str, Any]] = []

    def handler(websocket: Any) -> None:
        assert websocket.request.headers["Origin"] == ORIGIN
        observed.append(json.loads(websocket.recv()))
        websocket.send(json.dumps(response))

    server = serve(handler, "127.0.0.1", 0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.socket.getsockname()[1]
    return f"ws://127.0.0.1:{port}", observed, server, thread


def stop_server(server: Any, thread: threading.Thread) -> None:
    server.shutdown()
    thread.join(timeout=2)


def test_public_smoke_sends_authenticated_hello_and_accepts_ready() -> None:
    url, observed, server, thread = serve_once({"type": "ready", "protocolVersion": 1})
    try:
        result = run_client(url)
    finally:
        stop_server(server, thread)

    assert result.returncode == 0, result.stderr
    assert observed == [{"type": "hello", "protocolVersion": 1, "token": TOKEN}]
    assert "gesture-smoke: ready" in result.stdout
    assert TOKEN not in result.stdout + result.stderr


@pytest.mark.parametrize(
    "response",
    [
        {"type": "error", "protocolVersion": 1, "code": "denied"},
        {"type": "ready", "protocolVersion": 2},
    ],
)
def test_public_smoke_rejects_error_or_wrong_version(response: dict[str, Any]) -> None:
    url, _observed, server, thread = serve_once(response)
    try:
        result = run_client(url)
    finally:
        stop_server(server, thread)

    assert result.returncode != 0
    assert "gesture-smoke: failed" in result.stderr
    assert TOKEN not in result.stdout + result.stderr


def test_public_smoke_requires_token_without_leaking_environment() -> None:
    result = run_client("ws://127.0.0.1:9", include_token=False)
    assert result.returncode != 0
    assert "gesture-smoke: failed" in result.stderr
    assert TOKEN not in result.stdout + result.stderr
