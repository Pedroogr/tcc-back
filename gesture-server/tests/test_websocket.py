from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.config import GestureSettings
from app.inference import InferenceError
from app.main import create_app
from app.protocol import PoseResult, PoseTimings


ALLOWED_ORIGIN = "http://station.test"
TOKEN = "correct-secret"


class FakeEngine:
    ready = True
    metadata = {
        "model": {"name": "yolo11s-pose", "sha256": "model-hash", "inputSize": 640},
        "device": {"type": "cuda", "name": "Fake CUDA 0"},
    }

    def __init__(self, error: InferenceError | None = None) -> None:
        self.error = error
        self.frames: list[bytes] = []

    def infer(self, jpeg: bytes) -> PoseResult:
        self.frames.append(jpeg)
        if self.error is not None:
            raise self.error
        return PoseResult(
            model_version="yolo11s-pose:model-ha",
            timings=PoseTimings(1.0, 2.0, 3.0, 4.0, 10.0),
            poses=(),
        )


class BlockingEngine(FakeEngine):
    def __init__(self) -> None:
        super().__init__()
        self.started = threading.Event()
        self.release = threading.Event()

    def infer(self, jpeg: bytes) -> PoseResult:
        self.started.set()
        if not self.release.wait(timeout=2):
            raise RuntimeError("test did not release inference")
        return super().infer(jpeg)


def settings(tmp_path: Path, *, timeout: float = 0.2, max_jpeg_bytes: int = 32) -> GestureSettings:
    model = tmp_path / "model.pt"
    model.write_bytes(b"model")
    return GestureSettings(
        model_path=model,
        model_sha256="model-hash",
        token=TOKEN,
        allowed_origins=(ALLOWED_ORIGIN,),
        hello_timeout_seconds=timeout,
        max_jpeg_bytes=max_jpeg_bytes,
    )


def hello(*, token: str = TOKEN, version: int = 1) -> dict[str, Any]:
    return {"type": "hello", "protocolVersion": version, "token": token}


def connect(client: TestClient):
    return client.websocket_connect("/v1/pose", headers={"origin": ALLOWED_ORIGIN})


def authenticate(session: Any) -> dict[str, Any]:
    session.send_json(hello())
    return session.receive_json()


def frame(frame_id: int, jpeg: bytes = b"jpeg") -> bytes:
    return frame_id.to_bytes(4, "big") + jpeg


def test_allows_configured_origin_and_returns_ready(tmp_path: Path) -> None:
    app = create_app(FakeEngine(), settings(tmp_path))

    with TestClient(app) as client, connect(client) as session:
        response = authenticate(session)

    assert response == {
        "type": "ready",
        "protocolVersion": 1,
        "model": FakeEngine.metadata["model"],
        "device": FakeEngine.metadata["device"],
    }


def test_rejects_origin_before_authentication(tmp_path: Path) -> None:
    app = create_app(FakeEngine(), settings(tmp_path))

    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect) as raised:
            with client.websocket_connect("/v1/pose", headers={"origin": "https://evil.test"}):
                pass

    assert raised.value.code == 4403


def test_closes_when_hello_times_out(tmp_path: Path) -> None:
    app = create_app(FakeEngine(), settings(tmp_path, timeout=0.01))

    with TestClient(app) as client, connect(client) as session:
        with pytest.raises(WebSocketDisconnect) as raised:
            session.receive_json()

    assert raised.value.code == 4408


@pytest.mark.parametrize(
    ("payload", "close_code"),
    [
        (hello(token="wrong-secret"), 4401),
        (hello(version=2), 4406),
        ({"type": "hello", "protocolVersion": 1}, 4400),
    ],
)
def test_rejects_invalid_hello(tmp_path: Path, payload: dict[str, Any], close_code: int) -> None:
    app = create_app(FakeEngine(), settings(tmp_path))

    with TestClient(app) as client, connect(client) as session:
        session.send_json(payload)
        with pytest.raises(WebSocketDisconnect) as raised:
            session.receive_json()

    assert raised.value.code == close_code


def test_returns_pose_with_the_same_frame_id(tmp_path: Path) -> None:
    engine = FakeEngine()
    app = create_app(engine, settings(tmp_path))

    with TestClient(app) as client, connect(client) as session:
        authenticate(session)
        session.send_bytes(frame(42))
        response = session.receive_json()

    assert response["type"] == "pose"
    assert response["frameId"] == 42
    assert response["poses"] == []
    assert engine.frames == [b"jpeg"]


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        (b"bad", "invalid_frame"),
        (frame(7, b"x" * 33), "frame_too_large"),
    ],
)
def test_frame_protocol_errors_are_recoverable(
    tmp_path: Path,
    payload: bytes,
    code: str,
) -> None:
    app = create_app(FakeEngine(), settings(tmp_path))

    with TestClient(app) as client, connect(client) as session:
        authenticate(session)
        session.send_bytes(payload)
        error = session.receive_json()
        session.send_bytes(frame(8))
        recovered = session.receive_json()

    assert error["type"] == "error"
    assert error["code"] == code
    assert error.get("frameId") == (7 if code == "frame_too_large" else None)
    assert recovered["type"] == "pose"
    assert recovered["frameId"] == 8


def test_invalid_jpeg_from_engine_is_recoverable(tmp_path: Path) -> None:
    engine = FakeEngine(InferenceError("invalid_jpeg", "O JPEG recebido é inválido."))
    app = create_app(engine, settings(tmp_path))

    with TestClient(app) as client, connect(client) as session:
        authenticate(session)
        session.send_bytes(frame(9))
        response = session.receive_json()

    assert response == {
        "type": "error",
        "protocolVersion": 1,
        "code": "invalid_jpeg",
        "message": "O JPEG recebido é inválido.",
        "frameId": 9,
    }


def test_second_authenticated_station_is_rejected(tmp_path: Path) -> None:
    app = create_app(FakeEngine(), settings(tmp_path))

    with TestClient(app) as client, connect(client) as first:
        authenticate(first)
        with connect(client) as second:
            second.send_json(hello())
            with pytest.raises(WebSocketDisconnect) as raised:
                second.receive_json()

        first.send_bytes(frame(10))
        assert first.receive_json()["frameId"] == 10

    assert raised.value.code == 4429


def test_disconnect_during_inference_releases_station_slot(tmp_path: Path) -> None:
    engine = BlockingEngine()
    app = create_app(engine, settings(tmp_path))

    with TestClient(app) as client:
        with connect(client) as first:
            authenticate(first)
            first.send_bytes(frame(11))
            assert engine.started.wait(timeout=1)
            first.close()
            engine.release.set()

        with connect(client) as replacement:
            ready = authenticate(replacement)

    assert ready["type"] == "ready"


def test_rejection_logs_do_not_expose_token_or_payload(tmp_path: Path, caplog: Any) -> None:
    app = create_app(FakeEngine(), settings(tmp_path))

    with TestClient(app) as client, connect(client) as session:
        session.send_text(json.dumps(hello(token="do-not-log-this")))
        with pytest.raises(WebSocketDisconnect):
            session.receive_json()

    assert "do-not-log-this" not in caplog.text
