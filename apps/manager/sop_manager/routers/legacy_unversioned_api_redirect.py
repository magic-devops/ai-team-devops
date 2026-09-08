"""将未带版本的 `/api/*` 永久重定向到 `/api/v1/*`（兼容旧脚本与浏览器缓存）。

排除：
- 已是 `/api/v1/*`
- Docker 遗留面 `/api/env/*`（见 ``docker_env`` 中 ``/api/env/security`` 路由）

使用 308，保留方法与 body（客户端跟随重定向时行为正确）。
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable

from starlette.requests import Request
from starlette.responses import RedirectResponse, Response

MiddlewareFn = Callable[[Request], Awaitable[Response]]


async def legacy_unversioned_api_redirect_middleware(
    request: Request, call_next: MiddlewareFn
) -> Response:
    path = request.url.path
    if (
        path.startswith("/api/")
        and not path.startswith("/api/v1/")
        and not path.startswith("/api/v2/")
        and not path.startswith("/api/env/")
    ):
        tail = path[len("/api/") :]
        new_path = "/api/v1/" + tail
        url = request.url.replace(path=new_path)
        return RedirectResponse(url=str(url), status_code=308)
    return await call_next(request)
