from __future__ import annotations

import hashlib
from pathlib import Path

import pytest


def valid_environment(model_path: Path) -> dict[str, str]:
    return {
        "GESTURE_MODEL_PATH": str(model_path),
        "GESTURE_MODEL_SHA256": hashlib.sha256(model_path.read_bytes()).hexdigest(),
        "GESTURE_TOKEN": "test-secret",
        "GESTURE_ALLOWED_ORIGINS": "http://localhost:5173,http://127.0.0.1:5173",
    }


def test_rejects_missing_token(tmp_path: Path) -> None:
    from app.config import GestureSettings, SettingsError

    model_path = tmp_path / "model.pt"
    model_path.write_bytes(b"model")
    environment = valid_environment(model_path)
    environment.pop("GESTURE_TOKEN")

    with pytest.raises(SettingsError, match="GESTURE_TOKEN"):
        GestureSettings.from_env(environment)


def test_rejects_missing_model(tmp_path: Path) -> None:
    from app.config import GestureSettings, SettingsError

    environment = {
        "GESTURE_MODEL_PATH": str(tmp_path / "missing.pt"),
        "GESTURE_MODEL_SHA256": hashlib.sha256(b"model").hexdigest(),
        "GESTURE_TOKEN": "test-secret",
    }

    with pytest.raises(SettingsError, match="model file"):
        GestureSettings.from_env(environment)


def test_rejects_model_hash_mismatch(tmp_path: Path) -> None:
    from app.config import GestureSettings, SettingsError

    model_path = tmp_path / "model.pt"
    model_path.write_bytes(b"model")
    environment = valid_environment(model_path)
    environment["GESTURE_MODEL_SHA256"] = "0" * 64

    with pytest.raises(SettingsError, match="SHA-256"):
        GestureSettings.from_env(environment)


def test_loads_valid_settings_with_safe_defaults(tmp_path: Path) -> None:
    from app.config import GestureSettings

    model_path = tmp_path / "model.pt"
    model_path.write_bytes(b"model")

    settings = GestureSettings.from_env(valid_environment(model_path))

    assert settings.model_path == model_path.resolve()
    assert settings.cuda_device == 0
    assert settings.allowed_origins == (
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    )
    assert settings.max_jpeg_bytes == 512 * 1024
    assert settings.hello_timeout_seconds == 5.0
    assert settings.protocol_version == 1
    assert settings.capture_max_width == 640
    assert settings.jpeg_quality == 80
    assert settings.debug_preview is False
    assert settings.token not in repr(settings)


def test_enables_debug_preview_explicitly(tmp_path: Path) -> None:
    from app.config import GestureSettings

    model_path = tmp_path / "model.pt"
    model_path.write_bytes(b"model")
    environment = valid_environment(model_path)
    environment["GESTURE_DEBUG_PREVIEW"] = "true"

    settings = GestureSettings.from_env(environment)

    assert settings.debug_preview is True


def test_rejects_invalid_debug_preview_value(tmp_path: Path) -> None:
    from app.config import GestureSettings, SettingsError

    model_path = tmp_path / "model.pt"
    model_path.write_bytes(b"model")
    environment = valid_environment(model_path)
    environment["GESTURE_DEBUG_PREVIEW"] = "sometimes"

    with pytest.raises(SettingsError, match="GESTURE_DEBUG_PREVIEW"):
        GestureSettings.from_env(environment)
