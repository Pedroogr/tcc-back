from __future__ import annotations

import asyncio
import logging
import secrets
import time
from typing import Any, Mapping

from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect

from .config import GestureSettings
from .inference import InferenceError, PoseEngine
from .protocol import ProtocolError, parse_frame, parse_hello, serialize_error, serialize_pose


LOGGER = logging.getLogger(__name__)

CLOSE_INVALID_MESSAGE = 4400
CLOSE_UNAUTHORIZED = 4401
CLOSE_ORIGIN_NOT_ALLOWED = 4403
CLOSE_UNSUPPORTED_PROTOCOL = 4406
CLOSE_HELLO_TIMEOUT = 4408
CLOSE_STATION_BUSY = 4429
CLOSE_SERVICE_UNAVAILABLE = 1013


class StationManager:
    """Owns the single authenticated-station lease for one application process."""

    def __init__(self) -> None:
        self._guard = asyncio.Lock()
        self._active = False

    async def claim(self) -> bool:
        async with self._guard:
            if self._active:
                return False
            self._active = True
            return True

    async def release(self) -> None:
        async with self._guard:
            self._active = False


def _ready_payload(engine: PoseEngine, settings: GestureSettings) -> dict[str, Any]:
    metadata: Mapping[str, Any] = engine.metadata
    return {
        "type": "ready",
        "protocolVersion": settings.protocol_version,
        "model": metadata["model"],
        "device": metadata["device"],
    }


async def _close(websocket: WebSocket, code: int, reason: str) -> None:
    LOGGER.warning("websocket event=rejected code=%s", reason)
    await websocket.close(code=code, reason=reason)


async def serve_pose_websocket(
    websocket: WebSocket,
    engine: PoseEngine,
    settings: GestureSettings,
    stations: StationManager,
) -> None:
    if websocket.headers.get("origin") not in settings.allowed_origins:
        await _close(websocket, CLOSE_ORIGIN_NOT_ALLOWED, "origin_not_allowed")
        return
    if not engine.ready:
        await _close(websocket, CLOSE_SERVICE_UNAVAILABLE, "service_not_ready")
        return

    await websocket.accept()
    claimed = False
    try:
        try:
            raw_hello = await asyncio.wait_for(
                websocket.receive_text(),
                timeout=settings.hello_timeout_seconds,
            )
        except asyncio.TimeoutError:
            await _close(websocket, CLOSE_HELLO_TIMEOUT, "hello_timeout")
            return
        except WebSocketDisconnect:
            return

        try:
            hello = parse_hello(raw_hello, settings.protocol_version)
        except ProtocolError as error:
            close_code = (
                CLOSE_UNSUPPORTED_PROTOCOL
                if error.code == "unsupported_protocol"
                else CLOSE_INVALID_MESSAGE
            )
            await _close(websocket, close_code, error.code)
            return

        if not secrets.compare_digest(hello.token.encode(), settings.token.encode()):
            await _close(websocket, CLOSE_UNAUTHORIZED, "unauthorized")
            return
        if not await stations.claim():
            await _close(websocket, CLOSE_STATION_BUSY, "station_busy")
            return
        claimed = True

        await websocket.send_json(_ready_payload(engine, settings))
        LOGGER.info("websocket event=station_ready")

        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                return
            payload = message.get("bytes")
            if payload is None:
                await _close(websocket, CLOSE_INVALID_MESSAGE, "binary_frame_required")
                return

            try:
                frame = parse_frame(payload, settings.max_jpeg_bytes)
            except ProtocolError as error:
                frame_id = int.from_bytes(payload[:4], "big") if len(payload) >= 4 else None
                LOGGER.warning(
                    "websocket event=frame_rejected code=%s bytes=%d",
                    error.code,
                    len(payload),
                )
                await websocket.send_json(
                    serialize_error(
                        settings.protocol_version,
                        error.code,
                        str(error),
                        frame_id,
                    )
                )
                continue

            started_at = time.perf_counter()
            try:
                result = await asyncio.to_thread(engine.infer, frame.jpeg)
            except InferenceError as error:
                LOGGER.warning(
                    "websocket event=inference_rejected code=%s bytes=%d",
                    error.code,
                    len(frame.jpeg),
                )
                await websocket.send_json(
                    serialize_error(
                        settings.protocol_version,
                        error.code,
                        str(error),
                        frame.frame_id,
                    )
                )
                continue
            except Exception:
                LOGGER.error(
                    "websocket event=inference_failed code=inference_failed bytes=%d",
                    len(frame.jpeg),
                )
                await websocket.send_json(
                    serialize_error(
                        settings.protocol_version,
                        "inference_failed",
                        "A inferência não pôde ser concluída.",
                        frame.frame_id,
                    )
                )
                continue

            duration_ms = (time.perf_counter() - started_at) * 1000
            LOGGER.info(
                "websocket event=inference_completed frame_id=%d bytes=%d duration_ms=%.3f",
                frame.frame_id,
                len(frame.jpeg),
                duration_ms,
            )
            await websocket.send_json(
                serialize_pose(settings.protocol_version, frame.frame_id, result)
            )
    except WebSocketDisconnect:
        return
    finally:
        if claimed:
            await stations.release()
            LOGGER.info("websocket event=station_released")
