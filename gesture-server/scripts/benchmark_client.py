from __future__ import annotations

# /// script
# requires-python = ">=3.10,<3.11"
# dependencies = [
#   "opencv-python==5.0.0.93",
#   "websockets>=16,<17",
# ]
# ///

import argparse
import asyncio
import json
import math
import os
import time
from dataclasses import asdict, dataclass
from itertools import chain
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence

import cv2
import websockets


@dataclass(frozen=True, slots=True)
class BenchmarkSample:
    capture_ms: float
    compression_ms: float
    rtt_ms: float
    decode_ms: float
    preprocess_ms: float
    inference_ms: float
    postprocess_ms: float
    server_total_ms: float
    end_to_end_ms: float
    jpeg_bytes: int
    tracker_ms: float | None = None
    presentation_ms: float | None = None


@dataclass(frozen=True, slots=True)
class BenchmarkCounts:
    captured: int = 0
    sent: int = 0
    completed: int = 0
    superseded: int = 0
    rejected: int = 0


def nearest_rank(values: Sequence[float], percentile: float) -> float | None:
    if not values:
        return None
    if not 0 < percentile <= 100:
        raise ValueError("percentile must be greater than zero and at most 100")
    ordered = sorted(values)
    rank = math.ceil((percentile / 100) * len(ordered))
    return ordered[rank - 1]


def _metric(values: Iterable[float | None]) -> dict[str, float] | None:
    measured = [value for value in values if value is not None]
    if not measured:
        return None
    return {
        "p50": round(nearest_rank(measured, 50) or 0, 3),
        "p95": round(nearest_rank(measured, 95) or 0, 3),
    }


def _validate_counts(counts: BenchmarkCounts, sample_count: int) -> None:
    if counts.captured != counts.sent + counts.superseded:
        raise ValueError("captured = sent + superseded must hold")
    if counts.sent != counts.completed + counts.rejected:
        raise ValueError("sent = completed + rejected must hold")
    if counts.completed != sample_count:
        raise ValueError("completed must equal the number of samples")
    if any(value < 0 for value in asdict(counts).values()):
        raise ValueError("counts cannot be negative")


def summarize(
    samples: Sequence[BenchmarkSample],
    *,
    counts: BenchmarkCounts,
    elapsed_seconds: float,
) -> dict[str, Any]:
    if elapsed_seconds <= 0:
        raise ValueError("elapsed_seconds must be positive")
    _validate_counts(counts, len(samples))
    discarded = counts.superseded + counts.rejected
    total_bytes = sum(sample.jpeg_bytes for sample in samples)
    return {
        "counts": asdict(counts),
        "effectiveFps": round(counts.completed / elapsed_seconds, 3),
        "discardedFrames": discarded,
        "discardRate": round(discarded / counts.captured, 6) if counts.captured else 0,
        "jpegBytes": {
            "total": total_bytes,
            "mean": round(total_bytes / counts.completed, 3) if counts.completed else 0,
        },
        "metricsMs": {
            "capture": _metric(sample.capture_ms for sample in samples),
            "compression": _metric(sample.compression_ms for sample in samples),
            "rtt": _metric(sample.rtt_ms for sample in samples),
            "decode": _metric(sample.decode_ms for sample in samples),
            "preprocess": _metric(sample.preprocess_ms for sample in samples),
            "inference": _metric(sample.inference_ms for sample in samples),
            "postprocess": _metric(sample.postprocess_ms for sample in samples),
            "serverTotal": _metric(sample.server_total_ms for sample in samples),
            "endToEnd": _metric(sample.end_to_end_ms for sample in samples),
            "tracker": _metric(sample.tracker_ms for sample in samples),
            "presentation": _metric(sample.presentation_ms for sample in samples),
        },
    }


def _image_paths(directory: Path) -> list[Path]:
    extensions = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    return sorted(
        path for path in directory.iterdir() if path.is_file() and path.suffix.lower() in extensions
    )


def _read_images(paths: Sequence[Path], max_frames: int | None) -> Iterator[tuple[Any, float]]:
    for index, path in enumerate(paths):
        if max_frames is not None and index >= max_frames:
            return
        started_at = time.perf_counter()
        frame = cv2.imread(str(path))
        capture_ms = (time.perf_counter() - started_at) * 1_000
        if frame is None:
            raise ValueError(f"could not decode supplied image: {path.name}")
        yield frame, capture_ms


def _read_video(path: Path, max_frames: int | None) -> Iterator[tuple[Any, float]]:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise ValueError(f"could not open supplied video: {path.name}")
    try:
        index = 0
        while max_frames is None or index < max_frames:
            started_at = time.perf_counter()
            available, frame = capture.read()
            capture_ms = (time.perf_counter() - started_at) * 1_000
            if not available:
                return
            index += 1
            yield frame, capture_ms
    finally:
        capture.release()


def read_supplied_frames(path: Path, max_frames: int | None) -> Iterator[tuple[Any, float]]:
    if path.is_dir():
        paths = _image_paths(path)
        if not paths:
            raise ValueError("the supplied directory contains no supported images")
        yield from _read_images(paths, max_frames)
        return
    if not path.is_file():
        raise ValueError("the supplied input path does not exist")
    if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}:
        yield from _read_images([path], max_frames)
        return
    yield from _read_video(path, max_frames)


