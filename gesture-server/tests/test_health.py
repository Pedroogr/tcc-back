from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient


@dataclass(frozen=True)
class FakeEngine:
    ready: bool
    metadata: dict[str, Any]


def build_settings(tmp_path: Path):
    from app.config import GestureSettings

    model_path = tmp_path / "model.pt"
    model_path.write_bytes(b"model")
    return GestureSettings.from_env(
        {
            "GESTURE_MODEL_PATH": str(model_path),
            "GESTURE_MODEL_SHA256": hashlib.sha256(b"model").hexdigest(),
            "GESTURE_TOKEN": "must-not-leak",
        }
    )


def test_health_returns_503_while_engine_is_not_ready(tmp_path: Path) -> None:
    from app.main import create_app

    client = TestClient(create_app(FakeEngine(ready=False, metadata={}), build_settings(tmp_path)))

    response = client.get("/health")

    assert response.status_code == 503
    assert response.json() == {"status": "not_ready", "protocolVersion": 1}


def test_health_returns_only_public_metadata_when_ready(tmp_path: Path) -> None:
    from app.main import create_app

    settings = build_settings(tmp_path)
    engine = FakeEngine(
        ready=True,
        metadata={
            "model": {
                "name": "yolo11s-pose",
                "sha256": "1060bda4",
                "inputSize": 640,
            },
            "device": {
                "type": "cuda",
                "name": "NVIDIA GeForce RTX 3070 Ti",
            },
        },
    )
    client = TestClient(create_app(engine, settings))

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "protocolVersion": 1,
        **engine.metadata,
    }
    serialized = response.text
    assert settings.token not in serialized
    assert str(settings.model_path) not in serialized
