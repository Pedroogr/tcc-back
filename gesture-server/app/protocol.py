from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any


class ProtocolError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class HelloMessage:
    protocol_version: int
    token: str


@dataclass(frozen=True, slots=True)
class FrameMessage:
    frame_id: int
    jpeg: bytes


@dataclass(frozen=True, slots=True)
class ModelMetadata:
    name: str
    sha256: str
    input_size: int


@dataclass(frozen=True, slots=True)
class DeviceMetadata:
    type: str
    name: str


@dataclass(frozen=True, slots=True)
class PixelBox:
    x1: float
    y1: float
    x2: float
    y2: float


@dataclass(frozen=True, slots=True)
class NormalizedBox:
    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True, slots=True)
class PoseKeypoint:
    x: float
    y: float
    confidence: float


@dataclass(frozen=True, slots=True)
class PersonPose:
    confidence: float
    box: PixelBox
    normalized_box: NormalizedBox
    keypoints: tuple[PoseKeypoint, ...]


@dataclass(frozen=True, slots=True)
class PoseTimings:
    decode_ms: float
    preprocess_ms: float
    inference_ms: float
    postprocess_ms: float
    total_ms: float


@dataclass(frozen=True, slots=True)
class PoseResult:
    model_version: str
    timings: PoseTimings
    poses: tuple[PersonPose, ...]


def parse_hello(payload: str, expected_version: int) -> HelloMessage:
    try:
        value = json.loads(payload)
    except json.JSONDecodeError as error:
        raise ProtocolError("invalid_json", "A mensagem inicial não é um JSON válido.") from error

    required_fields = {"type", "protocolVersion", "token"}
    if not isinstance(value, dict) or set(value) != required_fields:
        raise ProtocolError("invalid_hello", "A mensagem inicial é inválida.")

    protocol_version = value["protocolVersion"]
    token = value["token"]
    if (
        value["type"] != "hello"
        or not isinstance(protocol_version, int)
        or isinstance(protocol_version, bool)
        or not isinstance(token, str)
        or not token
    ):
        raise ProtocolError("invalid_hello", "A mensagem inicial é inválida.")
    if protocol_version != expected_version:
        raise ProtocolError("unsupported_protocol", "A versão do protocolo não é compatível.")

    return HelloMessage(protocol_version=protocol_version, token=token)


def parse_frame(payload: bytes, max_jpeg_bytes: int) -> FrameMessage:
    if len(payload) < 5:
        raise ProtocolError("invalid_frame", "O frame precisa conter ID e JPEG.")
    frame_id = int.from_bytes(payload[:4], byteorder="big", signed=False)
    jpeg = payload[4:]
    if len(jpeg) > max_jpeg_bytes:
        raise ProtocolError("frame_too_large", "O JPEG excede o limite permitido.")
    return FrameMessage(frame_id=frame_id, jpeg=jpeg)


def _model_payload(model: ModelMetadata) -> dict[str, Any]:
    return {
        "name": model.name,
        "sha256": model.sha256,
        "inputSize": model.input_size,
    }


def serialize_ready(
    protocol_version: int,
    model: ModelMetadata,
    device: DeviceMetadata,
) -> dict[str, Any]:
    return {
        "type": "ready",
        "protocolVersion": protocol_version,
        "model": _model_payload(model),
        "device": {"type": device.type, "name": device.name},
    }


def serialize_pose(
    protocol_version: int,
    frame_id: int,
    result: PoseResult,
) -> dict[str, Any]:
    return {
        "type": "pose",
        "protocolVersion": protocol_version,
        "frameId": frame_id,
        "modelVersion": result.model_version,
        "timings": {
            "decodeMs": result.timings.decode_ms,
            "preprocessMs": result.timings.preprocess_ms,
            "inferenceMs": result.timings.inference_ms,
            "postprocessMs": result.timings.postprocess_ms,
            "totalMs": result.timings.total_ms,
        },
        "poses": [
            {
                "confidence": pose.confidence,
                "box": {
                    "x1": pose.box.x1,
                    "y1": pose.box.y1,
                    "x2": pose.box.x2,
                    "y2": pose.box.y2,
                },
                "normalizedBox": {
                    "x": pose.normalized_box.x,
                    "y": pose.normalized_box.y,
                    "width": pose.normalized_box.width,
                    "height": pose.normalized_box.height,
                },
                "keypoints": [
                    {
                        "x": keypoint.x,
                        "y": keypoint.y,
                        "confidence": keypoint.confidence,
                    }
                    for keypoint in pose.keypoints
                ],
            }
            for pose in result.poses
        ],
    }


def serialize_error(
    protocol_version: int,
    code: str,
    message: str,
    frame_id: int | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "type": "error",
        "protocolVersion": protocol_version,
        "code": code,
        "message": message,
    }
    if frame_id is not None:
        payload["frameId"] = frame_id
    return payload
