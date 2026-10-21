from __future__ import annotations

from typing import Any, Mapping, Protocol

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .config import GestureSettings


class HealthEngine(Protocol):
    @property
    def ready(self) -> bool: ...

    @property
    def metadata(self) -> Mapping[str, Any]: ...


def create_app(engine: HealthEngine, settings: GestureSettings) -> FastAPI:
    app = FastAPI(title="TCC Gesture Server", docs_url=None, redoc_url=None)

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
