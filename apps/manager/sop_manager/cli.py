"""`sop-manager` 命令入口：启动 / 数据库迁移 / 健康检查 / 创建管理员。"""
from __future__ import annotations

import argparse
import os
import sys


def _start(host: str, port: int, reload: bool) -> int:
    try:
        import uvicorn
    except ImportError:  # pragma: no cover
        print("缺少 uvicorn。请: pip install 'sop-manager'", file=sys.stderr)
        return 1
    # sop_manager:get_app 工厂加载 FastAPI app
    uvicorn.run(
        "sop_manager:get_app",
        factory=True,
        host=host,
        port=port,
        reload=reload,
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="sop-manager", description="ai-team-devops Manager 控制命令")
    sub = parser.add_subparsers(dest="cmd", required=True)

    start = sub.add_parser("start", help="启动 Manager（uvicorn）")
    start.add_argument("--host", default=os.getenv("HOST", "0.0.0.0"))
    start.add_argument("--port", type=int, default=int(os.getenv("PORT", "8765")))
    start.add_argument("--reload", action="store_true", help="开发热重载")

    sub.add_parser("health", help="探活")
    sub.add_parser("version", help="显示版本")

    args = parser.parse_args(argv)
    if args.cmd == "start":
        return _start(args.host, args.port, args.reload)
    if args.cmd == "health":
        try:
            from sop_manager import get_app  # noqa: F401
            print("ok")
            return 0
        except Exception as exc:  # pragma: no cover
            print(f"fail: {exc}", file=sys.stderr)
            return 1
    if args.cmd == "version":
        from sop_manager import __version__
        print(__version__)
        return 0
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
