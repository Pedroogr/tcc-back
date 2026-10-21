from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from unittest.mock import ANY

import pytest
from fastapi.testclient import TestClient

from app.config import GestureSettings


class Values:
    def __init__(self, value: Any) -> None:
        self.value = value

    def tolist(self) -> Any:
        return self.value


@dataclass
class FakeBoxes:
    xyxy: Values
    conf: Values


@dataclass
class FakeKeypoints:
    xy: Values
    conf: Values


@dataclass
class FakeResult:
    boxes: FakeBoxes
    keypoints: FakeKeypoints
    speed: dict[str, float]


class FakeImage:
    def __init__(self, height: int = 480, width: int = 640) -> None:
        self.shape = (height, width, 3)


class FakeCuda:
    def __init__(self, available: bool = True) -> None:
        self.available = available
        self.synchronizations = 0

    def is_available(self) -> bool:
        return self.available

    def device_name(self, device: int) -> str:
        return f"Fake CUDA {device}"

    def synchronize(self, device: int) -> None:
        self.synchronizations += 1


class FakeModel:
    def __init__(self, results: list[FakeResult] | None = None, error: Exception | None = None) -> None:
        self.results = results or []
        self.error = error
        self.calls: list[dict[str, Any]] = []

    def predict(self, **kwargs: Any) -> list[FakeResult]:
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.results


def settings_for(
    model_path: Path,
    sha256: str | None = None,
    *,
    debug_preview: bool = False,
) -> GestureSettings:
    return GestureSettings(
        model_path=model_path,
        model_sha256=sha256 or hashlib.sha256(model_path.read_bytes()).hexdigest(),
        token="test-secret",
        debug_preview=debug_preview,
    )


def one_person_result() -> FakeResult:
    keypoints = [[float(index * 2), float(index * 3)] for index in range(17)]
    confidences = [0.5 + index / 100 for index in range(17)]
    return FakeResult(
        boxes=FakeBoxes(xyxy=Values([[64.0, 48.0, 320.0, 240.0]]), conf=Values([0.91])),
        keypoints=FakeKeypoints(xy=Values([keypoints]), conf=Values([confidences])),
        speed={"preprocess": 1.4, "inference": 18.0, "postprocess": 1.8},
    )


def test_maps_ultralytics_result_to_pose_contract(tmp_path: Path) -> None:
    from app.inference import create_cuda_engine

    model_path = tmp_path / "model.pt"
    model_path.write_bytes(b"model")
    model = FakeModel([one_person_result()])
    cuda = FakeCuda()
    clock_values = iter([10.0, 10.002, 10.025])
    engine = create_cuda_engine(
        settings_for(model_path),
        decoder=lambda _: FakeImage(),
        model_loader=lambda _: model,
        cuda=cuda,
        clock=lambda: next(clock_values),
    )

    result = engine.infer(b"jpeg")

    assert result.model_version.startswith("yolo11s-pose:")
    assert len(result.poses) == 1
    pose = result.poses[0]
    assert pose.confidence == 0.91
    assert pose.box.x1 == 64.0
    assert pose.box.y2 == 240.0
    assert pose.normalized_box.x == 0.1
    assert pose.normalized_box.y == 0.1
    assert pose.normalized_box.width == 0.4
    assert pose.normalized_box.height == 0.4
    assert len(pose.keypoints) == 17
    assert pose.keypoints[5].x == 10.0
    assert pose.keypoints[5].confidence == 0.55
    assert result.timings.decode_ms == pytest.approx(2.0)
    assert result.timings.preprocess_ms == 1.4
    assert result.timings.inference_ms == 18.0
    assert result.timings.postprocess_ms == 1.8
    assert result.timings.total_ms == pytest.approx(25.0)
    assert all(
        value >= 0
        for value in (
            result.timings.decode_ms,
            result.timings.preprocess_ms,
            result.timings.inference_ms,
            result.timings.postprocess_ms,
            result.timings.total_ms,
        )
    )
    assert model.calls == [
        {
            "source": ANY,
            "imgsz": 640,
            "device": 0,
            "quantize": 16,
            "verbose": False,
        }
    ]
    assert cuda.synchronizations == 2


