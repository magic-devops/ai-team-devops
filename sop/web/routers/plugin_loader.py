"""
@module: routers.plugin_loader
@purpose: 插件加载器 —— 通过 Python entry_points 发现第三方包，挂载它们贡献的 router / hook
@stable: Plugin 协议方法名稳定
@ai_safe_edit:
  - 新增贡献点：扩展 Plugin 协议方法（保持向后兼容）
  - 改加载顺序：sort 在 _discover() 内
@deps_in: importlib.metadata
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

_log = logging.getLogger("sop.plugins")


@runtime_checkable
class Plugin(Protocol):
    """第三方包通过 entry_points 暴露 Plugin 类。所有方法可选。"""

    name: str
    version: str

    def routers(self) -> list[Any]:  # FastAPI APIRouter
        ...

    def on_startup(self) -> None: ...

    def on_shutdown(self) -> None: ...

    def cli_commands(self) -> list[Any]:  # Typer / Click commands
        ...


@dataclass
class LoadedPlugin:
    name: str
    version: str
    instance: Any
    entry_point: str
    errors: list[str] = field(default_factory=list)


_registry: dict[str, LoadedPlugin] = {}


def discover() -> list[LoadedPlugin]:
    """扫描所有声明 `sop.plugins` 入口的包并实例化。"""
    try:
        from importlib.metadata import entry_points
    except ImportError:  # pragma: no cover
        return []

    found: list[LoadedPlugin] = []
    eps = entry_points()
    try:
        sop_eps = eps.select(group="sop.plugins")  # Py 3.10+ API
    except AttributeError:  # pragma: no cover
        sop_eps = eps.get("sop.plugins", [])  # type: ignore[assignment]

    for ep in sop_eps:
        try:
            cls = ep.load()
            inst = cls() if isinstance(cls, type) else cls
            name = getattr(inst, "name", ep.name)
            version = getattr(inst, "version", "0.0.0")
            lp = LoadedPlugin(name=name, version=version, instance=inst, entry_point=str(ep))
            _registry[name] = lp
            found.append(lp)
            _log.info("plugin loaded: %s v%s (%s)", name, version, ep)
        except Exception as e:  # pragma: no cover
            _log.error("plugin %s load failed: %s", ep, e)
    return found


def list_plugins() -> list[LoadedPlugin]:
    return list(_registry.values())


def mount(app: Any) -> None:
    """把所有插件的 FastAPI router 挂载到 app。"""
    for lp in _registry.values():
        instance = lp.instance
        if hasattr(instance, "routers"):
            try:
                for r in instance.routers() or []:
                    app.include_router(r)
            except Exception as e:  # pragma: no cover
                lp.errors.append(f"routers: {e}")
        if hasattr(instance, "on_startup"):
            try:
                instance.on_startup()
            except Exception as e:  # pragma: no cover
                lp.errors.append(f"on_startup: {e}")


def shutdown() -> None:
    for lp in _registry.values():
        if hasattr(lp.instance, "on_shutdown"):
            try:
                lp.instance.on_shutdown()
            except Exception as e:  # pragma: no cover
                lp.errors.append(f"on_shutdown: {e}")
