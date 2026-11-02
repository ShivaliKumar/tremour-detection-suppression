"""WebSocket client registry and broadcast."""

from __future__ import annotations

import asyncio

from fastapi import WebSocket


class WebSocketManager:
    def __init__(self):
        self.clients: set[WebSocket] = set()

    async def connect(self, ws: WebSocket, hello: str):
        await ws.accept()
        await ws.send_text(hello)
        self.clients.add(ws)

    def disconnect(self, ws: WebSocket):
        self.clients.discard(ws)

    async def broadcast(self, text: str):
        if not self.clients:
            return
        clients = list(self.clients)
        results = await asyncio.gather(
            *(asyncio.wait_for(ws.send_text(text), timeout=2.0) for ws in clients),
            return_exceptions=True,
        )
        for ws, r in zip(clients, results):
            if isinstance(r, Exception):
                self.clients.discard(ws)