def test_enabled_debug_preview_receives_decoded_frame_and_mapped_poses(tmp_path: Path) -> None:
    from app.inference import create_cuda_engine

    class RecordingPreview:
        def __init__(self) -> None:
            self.frames: list[Any] = []

        def show(self, frame: Any) -> bool:
            self.frames.append(frame)
            return True

        def close(self) -> None:
            pass

    model_path = tmp_path / "model.pt"
    model_path.write_bytes(b"model")
    image = FakeImage()
    preview = RecordingPreview()
    engine = create_cuda_engine(
        settings_for(model_path, debug_preview=True),
        decoder=lambda _: image,
        model_loader=lambda _: FakeModel([one_person_result()]),
        cuda=FakeCuda(),
        preview_factory=lambda: preview,
    )

    result = engine.infer(b"jpeg")

    assert len(preview.frames) == 1
    frame = preview.frames[0]
    assert frame.image is image
    assert frame.poses == result.poses
    assert frame.timings == result.timings
    assert frame.jpeg_bytes == len(b"jpeg")
    assert frame.model_name == "yolo11s-pose"
    assert frame.device_name == "Fake CUDA 0"


@pytest.mark.parametrize("image", [None, FakeImage(height=0), FakeImage(width=0)])
def test_rejects_invalid_or_empty_jpeg(tmp_path: Path, image: FakeImage | None) -> None:
    from app.inference import InferenceError, create_cuda_engine

    model_path = tmp_path / "model.pt"
    model_path.write_bytes(b"model")
    model = FakeModel()
    engine = create_cuda_engine(
        settings_for(model_path),
        decoder=lambda _: image,
        model_loader=lambda _: model,
        cuda=FakeCuda(),
    )

    with pytest.raises(InferenceError) as raised:
        engine.infer(b"not-a-jpeg")

    assert raised.value.code == "invalid_jpeg"
    assert model.calls == []


def test_returns_no_poses_when_model_detects_no_people(tmp_path: Path) -> None:
    from app.inference import create_cuda_engine

    model_path = tmp_path / "model.pt"
    model_path.write_bytes(b"model")
    empty_result = FakeResult(
        boxes=FakeBoxes(xyxy=Values([]), conf=Values([])),
        keypoints=FakeKeypoints(xy=Values([]), conf=Values([])),
        speed={"preprocess": 1.0, "inference": 2.0, "postprocess": 1.0},
    )
    engine = create_cuda_engine(
        settings_for(model_path),
        decoder=lambda _: FakeImage(),
        model_loader=lambda _: FakeModel([empty_result]),
        cuda=FakeCuda(),
    )

    assert engine.infer(b"jpeg").poses == ()


def test_wraps_model_failure_without_exposing_internal_message(tmp_path: Path) -> None:
    from app.inference import InferenceError, create_cuda_engine

    model_path = tmp_path / "model.pt"
    model_path.write_bytes(b"model")
    engine = create_cuda_engine(
        settings_for(model_path),
        decoder=lambda _: FakeImage(),
        model_loader=lambda _: FakeModel(error=RuntimeError("secret driver path")),
        cuda=FakeCuda(),
    )

    with pytest.raises(InferenceError) as raised:
        engine.infer(b"jpeg")

    assert raised.value.code == "inference_failed"
    assert "secret driver path" not in str(raised.value)


def test_verifies_model_hash_before_loading(tmp_path: Path) -> None:
    from app.inference import EngineStartupError, create_cuda_engine

    model_path = tmp_path / "model.pt"
    model_path.write_bytes(b"model")
    loaded = False

    def load(_: Path):
        nonlocal loaded
        loaded = True
        return FakeModel()

    with pytest.raises(EngineStartupError, match="hash"):
        create_cuda_engine(
            settings_for(model_path, sha256="0" * 64),
            decoder=lambda _: FakeImage(),
            model_loader=load,
            cuda=FakeCuda(),
        )

    assert loaded is False


