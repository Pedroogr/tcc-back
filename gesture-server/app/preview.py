from __future__ import annotations

import logging
import time
from collections import deque
from dataclasses import dataclass
from typing import Any, Callable, Protocol

import cv2

from .protocol import PersonPose, PoseTimings


BOX_COLOR = (0, 255, 0)
KEYPOINT_COLOR = (0, 255, 255)
SKELETON_COLOR = (0, 165, 255)
KEYPOINT_CONFIDENCE = 0.25
PREVIEW_WINDOW_NAME = "TCC - monitor de gestos (Q para fechar)"
SKELETON_CONNECTIONS = (
    (0, 1),
    (0, 2),
    (1, 3),
    (2, 4),
    (5, 6),
    (5, 7),
    (7, 9),
    (6, 8),
    (8, 10),
    (5, 11),
    (6, 12),
    (11, 12),
    (11, 13),
    (13, 15),
    (12, 14),
    (14, 16),
)
LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class PreviewFrame:
    image: Any
    poses: tuple[PersonPose, ...]
    timings: PoseTimings
    jpeg_bytes: int
    model_name: str
    device_name: str


class FramePreview(Protocol):
    def show(self, frame: PreviewFrame) -> bool: ...

    def close(self) -> None: ...


class RollingProcessingFps:
    def __init__(self, window_size: int = 30) -> None:
        if window_size < 2:
            raise ValueError("window_size must be at least 2")
        self._timestamps: deque[float] = deque(maxlen=window_size)

    def record(self, timestamp: float) -> float | None:
        self._timestamps.append(timestamp)
        if len(self._timestamps) < 2:
            return None
        elapsed = self._timestamps[-1] - self._timestamps[0]
        if elapsed <= 0:
            return None
        return (len(self._timestamps) - 1) / elapsed


def build_preview_lines(
    frame: PreviewFrame,
    *,
    frame_count: int,
    server_fps: float | None,
) -> tuple[str, ...]:
    height, width = frame.image.shape[:2]
    fps_label = "medindo..." if server_fps is None else f"{server_fps:.1f}"
    timings = frame.timings
    return (
        f"GPU: {frame.device_name} | Modelo: {frame.model_name}",
        f"Frame: {frame_count} | Entrada: {width}x{height} | JPEG: {frame.jpeg_bytes / 1024:.1f} KiB",
        f"Pessoas detectadas: {len(frame.poses)} | FPS servidor: {fps_label}",
        f"Decode: {timings.decode_ms:.1f} ms | Pre: {timings.preprocess_ms:.1f} ms | Inferencia: {timings.inference_ms:.1f} ms",
        f"Pos: {timings.postprocess_ms:.1f} ms | Total: {timings.total_ms:.1f} ms",
    )


def _reliable(point: Any) -> bool:
    return point.confidence >= KEYPOINT_CONFIDENCE


def _draw_pose(rendered: Any, pose: PersonPose, index: int) -> None:
    for start_index, end_index in SKELETON_CONNECTIONS:
        if start_index >= len(pose.keypoints) or end_index >= len(pose.keypoints):
            continue
        start_point = pose.keypoints[start_index]
        end_point = pose.keypoints[end_index]
        if _reliable(start_point) and _reliable(end_point):
            cv2.line(
                rendered,
                (round(start_point.x), round(start_point.y)),
                (round(end_point.x), round(end_point.y)),
                SKELETON_COLOR,
                2,
            )

    for point in pose.keypoints:
        if _reliable(point):
            cv2.circle(
                rendered,
                (round(point.x), round(point.y)),
                3,
                KEYPOINT_COLOR,
                -1,
            )

    start = (round(pose.box.x1), round(pose.box.y1))
    end = (round(pose.box.x2), round(pose.box.y2))
    cv2.rectangle(rendered, start, end, BOX_COLOR, 2)
    cv2.putText(
        rendered,
        f"Pessoa {index} {pose.confidence:.0%}",
        (start[0], max(18, start[1] - 8)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        BOX_COLOR,
        2,
        cv2.LINE_AA,
    )


def _draw_telemetry(rendered: Any, lines: tuple[str, ...]) -> None:
    panel_height = 14 + len(lines) * 22
    panel_width = min(rendered.shape[1], 630)
    overlay = rendered.copy()
    cv2.rectangle(overlay, (0, 0), (panel_width, panel_height), (12, 12, 12), -1)
    cv2.addWeighted(overlay, 0.72, rendered, 0.28, 0, rendered)
    for index, line in enumerate(lines):
        cv2.putText(
            rendered,
            line,
            (10, 22 + index * 22),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.48,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )


def render_pose_preview(
    frame: PreviewFrame,
    *,
    frame_count: int,
    server_fps: float | None,
) -> Any:
    rendered = frame.image.copy()
    for index, pose in enumerate(frame.poses, start=1):
        _draw_pose(rendered, pose, index)
    _draw_telemetry(
        rendered,
        build_preview_lines(frame, frame_count=frame_count, server_fps=server_fps),
    )
    return rendered


class OpenCvFramePreview:
    def __init__(
        self,
        gui: Any = cv2,
        clock: Callable[[], float] = time.perf_counter,
    ) -> None:
        self._gui = gui
        self._clock = clock
        self._processing_fps = RollingProcessingFps()
        self._frame_count = 0
        self._active = True

    def show(self, frame: PreviewFrame) -> bool:
        if not self._active:
            return False
        self._frame_count += 1
        server_fps = self._processing_fps.record(self._clock())
        try:
            rendered = render_pose_preview(
                frame,
                frame_count=self._frame_count,
                server_fps=server_fps,
            )
            self._gui.imshow(PREVIEW_WINDOW_NAME, rendered)
            key = self._gui.waitKey(1) & 0xFF
            visible = self._gui.getWindowProperty(
                PREVIEW_WINDOW_NAME,
                self._gui.WND_PROP_VISIBLE,
            )
            if key in (ord("q"), ord("Q")) or visible < 1:
                self._disable()
        except Exception:
            LOGGER.warning("debug preview disabled after display failure", exc_info=True)
            self._disable()
        return self._active

    def close(self) -> None:
        self._disable()

    def _disable(self) -> None:
        if not self._active:
            return
        self._active = False
        try:
            self._gui.destroyWindow(PREVIEW_WINDOW_NAME)
        except Exception:
            LOGGER.debug("debug preview window was already closed", exc_info=True)