def compress_frame(frame: Any, max_width: int, quality: int) -> tuple[bytes, float]:
    started_at = time.perf_counter()
    height, width = frame.shape[:2]
    if width > max_width:
        scale = max_width / width
        frame = cv2.resize(frame, (max_width, round(height * scale)), interpolation=cv2.INTER_AREA)
    encoded, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    compression_ms = (time.perf_counter() - started_at) * 1_000
    if not encoded:
        raise ValueError("could not compress supplied frame")
    return buffer.tobytes(), compression_ms


def _sample_from_pose(
    payload: dict[str, Any],
    *,
    capture_ms: float,
    compression_ms: float,
    rtt_ms: float,
    jpeg_bytes: int,
) -> BenchmarkSample:
    timings = payload["timings"]
    return BenchmarkSample(
        capture_ms=capture_ms,
        compression_ms=compression_ms,
        rtt_ms=rtt_ms,
        decode_ms=float(timings["decodeMs"]),
        preprocess_ms=float(timings["preprocessMs"]),
        inference_ms=float(timings["inferenceMs"]),
        postprocess_ms=float(timings["postprocessMs"]),
        server_total_ms=float(timings["totalMs"]),
        end_to_end_ms=capture_ms + compression_ms + rtt_ms,
        jpeg_bytes=jpeg_bytes,
    )


async def run_benchmark(args: argparse.Namespace, token: str) -> dict[str, Any]:
    samples: list[BenchmarkSample] = []
    captured = sent = rejected = 0
    async with websockets.connect(
        args.url,
        origin=args.origin,
        proxy=None,
        max_size=2 * 1024 * 1024,
    ) as socket:
        await socket.send(
            json.dumps({"type": "hello", "protocolVersion": 1, "token": token})
        )
        ready = json.loads(await socket.recv())
        if ready.get("type") != "ready":
            raise RuntimeError("server did not complete the benchmark handshake")

        frames = iter(read_supplied_frames(args.input, args.max_frames))
        try:
            first_frame = next(frames)
        except StopIteration as error:
            raise ValueError("the supplied input contains no frames") from error

        warmup_jpeg, _ = compress_frame(
            first_frame[0], args.max_width, args.jpeg_quality
        )
        for warmup_index in range(args.warmup_frames):
            frame_id = warmup_index + 1
            await socket.send(
                frame_id.to_bytes(4, byteorder="big", signed=False) + warmup_jpeg
            )
            warmup_payload = json.loads(await socket.recv())
            if (
                warmup_payload.get("type") != "pose"
                or warmup_payload.get("frameId") != frame_id
            ):
                raise RuntimeError("server rejected a CUDA warmup frame")

        started_at = time.perf_counter()
        for frame_id, (frame, capture_ms) in enumerate(
            chain([first_frame], frames),
            start=args.warmup_frames + 1,
        ):
            captured += 1
            jpeg, compression_ms = compress_frame(frame, args.max_width, args.jpeg_quality)
            message = frame_id.to_bytes(4, byteorder="big", signed=False) + jpeg
            request_started_at = time.perf_counter()
            await socket.send(message)
            sent += 1
            payload = json.loads(await socket.recv())
            rtt_ms = (time.perf_counter() - request_started_at) * 1_000
            if payload.get("type") == "error":
                rejected += 1
                continue
            if payload.get("type") != "pose" or payload.get("frameId") != frame_id:
                raise RuntimeError("server returned an unexpected benchmark response")
            samples.append(
                _sample_from_pose(
                    payload,
                    capture_ms=capture_ms,
                    compression_ms=compression_ms,
                    rtt_ms=rtt_ms,
                    jpeg_bytes=len(jpeg),
                )
            )

        elapsed_seconds = time.perf_counter() - started_at
    return summarize(
        samples,
        counts=BenchmarkCounts(
            captured=captured,
            sent=sent,
            completed=len(samples),
            rejected=rejected,
        ),
        elapsed_seconds=elapsed_seconds,
    )


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Benchmark the private gesture WebSocket without persisting frames or poses."
    )
    parser.add_argument("--url", required=True, help="Private ws:// URL ending in /v1/pose")
    parser.add_argument("--origin", default="http://localhost:5173")
    parser.add_argument("--input", required=True, type=Path, help="Video, image, or image directory")
    parser.add_argument("--max-frames", type=int)
    parser.add_argument(
        "--warmup-frames",
        type=int,
        default=3,
        help="Unmeasured repetitions of the first frame before collection",
    )
    parser.add_argument("--max-width", type=int, default=640)
    parser.add_argument("--jpeg-quality", type=int, default=80)
    parser.add_argument("--token-env", default="GESTURE_BENCHMARK_TOKEN")
    parser.add_argument("--output", type=Path, help="Optional aggregate-only JSON output")
    args = parser.parse_args(argv)
    if args.max_frames is not None and args.max_frames <= 0:
        parser.error("--max-frames must be positive")
    if args.warmup_frames < 0:
        parser.error("--warmup-frames cannot be negative")
    if args.max_width <= 0:
        parser.error("--max-width must be positive")
    if not 1 <= args.jpeg_quality <= 100:
        parser.error("--jpeg-quality must be between 1 and 100")
    return args


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    token = os.environ.get(args.token_env, "").strip()
    if not token:
        raise SystemExit(f"required token environment variable is missing: {args.token_env}")
    summary = asyncio.run(run_benchmark(args, token))
    serialized = json.dumps(summary, ensure_ascii=False, indent=2)
    print(serialized)
    if args.output is not None:
        args.output.write_text(serialized + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
