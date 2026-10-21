from __future__ import annotations

import json
from dataclasses import FrozenInstanceError

import pytest


def test_parses_valid_hello() -> None:
    from app.protocol import HelloMessage, parse_hello

    message = parse_hello(
        json.dumps({"type": "hello", "protocolVersion": 1, "token": "secret"}),
        expected_version=1,
    )

    assert message == HelloMessage(protocol_version=1, token="secret")
    with pytest.raises(FrozenInstanceError):
        message.token = "changed"  # type: ignore[misc]


def test_rejects_hello_with_incompatible_version() -> None:
    from app.protocol import ProtocolError, parse_hello

    with pytest.raises(ProtocolError) as raised:
        parse_hello(
            json.dumps({"type": "hello", "protocolVersion": 2, "token": "secret"}),
            expected_version=1,
        )

    assert raised.value.code == "unsupported_protocol"


@pytest.mark.parametrize(
    ("payload", "expected_code"),
    [
        ("not-json", "invalid_json"),
        (json.dumps([]), "invalid_hello"),
        (json.dumps({"type": "hello", "protocolVersion": 1}), "invalid_hello"),
        (
            json.dumps(
                {
                    "type": "hello",
                    "protocolVersion": 1,
                    "token": "secret",
                    "unexpected": True,
                }
            ),
            "invalid_hello",
        ),
    ],
)
def test_rejects_malformed_hello(payload: str, expected_code: str) -> None:
    from app.protocol import ProtocolError, parse_hello

    with pytest.raises(ProtocolError) as raised:
        parse_hello(payload, expected_version=1)

    assert raised.value.code == expected_code


def test_parses_big_endian_frame_id_and_jpeg() -> None:
    from app.protocol import FrameMessage, parse_frame

    jpeg = b"\xff\xd8payload\xff\xd9"

    frame = parse_frame((0x01020304).to_bytes(4, "big") + jpeg, max_jpeg_bytes=512)

    assert frame == FrameMessage(frame_id=0x01020304, jpeg=jpeg)


@pytest.mark.parametrize("payload", [b"", b"\x00\x00\x00\x01"])
def test_rejects_frame_without_id_and_nonempty_jpeg(payload: bytes) -> None:
    from app.protocol import ProtocolError, parse_frame

    with pytest.raises(ProtocolError) as raised:
        parse_frame(payload, max_jpeg_bytes=512)

    assert raised.value.code == "invalid_frame"


def test_rejects_frame_above_jpeg_limit() -> None:
    from app.protocol import ProtocolError, parse_frame

    with pytest.raises(ProtocolError) as raised:
        parse_frame((7).to_bytes(4, "big") + b"1234", max_jpeg_bytes=3)

    assert raised.value.code == "frame_too_large"


def test_serializes_ready_pose_and_error_messages() -> None:
    from app.protocol import (
        DeviceMetadata,
        ModelMetadata,
        NormalizedBox,
        PersonPose,
        PixelBox,
        PoseKeypoint,
        PoseResult,
        PoseTimings,
        serialize_error,
        serialize_pose,
        serialize_ready,
    )

    model = ModelMetadata(
        name="yolo11s-pose",
        sha256="1060bda4a270",
        input_size=640,
    )
    device = DeviceMetadata(type="cuda", name="NVIDIA GeForce RTX 3070 Ti")
    pose = PersonPose(
        confidence=0.91,
        box=PixelBox(x1=10.0, y1=20.0, x2=110.0, y2=220.0),
        normalized_box=NormalizedBox(x=0.1, y=0.2, width=0.3, height=0.4),
        keypoints=(PoseKeypoint(x=30.0, y=40.0, confidence=0.88),),
    )
    result = PoseResult(
        model_version="yolo11s-pose:1060bda4",
        timings=PoseTimings(
            decode_ms=2.1,
            preprocess_ms=1.4,
            inference_ms=18.0,
            postprocess_ms=1.8,
            total_ms=23.3,
        ),
        poses=(pose,),
    )

    assert serialize_ready(protocol_version=1, model=model, device=device) == {
        "type": "ready",
        "protocolVersion": 1,
        "model": {
            "name": "yolo11s-pose",
            "sha256": "1060bda4a270",
            "inputSize": 640,
        },
        "device": {"type": "cuda", "name": "NVIDIA GeForce RTX 3070 Ti"},
    }
    assert serialize_pose(protocol_version=1, frame_id=42, result=result) == {
        "type": "pose",
        "protocolVersion": 1,
        "frameId": 42,
        "modelVersion": "yolo11s-pose:1060bda4",
        "timings": {
            "decodeMs": 2.1,
            "preprocessMs": 1.4,
            "inferenceMs": 18.0,
            "postprocessMs": 1.8,
            "totalMs": 23.3,
        },
        "poses": [
            {
                "confidence": 0.91,
                "box": {"x1": 10.0, "y1": 20.0, "x2": 110.0, "y2": 220.0},
                "normalizedBox": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4},
                "keypoints": [{"x": 30.0, "y": 40.0, "confidence": 0.88}],
            }
        ],
    }
    assert serialize_error(
        protocol_version=1,
        code="invalid_frame",
        message="Frame inválido.",
        frame_id=42,
    ) == {
        "type": "error",
        "protocolVersion": 1,
        "frameId": 42,
        "code": "invalid_frame",
        "message": "Frame inválido.",
    }
