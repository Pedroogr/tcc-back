FROM ghcr.io/astral-sh/uv:0.12.23 AS uv

FROM nvidia/cuda:13.0.0-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        ca-certificates \
        libgl1 \
        libglib2.0-0 \
        python3.10 \
        python3.10-venv \
    && rm -rf /var/lib/apt/lists/*

COPY --from=uv /uv /uvx /bin/

RUN groupadd --system gesture \
    && useradd --system --gid gesture --create-home gesture

WORKDIR /app/gesture-server

COPY gesture-server/pyproject.toml gesture-server/uv.lock ./

RUN UV_COMPILE_BYTECODE=0 uv sync \
    --frozen \
    --no-dev \
    --no-cache \
    --no-install-project \
    --python /usr/bin/python3.10

ENV UV_COMPILE_BYTECODE=0

COPY --chown=gesture:gesture gesture-server/app ./app
COPY --chown=gesture:gesture gesture-server/scripts ./scripts
COPY --chown=gesture:gesture gesture-poc/yolo11s-pose.pt /app/gesture-poc/yolo11s-pose.pt

ENV PATH="/app/gesture-server/.venv/bin:${PATH}" \
    GESTURE_MODEL_PATH=/app/gesture-poc/yolo11s-pose.pt \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility \
    YOLO_CONFIG_DIR=/tmp

USER gesture

EXPOSE 8765

CMD ["uvicorn", "app.main:create_configured_app", "--factory", "--host", "0.0.0.0", "--port", "8765", "--workers", "1"]
