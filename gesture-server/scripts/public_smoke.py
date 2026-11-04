from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from typing import Any

import websockets


PROTOCOL_VERSION = 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate the public gesture WebSocket handshake.")
    parser.add_argument("--url", required=True)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--timeout", type=float, default=5.0)
    return parser.parse_args()


async def smoke(url: str, origin: str, token: str, timeout: float) -> None:
    async with websockets.connect(
        url,
        origin=origin,
        open_timeout=timeout,
        close_timeout=timeout,
    ) as websocket:
        await websocket.send(
            json.dumps(
                {
                    "type": "hello",
                    "protocolVersion": PROTOCOL_VERSION,
                    "token": token,
                }
            )
        )
        raw_response = await asyncio.wait_for(websocket.recv(), timeout=timeout)
        response: Any = json.loads(raw_response)
        if not isinstance(response, dict):
            raise RuntimeError("unexpected response")
        if response.get("type") != "ready":
            raise RuntimeError("worker did not become ready")
        if response.get("protocolVersion") != PROTOCOL_VERSION:
            raise RuntimeError("protocol mismatch")


def main() -> int:
    args = parse_args()
    token = os.environ.get("GESTURE_TOKEN", "").strip()
    if not token or args.timeout <= 0:
        print("gesture-smoke: failed", file=sys.stderr)
        return 1
    try:
        asyncio.run(smoke(args.url, args.origin, token, args.timeout))
    except Exception:
        print("gesture-smoke: failed", file=sys.stderr)
        return 1
    print("gesture-smoke: ready")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