def test_rejects_unavailable_cuda_before_loading(tmp_path: Path) -> None:
    from app.inference import EngineStartupError, create_cuda_engine

    model_path = tmp_path / "model.pt"
    model_path.write_bytes(b"model")
    loaded = False

    def load(_: Path):
        nonlocal loaded
        loaded = True
        return FakeModel()

    with pytest.raises(EngineStartupError, match="CUDA"):
        create_cuda_engine(
            settings_for(model_path),
            decoder=lambda _: FakeImage(),
            model_loader=load,
            cuda=FakeCuda(available=False),
        )

    assert loaded is False


def test_production_app_stays_not_ready_when_engine_startup_fails(tmp_path: Path) -> None:
    from app.inference import EngineStartupError
    from app.main import create_production_app

    model_path = tmp_path / "model.pt"
    model_path.write_bytes(b"model")

    def fail_startup(_: GestureSettings):
        raise EngineStartupError("CUDA unavailable")

    app = create_production_app(settings_for(model_path), engine_factory=fail_startup)

    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 503
    assert response.json() == {"status": "not_ready", "protocolVersion": 1}


def test_production_app_loads_engine_once_during_lifespan(tmp_path: Path) -> None:
    from app.main import create_production_app

    model_path = tmp_path / "model.pt"
    model_path.write_bytes(b"model")
    calls = 0

    class ReadyEngine:
        ready = True
        metadata = {
            "model": {"name": "yolo11s-pose", "sha256": "hash", "inputSize": 640},
            "device": {"type": "cuda", "name": "Fake CUDA 0"},
        }

    def load(_: GestureSettings) -> ReadyEngine:
        nonlocal calls
        calls += 1
        return ReadyEngine()

    app = create_production_app(settings_for(model_path), engine_factory=load)

    with TestClient(app) as client:
        first = client.get("/health")
        second = client.get("/health")

    assert first.status_code == 200
    assert second.status_code == 200
    assert calls == 1


def test_production_app_closes_engine_during_shutdown(tmp_path: Path) -> None:
    from app.main import create_production_app

    model_path = tmp_path / "model.pt"
    model_path.write_bytes(b"model")

    class ReadyEngine:
        ready = True
        metadata: dict[str, Any] = {}

        def __init__(self) -> None:
            self.closed = False

        def close(self) -> None:
            self.closed = True

    engine = ReadyEngine()
    app = create_production_app(settings_for(model_path), engine_factory=lambda _: engine)

    with TestClient(app) as client:
        assert client.get("/health").status_code == 200

    assert engine.closed is True


def test_gpu_smoke_summary_does_not_expose_secret_or_model_path(tmp_path: Path) -> None:
    from app.protocol import PoseResult, PoseTimings
    from app.smoke_gpu import run_smoke

    model_path = tmp_path / "private" / "model.pt"
    model_path.parent.mkdir()
    model_path.write_bytes(b"model")
    settings = settings_for(model_path)

    class SmokeEngine:
        metadata = {
            "model": {"name": "yolo11s-pose", "sha256": "hash", "inputSize": 640},
            "device": {"type": "cuda", "name": "Fake CUDA 0"},
        }

        def infer(self, jpeg: bytes) -> PoseResult:
            assert jpeg == b"synthetic-jpeg"
            return PoseResult(
                model_version="yolo11s-pose:hash",
                timings=PoseTimings(1.0, 2.0, 3.0, 4.0, 10.0),
                poses=(),
            )

    summary = run_smoke(
        settings,
        engine_factory=lambda _: SmokeEngine(),
        jpeg_factory=lambda: b"synthetic-jpeg",
    )

    assert summary == {
        "status": "ok",
        "model": SmokeEngine.metadata["model"],
        "device": SmokeEngine.metadata["device"],
        "timings": {
            "decodeMs": 1.0,
            "preprocessMs": 2.0,
            "inferenceMs": 3.0,
            "postprocessMs": 4.0,
            "totalMs": 10.0,
        },
        "poses": 0,
    }
    serialized = str(summary)
    assert settings.token not in serialized
    assert str(settings.model_path) not in serialized
