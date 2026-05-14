"""sop-manager: ai-team-devops 管理后台（SaaS 就绪）。

兼容期策略：
  - 真实实现仍位于仓库根的 sop/web/（保持现有引用 `sop/web/*` 不破坏）
  - 本包提供 import 别名 + 启动入口 + 部署描述文件
  - 后续按 domain 渐进迁入 sop_manager/domains/<domain>/

入口：
  - sop_manager.app  → ASGI app（uvicorn / gunicorn）
  - sop_manager.cli:main  → `sop-manager` 命令

环境变量与 sop/web/.env.example 完全一致。
"""
from __future__ import annotations

__version__ = "2.0.0-dev"
__all__ = ["app", "main"]


def _bootstrap_path() -> None:
    """将仓库根 sop/web 加入 sys.path，让旧路径平滑可用。"""
    import os
    import sys
    from pathlib import Path

    here = Path(__file__).resolve()
    # apps/manager/sop_manager/__init__.py -> repo root = parents[3]
    repo_root = here.parents[3]
    web_dir = repo_root / "sop" / "web"
    if web_dir.is_dir():
        web_str = str(web_dir)
        if web_str not in sys.path:
            sys.path.insert(0, web_str)
    if not os.environ.get("PROJECT_PATH"):
        os.environ["PROJECT_PATH"] = str(repo_root)


_bootstrap_path()

try:
    # 透传原 FastAPI app
    from main import app as _app  # type: ignore[import-not-found]
except Exception:  # pragma: no cover - 开发期 fallback
    _app = None

app = _app


def get_app():
    """uvicorn factory 用法：`uvicorn sop_manager:get_app --factory`。"""
    global app
    if app is None:
        from main import app as _a  # type: ignore[import-not-found]
        app = _a
    return app
