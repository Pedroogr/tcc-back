from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, Callable, Mapping

from fastapi import FastAPI, WebSocket
from fastapi.responses import JSONResponse

from .config import GestureSettings
from .inference import EngineStartupError, InferenceError, PoseEngine, create_cuda_engine
from .protocol import PoseResult
from .session import StationManager, serve_pose_websocket


def create_app(
    engine: PoseEngine,
    settings: GestureSettings,
    *,
    lifespan: Any = None,
) -> FastAPI:
    stations = StationManager()
    app = FastAPI(
        title="TCC Gesture Server",
        docs_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )

    @app.get("/health", response_model=None)
    def health() -> JSONResponse | dict[str, Any]:
        base_response: dict[str, Any] = {
            "status": "ready" if engine.ready else "not_ready",
            "protocolVersion": settings.protocol_version,
        }
        if not engine.ready:
            return JSONResponse(status_code=503, content=base_response)
        return {**base_response, **engine.metadata}

    @app.websocket("/v1/pose")
    async def pose_websocket(websocket: WebSocket) -> None:
        await serve_pose_websocket(websocket, engine, settings, stations)

    return app


class EngineSlot:
    def __init__(self) -> None:
        self.engine: PoseEngine | None = None

    @property
    def ready(self) -> bool:
        return self.engine is not None and self.engine.ready

    @property
    def metadata(self) -> Mapping[str, Any]:
        return {} if self.engine is None else self.engine.metadata

    def infer(self, jpeg: bytes) -> PoseResult:
        if self.engine is None:
            raise InferenceError("service_not_ready", "O serviço não está pronto.")
        return self.engine.infer(jpeg)

    def close(self) -> None:
        engine = self.engine
        self.engine = None
        close = getattr(engine, "close", None)
        if callable(close):
            close()


def create_production_app(
    settings: GestureSettings,
    *,
    engine_factory: Callable[[GestureSettings], PoseEngine] = create_cuda_engine,
) -> FastAPI:
    slot = EngineSlot()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        try:
            slot.engine = engine_factory(settings)
        except EngineStartupError:
            slot.engine = None
        try:
            yield
        finally:
            slot.close()

    return create_app(slot, settings, lifespan=lifespan)


def create_configured_app() -> FastAPI:
    """Build the production application from validated `GESTURE_*` settings."""

    return create_production_app(GestureSettings.from_env())
