from __future__ import annotations

import hashlib
import threading
import time
from pathlib import Path
from typing import Any, Callable, Protocol

from .config import GestureSettings
from .protocol import (
    DeviceMetadata,
    ModelMetadata,
    NormalizedBox,
    PersonPose,
    PixelBox,
    PoseKeypoint,
    PoseResult,
    PoseTimings,
)


MODEL_NAME = "yolo11s-pose"
MODEL_INPUT_SIZE = 640


class EngineStartupError(RuntimeError):
    """Raised when the engine cannot become ready."""


class InferenceError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class PoseEngine(Protocol):
    @property
    def ready(self) -> bool: ...

    @property
    def metadata(self) -> dict[str, Any]: ...

    def infer(self, jpeg: bytes) -> PoseResult: ...


class CudaRuntime(Protocol):
    def is_available(self) -> bool: ...

    def device_name(self, device: int) -> str: ...

    def synchronize(self, device: int) -> None: ...


Decoder = Callable[[bytes], Any | None]
ModelLoader = Callable[[Path], Any]
Clock = Callable[[], float]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as model_file:
            for chunk in iter(lambda: model_file.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise EngineStartupError("model file cannot be read") from error
    return digest.hexdigest()


def _default_decoder(jpeg: bytes) -> Any | None:
    import cv2
    import numpy as np

    encoded = np.frombuffer(jpeg, dtype=np.uint8)
    return cv2.imdecode(encoded, cv2.IMREAD_COLOR)


def _default_model_loader(path: Path) -> Any:
    from ultralytics import YOLO

    return YOLO(str(path))


class TorchCudaRuntime:
    def __init__(self) -> None:
        import torch

        self._torch = torch

    def is_available(self) -> bool:
        return bool(self._torch.cuda.is_available())

    def device_name(self, device: int) -> str:
        return str(self._torch.cuda.get_device_name(device))

    def synchronize(self, device: int) -> None:
        self._torch.cuda.synchronize(device)


class CudaYoloPoseEngine:
    def __init__(
        self,
        settings: GestureSettings,
        model: Any,
        decoder: Decoder,
        cuda: CudaRuntime,
        clock: Clock,
    ) -> None:
        self._settings = settings
        self._model = model
        self._decoder = decoder
        self._cuda = cuda
        self._clock = clock
        self._lock = threading.Lock()
        self._model_metadata = ModelMetadata(
            name=MODEL_NAME,
            sha256=settings.model_sha256,
            input_size=MODEL_INPUT_SIZE,
        )
        self._device_metadata = DeviceMetadata(
            type="cuda",
            name=cuda.device_name(settings.cuda_device),
        )

    @property
    def ready(self) -> bool:
        return True

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "model": {
                "name": self._model_metadata.name,
                "sha256": self._model_metadata.sha256,
                "inputSize": self._model_metadata.input_size,
            },
            "device": {
                "type": self._device_metadata.type,
                "name": self._device_metadata.name,
            },
        }

    @property
    def model_metadata(self) -> ModelMetadata:
        return self._model_metadata

    @property
    def device_metadata(self) -> DeviceMetadata:
        return self._device_metadata

    def infer(self, jpeg: bytes) -> PoseResult:
        started_at = self._clock()
        image = self._decoder(jpeg)
        decoded_at = self._clock()
        if image is None or len(image.shape) < 2 or image.shape[0] <= 0 or image.shape[1] <= 0:
            raise InferenceError("invalid_jpeg", "O JPEG recebido é inválido.")

        try:
            with self._lock:
                self._cuda.synchronize(self._settings.cuda_device)
                predictions = self._model.predict(
                    source=image,
                    imgsz=MODEL_INPUT_SIZE,
                    device=self._settings.cuda_device,
                    quantize=16,
                    verbose=False,
                )
                self._cuda.synchronize(self._settings.cuda_device)
        except Exception as error:
            raise InferenceError("inference_failed", "A inferência não pôde ser concluída.") from error

        finished_at = self._clock()
        height, width = int(image.shape[0]), int(image.shape[1])
        poses, speed = self._map_predictions(predictions, width=width, height=height)
        timings = PoseTimings(
            decode_ms=max(0.0, (decoded_at - started_at) * 1000),
            preprocess_ms=max(0.0, float(speed.get("preprocess", 0.0))),
            inference_ms=max(0.0, float(speed.get("inference", 0.0))),
            postprocess_ms=max(0.0, float(speed.get("postprocess", 0.0))),
            total_ms=max(0.0, (finished_at - started_at) * 1000),
        )
        return PoseResult(
            model_version=f"{MODEL_NAME}:{self._settings.model_sha256[:8]}",
            timings=timings,
            poses=poses,
        )

    def _map_predictions(
        self,
        predictions: Any,
        width: int,
        height: int,
    ) -> tuple[tuple[PersonPose, ...], dict[str, float]]:
        if not predictions:
            return (), {}
        result = predictions[0]
        speed = dict(getattr(result, "speed", {}) or {})
        boxes = getattr(result, "boxes", None)
        keypoints = getattr(result, "keypoints", None)
        if boxes is None or keypoints is None:
            return (), speed

        box_values = boxes.xyxy.tolist()
        confidences = boxes.conf.tolist()
        point_values = keypoints.xy.tolist()
        point_confidences = keypoints.conf.tolist()
        poses: list[PersonPose] = []
        for box, confidence, points, scores in zip(
            box_values,
            confidences,
            point_values,
            point_confidences,
        ):
            if len(points) != 17 or len(scores) != 17:
                raise InferenceError("invalid_result", "O modelo retornou keypoints inválidos.")
            x1, y1, x2, y2 = (float(value) for value in box)
            poses.append(
                PersonPose(
                    confidence=float(confidence),
                    box=PixelBox(x1=x1, y1=y1, x2=x2, y2=y2),
                    normalized_box=NormalizedBox(
                        x=x1 / width,
                        y=y1 / height,
                        width=(x2 - x1) / width,
                        height=(y2 - y1) / height,
                    ),
                    keypoints=tuple(
                        PoseKeypoint(
                            x=float(point[0]),
                            y=float(point[1]),
                            confidence=float(score),
                        )
                        for point, score in zip(points, scores)
                    ),
                )
            )
        return tuple(poses), speed


def create_cuda_engine(
    settings: GestureSettings,
    *,
    decoder: Decoder = _default_decoder,
    model_loader: ModelLoader = _default_model_loader,
    cuda: CudaRuntime | None = None,
    clock: Clock = time.perf_counter,
) -> CudaYoloPoseEngine:
    if _sha256(settings.model_path) != settings.model_sha256:
        raise EngineStartupError("model hash does not match configured SHA-256")
    cuda_runtime = cuda or TorchCudaRuntime()
    if not cuda_runtime.is_available():
        raise EngineStartupError("CUDA is unavailable")
    try:
        model = model_loader(settings.model_path)
    except Exception as error:
        raise EngineStartupError("model could not be loaded") from error
    return CudaYoloPoseEngine(settings, model, decoder, cuda_runtime, clock)
