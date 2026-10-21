from __future__ import annotations

import json
from typing import Any, Callable

from .config import GestureSettings
from .inference import PoseEngine, create_cuda_engine


def synthetic_jpeg() -> bytes:
    import cv2
    import numpy as np

    image = np.zeros((640, 640, 3), dtype=np.uint8)
    encoded, buffer = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 80])
    if not encoded:
        raise RuntimeError("synthetic JPEG could not be encoded")
    return bytes(buffer)


def run_smoke(
    settings: GestureSettings,
    *,
    engine_factory: Callable[[GestureSettings], PoseEngine] = create_cuda_engine,
    jpeg_factory: Callable[[], bytes] = synthetic_jpeg,
) -> dict[str, Any]:
    engine = engine_factory(settings)
    result = engine.infer(jpeg_factory())
    return {
        "status": "ok",
        "model": engine.metadata["model"],
        "device": engine.metadata["device"],
        "timings": {
            "decodeMs": result.timings.decode_ms,
            "preprocessMs": result.timings.preprocess_ms,
            "inferenceMs": result.timings.inference_ms,
            "postprocessMs": result.timings.postprocess_ms,
            "totalMs": result.timings.total_ms,
        },
        "poses": len(result.poses),
    }


def main() -> None:
    print(json.dumps(run_smoke(GestureSettings.from_env()), ensure_ascii=False))


if __name__ == "__main__":
    main()
