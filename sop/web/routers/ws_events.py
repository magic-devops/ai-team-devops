"""
@module: routers.ws_events
@purpose: WebSocket /ws/events —— 服务端推送任务/规则/反思等 CloudEvents
@stable: 帧格式遵循 docs/architecture/PROTOCOLS.md §2
@ai_safe_edit:
  - 新增事件类型：调 broadcast(event_dict) 即可；订阅端按 type 过滤
  - 接 Redis Streams：替换 _Bus 实现
@deps_in: fastapi.WebSocket, jwt
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections import defaultdict
from typing import Any

import jwt
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

_log = logging.getLogger("sop.ws")

router = APIRouter()


class _Bus:
    """进程内单实例事件总线；M9 升级 Redis Streams 时仅改本类。"""

    def __init__(self) -> None:
        self._subs: dict[str, set[asyncio.Queue]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def subscribe(self, project_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=1024)
        async with self._lock:
            self._subs[project_id].add(q)
        return q

    async def unsubscribe(self, project_id: str, q: asyncio.Queue) -> None:
        async with self._lock:
            self._subs.get(project_id, set()).discard(q)

    async def publish(self, project_id: str, evt: dict[str, Any]) -> None:
        async with self._lock:
            queues = list(self._subs.get(project_id, set()))
        for q in queues:
            if q.full():  # 背压：丢弃最早
                try:
                    q.get_nowait()
                except Exception:
                    pass
            try:
                q.put_nowait(evt)
            except Exception:
                pass


bus = _Bus()


def _decode_token(token: str) -> dict | None:
    if not token:
        return None
    try:
        from routers.auth_sql import ALGORITHM, SECRET_KEY  # type: ignore[import-not-found]
    except Exception:  # pragma: no cover
        SECRET_KEY = os.getenv("SECRET_KEY", "sop-default-insecure-use-env-secret-key")
        ALGORITHM = "HS256"
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        return None


@router.websocket("/ws/events")
async def ws_events(
    websocket: WebSocket,
    project_id: str = Query(""),
    token: str = Query(""),
) -> None:
    payload = _decode_token(token)
    if not payload:
        await websocket.close(code=4401)
        return
    if not project_id:
        await websocket.close(code=4400)
        return

    await websocket.accept()
    q = await bus.subscribe(project_id)
    last_pong = time.time()
    _log.info("ws connect project=%s sub_total=%d", project_id, sum(len(v) for v in bus._subs.values()))

    # 发送一条 hello
    await websocket.send_text(json.dumps({
        "specversion": "1.0", "type": "sop.ws.hello",
        "id": f"hello-{int(time.time()*1000)}",
        "data": {"project_id": project_id},
    }))

    async def reader() -> None:
        nonlocal last_pong
        while True:
            try:
                msg = await websocket.receive_text()
            except WebSocketDisconnect:
                return
            try:
                d = json.loads(msg)
                if d.get("type") == "ping":
                    last_pong = time.time()
                    await websocket.send_text(json.dumps({"type": "pong"}))
            except Exception:
                continue

    async def writer() -> None:
        while True:
            try:
                evt = await asyncio.wait_for(q.get(), timeout=30)
                await websocket.send_text(json.dumps(evt, ensure_ascii=False))
            except asyncio.TimeoutError:
                # 心跳检查
                if time.time() - last_pong > 90:
                    await websocket.close(code=1011)
                    return
                continue

    try:
        await asyncio.gather(reader(), writer())
    except Exception:
        pass
    finally:
        await bus.unsubscribe(project_id, q)
        _log.info("ws disconnect project=%s", project_id)


def broadcast(project_id: str, event: dict) -> None:
    """同步辅助：业务路由调用，把事件灌进总线（在异步上下文外也能用）。"""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.ensure_future(bus.publish(project_id, event))
        else:  # pragma: no cover
            loop.run_until_complete(bus.publish(project_id, event))
    except RuntimeError:  # pragma: no cover
        asyncio.run(bus.publish(project_id, event))
