"""`sop-manager` 命令入口：启动 / 数据库迁移 / 健康检查 / 创建管理员。"""
from __future__ import annotations

import argparse
import json
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


def _schema(action: str) -> int:
    if not os.environ.get("DATABASE_URL", "").strip():
        print(json.dumps({"status": "configuration_required", "message": "Set DATABASE_URL to the Manager database before schema operations."}))
        return 2
    from sop_manager.schema_upgrade import SchemaUpgradeRequired, apply_schema_upgrade, verify_schema

    try:
        from sop_manager.routers.sql_models import engine

        receipt = apply_schema_upgrade(engine) if action == "apply" else verify_schema(engine)
    except SchemaUpgradeRequired as exc:
        print(json.dumps({"status": "not_applied", "message": str(exc)}))
        return 2
    except Exception as exc:
        # Do not echo database URLs, driver parameters or credential-bearing errors.
        print(json.dumps({"status": "failed", "error_type": type(exc).__name__}))
        return 1
    print(json.dumps(receipt))
    return 0 if receipt["status"] in {"current", "upgraded"} else 2


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="sop-manager", description="ai-team-devops Manager 控制命令")
    sub = parser.add_subparsers(dest="cmd", required=True)

    start = sub.add_parser("start", help="启动 Manager（uvicorn）")
    start.add_argument("--host", default=os.getenv("HOST", "0.0.0.0"))
    start.add_argument("--port", type=int, default=int(os.getenv("PORT", "8765")))
    start.add_argument("--reload", action="store_true", help="开发热重载")

    sub.add_parser("health", help="探活")
    sub.add_parser("version", help="显示版本")
    schema = sub.add_parser("schema", help="显式验证或升级 Manager SQL schema（DATABASE_URL）")
    schema.add_argument("action", choices=("verify", "apply"))

    args = parser.parse_args(argv)
    if args.cmd == "schema":
        return _schema(args.action)
    if args.cmd == "start":
        return _start(args.host, args.port, args.reload)
    if args.cmd == "health":
        try:
            from sop_manager import get_app

            get_app()
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
