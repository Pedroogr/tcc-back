from __future__ import annotations

import pytest

from scripts.benchmark_client import (
    BenchmarkCounts,
    BenchmarkSample,
    nearest_rank,
    parse_args,
    summarize,
)


def sample(value: float, jpeg_bytes: int = 1_000) -> BenchmarkSample:
    return BenchmarkSample(
        capture_ms=value,
        compression_ms=value + 1,
        rtt_ms=value + 2,
        decode_ms=value + 3,
        preprocess_ms=value + 4,
        inference_ms=value + 5,
        postprocess_ms=value + 6,
        server_total_ms=value + 7,
        end_to_end_ms=value + 8,
        jpeg_bytes=jpeg_bytes,
    )


def test_nearest_rank_returns_observed_p50_and_p95() -> None:
    values = [float(value) for value in range(1, 21)]

    assert nearest_rank(values, 50) == 10
    assert nearest_rank(values, 95) == 19
    assert nearest_rank([], 95) is None


def test_summary_aggregates_percentiles_fps_discards_and_bytes() -> None:
    counts = BenchmarkCounts(
        captured=10,
        sent=8,
        completed=7,
        superseded=2,
        rejected=1,
    )

    result = summarize(
        [sample(float(value), jpeg_bytes=value * 100) for value in range(1, 8)],
        counts=counts,
        elapsed_seconds=2,
    )

    assert result["counts"] == {
        "captured": 10,
        "sent": 8,
        "completed": 7,
        "superseded": 2,
        "rejected": 1,
    }
    assert result["effectiveFps"] == 3.5
    assert result["discardedFrames"] == 3
    assert result["discardRate"] == 0.3
    assert result["jpegBytes"] == {"total": 2_800, "mean": 400.0}
    assert result["metricsMs"]["capture"] == {"p50": 4.0, "p95": 7.0}
    assert result["metricsMs"]["endToEnd"] == {"p50": 12.0, "p95": 15.0}
    assert result["metricsMs"]["tracker"] is None
    assert result["metricsMs"]["presentation"] is None


def test_summary_rejects_inconsistent_counts() -> None:
    with pytest.raises(ValueError, match=r"captured = sent \+ superseded"):
        summarize(
            [sample(1)],
            counts=BenchmarkCounts(
                captured=2,
                sent=2,
                completed=1,
                superseded=1,
                rejected=1,
            ),
            elapsed_seconds=1,
        )


def test_empty_summary_is_explicit_and_does_not_invent_measurements() -> None:
    result = summarize([], counts=BenchmarkCounts(), elapsed_seconds=1)

    assert result["effectiveFps"] == 0
    assert result["discardRate"] == 0
    assert result["jpegBytes"] == {"total": 0, "mean": 0}
    assert all(metric is None for metric in result["metricsMs"].values())


def test_cli_defaults_to_three_unmeasured_cuda_warmup_frames() -> None:
    args = parse_args(
        [
            "--url",
            "ws://127.0.0.1:8765/v1/pose",
            "--input",
            "sample.mp4",
        ]
    )

    assert args.warmup_frames == 3
