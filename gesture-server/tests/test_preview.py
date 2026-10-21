from __future__ import annotations

import numpy as np
import pytest

from app.protocol import (
    NormalizedBox,
    PersonPose,
    PixelBox,
    PoseKeypoint,
    PoseTimings,
)


def person_pose() -> PersonPose:
    points = [PoseKeypoint(x=350.0, y=310.0, confidence=0.1) for _ in range(17)]
    points[5] = PoseKeypoint(x=150.0, y=180.0, confidence=0.9)
    points[6] = PoseKeypoint(x=250.0, y=180.0, confidence=0.9)
    points[7] = PoseKeypoint(x=140.0, y=220.0, confidence=0.9)
    points[8] = PoseKeypoint(x=260.0, y=220.0, confidence=0.9)
    points[9] = PoseKeypoint(x=130.0, y=260.0, confidence=0.9)
    points[10] = PoseKeypoint(x=270.0, y=260.0, confidence=0.9)
    return PersonPose(
        confidence=0.91,
        box=PixelBox(x1=100.0, y1=140.0, x2=300.0, y2=300.0),
        normalized_box=NormalizedBox(x=0.25, y=0.4375, width=0.5, height=0.5),
        keypoints=tuple(points),
    )


def preview_frame(image: np.ndarray):
    from app.preview import PreviewFrame

    return PreviewFrame(
        image=image,
        poses=(person_pose(),),
        timings=PoseTimings(
            decode_ms=0.6,
            preprocess_ms=0.5,
            inference_ms=11.5,
            postprocess_ms=1.4,
            total_ms=14.2,
        ),
        jpeg_bytes=23_218,
        model_name="yolo11s-pose",
        device_name="RTX 3070 Ti",
    )


def test_renders_box_keypoints_and_skeleton_without_changing_received_frame() -> None:
    from app.preview import render_pose_preview

    received = np.zeros((320, 400, 3), dtype=np.uint8)

    rendered = render_pose_preview(
        preview_frame(received),
        frame_count=12,
        server_fps=37.94,
    )

    assert rendered is not received
    assert np.count_nonzero(received) == 0
    assert np.count_nonzero(rendered[140, 100]) > 0
    assert np.count_nonzero(rendered[180, 150]) > 0
    assert np.count_nonzero(rendered[200, 145]) > 0
    assert np.count_nonzero(rendered[310, 350]) == 0


def test_builds_overlay_from_server_owned_measurements() -> None:
    from app.preview import build_preview_lines

    frame = preview_frame(np.zeros((320, 400, 3), dtype=np.uint8))

    assert build_preview_lines(frame, frame_count=12, server_fps=37.94) == (
        "GPU: RTX 3070 Ti | Modelo: yolo11s-pose",
        "Frame: 12 | Entrada: 400x320 | JPEG: 22.7 KiB",
        "Pessoas detectadas: 1 | FPS servidor: 37.9",
        "Decode: 0.6 ms | Pre: 0.5 ms | Inferencia: 11.5 ms",
        "Pos: 1.4 ms | Total: 14.2 ms",
    )


def test_calculates_processing_fps_over_recent_frames() -> None:
    from app.preview import RollingProcessingFps

    rate = RollingProcessingFps(window_size=3)

    assert rate.record(10.0) is None
    assert rate.record(10.05) == pytest.approx(20.0)
    assert rate.record(10.10) == pytest.approx(20.0)
    assert rate.record(10.20) == pytest.approx(13.333333)


class FakeHighGui:
    FONT_HERSHEY_SIMPLEX = 0
    LINE_AA = 0
    WND_PROP_VISIBLE = 1

    def __init__(self, key: int = -1) -> None:
        self.key = key
        self.shown_frames = 0
        self.destroyed_windows: list[str] = []

    def rectangle(self, image, start, end, color, thickness) -> None:  # noqa: ANN001
        pass

    def putText(self, image, text, origin, font, scale, color, thickness, line) -> None:  # noqa: ANN001, N802
        pass

    def circle(self, image, center, radius, color, thickness) -> None:  # noqa: ANN001
        pass

    def imshow(self, name: str, image) -> None:  # noqa: ANN001
        self.shown_frames += 1

    def waitKey(self, delay: int) -> int:  # noqa: N802
        return self.key

    def getWindowProperty(self, name: str, property_id: int) -> float:  # noqa: N802
        return 1.0

    def destroyWindow(self, name: str) -> None:  # noqa: N802
        self.destroyed_windows.append(name)


def test_q_closes_preview_until_server_restart() -> None:
    from app.preview import OpenCvFramePreview, PREVIEW_WINDOW_NAME

    gui = FakeHighGui(key=ord("q"))
    preview = OpenCvFramePreview(gui=gui)
    frame = preview_frame(np.zeros((320, 400, 3), dtype=np.uint8))

    assert preview.show(frame) is False
    assert preview.show(frame) is False
    assert gui.shown_frames == 1
    assert gui.destroyed_windows == [PREVIEW_WINDOW_NAME]
