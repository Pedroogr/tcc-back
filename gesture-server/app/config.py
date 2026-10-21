from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping


DEFAULT_MODEL_SHA256 = "1060bda4a27012060eca246f9b2adeea22eabb045a1e58f8d229be29b7ebc2ba"
DEFAULT_MODEL_PATH = Path(__file__).resolve().parents[2] / "gesture-poc" / "yolo11s-pose.pt"


class SettingsError(ValueError):
    """Raised when the service cannot start safely with its current settings."""


def _required(environment: Mapping[str, str], name: str) -> str:
    value = environment.get(name, "").strip()
    if not value:
        raise SettingsError(f"{name} is required")
    return value


def _integer(environment: Mapping[str, str], name: str, default: int) -> int:
    raw_value = environment.get(name)
    if raw_value is None:
        return default
    try:
        return int(raw_value)
    except ValueError as error:
        raise SettingsError(f"{name} must be an integer") from error


def _decimal(environment: Mapping[str, str], name: str, default: float) -> float:
    raw_value = environment.get(name)
    if raw_value is None:
        return default
    try:
        return float(raw_value)
    except ValueError as error:
        raise SettingsError(f"{name} must be a number") from error


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as model_file:
        for chunk in iter(lambda: model_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@dataclass(frozen=True, slots=True)
class GestureSettings:
    model_path: Path
    model_sha256: str
    token: str = field(repr=False)
    cuda_device: int = 0
    allowed_origins: tuple[str, ...] = ("http://localhost:5173",)
    max_jpeg_bytes: int = 512 * 1024
    hello_timeout_seconds: float = 5.0
    protocol_version: int = 1
    capture_max_width: int = 640
    jpeg_quality: int = 80

    @classmethod
    def from_env(cls, environment: Mapping[str, str] | None = None) -> GestureSettings:
        values = os.environ if environment is None else environment
        token = _required(values, "GESTURE_TOKEN")
        model_path = Path(values.get("GESTURE_MODEL_PATH", DEFAULT_MODEL_PATH)).expanduser().resolve()
        if not model_path.is_file():
            raise SettingsError(f"model file does not exist: {model_path}")

        expected_sha256 = values.get("GESTURE_MODEL_SHA256", DEFAULT_MODEL_SHA256).strip().lower()
        if len(expected_sha256) != 64 or any(character not in "0123456789abcdef" for character in expected_sha256):
            raise SettingsError("GESTURE_MODEL_SHA256 must be a 64-character hexadecimal SHA-256")
        if _sha256(model_path) != expected_sha256:
            raise SettingsError("model SHA-256 does not match GESTURE_MODEL_SHA256")

        origins = tuple(
            origin.strip()
            for origin in values.get("GESTURE_ALLOWED_ORIGINS", "http://localhost:5173").split(",")
            if origin.strip()
        )
        if not origins:
            raise SettingsError("GESTURE_ALLOWED_ORIGINS must contain at least one origin")

        return cls(
            model_path=model_path,
            model_sha256=expected_sha256,
            token=token,
            cuda_device=_integer(values, "GESTURE_CUDA_DEVICE", 0),
            allowed_origins=origins,
            max_jpeg_bytes=_integer(values, "GESTURE_MAX_JPEG_BYTES", 512 * 1024),
            hello_timeout_seconds=_decimal(values, "GESTURE_HELLO_TIMEOUT_SECONDS", 5.0),
            protocol_version=_integer(values, "GESTURE_PROTOCOL_VERSION", 1),
            capture_max_width=_integer(values, "GESTURE_CAPTURE_MAX_WIDTH", 640),
            jpeg_quality=_integer(values, "GESTURE_JPEG_QUALITY", 80),
        )
