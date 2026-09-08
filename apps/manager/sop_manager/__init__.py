"""sop-manager：SOP 管理面 FastAPI 应用（`sop_manager.main`）与 CLI `sop-manager`。

前后端分离：HTTP API 在本包；浏览器 UI 在仓库 `apps/manager-web`。
"""
from __future__ import annotations

__version__ = "1.0.0"
__all__ = ["app", "get_app", "__version__"]


def _default_project_path() -> None:
    import os
    from pathlib import Path

    if os.environ.get("PROJECT_PATH"):
        return
    here = Path(__file__).resolve()
    repo_root = here.parents[3]
    os.environ.setdefault("PROJECT_PATH", str(repo_root))


_default_project_path()

from sop_manager.main import app  # noqa: E402


def get_app():
    """uvicorn 工厂：`uvicorn sop_manager:get_app --factory`。"""
    from sop_manager.main import app as _app

    return _app
