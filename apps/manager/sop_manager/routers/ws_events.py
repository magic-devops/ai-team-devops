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
        from sop_manager.routers.auth_sql import ALGORITHM, SECRET_KEY  # type: ignore[import-not-found]
    except Exception:  # pragma: no cover
        SECRET_KEY = os.getenv("SECRET_KEY", "sop-default-insecure-use-env-secret-key")
        ALGORITHM = "HS256"
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        return None


def _authorized(token: str, project_id: str) -> bool:
    from fastapi import HTTPException

    from .auth_sql import check_project_access
    from .sql_models import Project, SessionLocal, User

    payload = _decode_token(token)
    if not payload:
        return False
    with SessionLocal() as db:
        user = db.get(User, payload.get("sub"))
        project = db.get(Project, project_id)
        if user is None or user.status != "active" or project is None:
            return False
        try:
            check_project_access(user, project_id, db)
            return True
        except HTTPException:
            return False


class _Connection:
    def __init__(self, websocket, project_id, token, queue):
        self.websocket = websocket
        self.project_id = project_id
        self.token = token
        self.queue = queue
        self.last_pong = time.time()

    async def send(self, frame):
        if not _authorized(self.token, self.project_id):
            await self.websocket.close(code=4403)
            return False
        await self.websocket.send_text(json.dumps(frame, ensure_ascii=False))
        return True

    async def reader(self):
        while True:
            message = await self.websocket.receive_text()
            if not _authorized(self.token, self.project_id):
                await self.websocket.close(code=4403)
                return
            try:
                value = json.loads(message)
            except ValueError:
                continue
            if isinstance(value, dict) and value.get("type") == "ping":
                self.last_pong = time.time()
                if not await self.send({"type": "pong"}):
                    return

    async def writer(self):
        while True:
            try:
                frame = await asyncio.wait_for(self.queue.get(), timeout=30)
            except asyncio.TimeoutError:
                if not _authorized(self.token, self.project_id):
                    await self.websocket.close(code=4403)
                    return
                if time.time() - self.last_pong > 90:
                    await self.websocket.close(code=1011)
                    return
                continue
            if not await self.send(frame):
                return

    async def run(self):
        tasks = []
        try:
            if not await self.send(
                {
                    "specversion": "1.0",
                    "type": "sop.ws.hello",
                    "id": f"hello-{int(time.time() * 1000)}",
                    "data": {"project_id": self.project_id},
                }
            ):
                return
            tasks = [asyncio.create_task(self.reader()), asyncio.create_task(self.writer())]
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        except WebSocketDisconnect:
            pass
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)


@router.websocket("/ws/events")
async def ws_events(websocket: WebSocket, project_id: str = Query(""), token: str = Query("")) -> None:
    if not _decode_token(token):
        await websocket.close(code=4401)
        return
    if not project_id:
        await websocket.close(code=4400)
        return
    if not _authorized(token, project_id):
        await websocket.close(code=4403)
        return
    await websocket.accept()
    queue = await bus.subscribe(project_id)
    try:
        await _Connection(websocket, project_id, token, queue).run()
    finally:
        await bus.unsubscribe(project_id, queue)


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
