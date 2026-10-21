from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, Callable, Mapping, Protocol

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .config import GestureSettings
from .inference import EngineStartupError, PoseEngine, create_cuda_engine


class HealthEngine(Protocol):
    @property
    def ready(self) -> bool: ...

    @property
    def metadata(self) -> Mapping[str, Any]: ...


def create_app(
    engine: HealthEngine,
    settings: GestureSettings,
    *,
    lifespan: Any = None,
) -> FastAPI:
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
        yield

    return create_app(slot, settings, lifespan=lifespan)
