"""
@module: sop_cli.commands.db_config
@purpose: 远端 SQL/多模数据库配置：OceanBase、PostgreSQL、MySQL 等
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import typer
from rich.table import Table

from .._util import console, get_client, get_config, ok, warn

app = typer.Typer(help="数据库配置：drivers/list/add/test/delete/export（OceanBase/PG/MySQL）")


def _local_config_path() -> Path:
    return get_config().project_path / ".sop-runtime" / "db_connections.json"


def _write_local_cache(data: dict[str, Any]) -> Path:
    p = _local_config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return p


def _parse_options(items: list[str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for item in items:
        k, sep, v = item.partition("=")
        if not sep or not k.strip():
            raise typer.BadParameter("--option 需使用 key=value")
        out[k.strip()] = v
    return out


@app.command("list")
def list_connections(
    local: bool = typer.Option(False, "--local", help="只读取本地缓存"),
    json_output: bool = typer.Option(False, "--json", help="输出 JSON"),
) -> None:
    """列出数据库连接配置，不含密钥。"""
    if local:
        p = _local_config_path()
        data = json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {"items": [], "total": 0}
    else:
        try:
            data = get_client().db_connections()
            _write_local_cache(data)
        except Exception as e:
            warn(f"Manager db-config 不可用，回退本地缓存: {e}")
            p = _local_config_path()
            data = json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {"items": [], "total": 0}
    if json_output:
        console.print_json(data=data)
        return
    _render_connections(list(data.get("items", [])))


@app.command("drivers")
def drivers(json_output: bool = typer.Option(False, "--json", help="输出 JSON")) -> None:
    """列出 Manager 支持的数据源类型、能力和连接串模板。"""
    data = get_client().db_drivers()
    if json_output:
        console.print_json(data=data)
        return
    console.print_json(data=data)


@app.command("add")
def add_connection(
    name: str = typer.Argument(..., help="连接名，如 prod-ob / analytics-pg"),
    db_type: str = typer.Option(..., "--type", help="sqlite|mysql|postgres|postgresql|oceanbase"),
    role: str = typer.Option("business", "--role", help="metadata|business|analytics|vector|memory|audit"),
    capability: list[str] = typer.Option([], "--capability", help="数据能力 sql/vector/json/graph/analytics/memory/audit，可重复；默认 sql"),
    driver: str = typer.Option("", "--driver", help="驱动提示，如 psycopg/pymysql"),
    host: str = typer.Option("", "--host"),
    port: int | None = typer.Option(None, "--port"),
    database: str = typer.Option("", "--database"),
    username: str = typer.Option("", "--username"),
    schema_name: str = typer.Option("", "--schema"),
    ssl_mode: str = typer.Option("", "--ssl-mode"),
    readonly: bool = typer.Option(False, "--readonly", help="标记为只读数据源"),
    pool_size: int | None = typer.Option(None, "--pool-size"),
    url_env: str = typer.Option("", "--url-env", help="连接串环境变量名，避免明文保存"),
    secret_ref: str = typer.Option("", "--secret-ref", help="密钥引用，如 env://APP_DB_URL"),
    option: list[str] = typer.Option([], "--option", help="额外配置 key=value，可重复"),
) -> None:
    """新增/更新远端数据库连接配置，不保存明文密码。"""
    body = {
        "name": name,
        "type": db_type,
        "role": role,
        "capabilities": capability or ["sql"],
        "driver": driver,
        "host": host,
        "port": port,
        "database": database,
        "username": username,
        "schema_name": schema_name,
        "ssl_mode": ssl_mode,
        "readonly": readonly,
        "pool_size": pool_size,
        "url_env": url_env,
        "secret_ref": secret_ref,
        "options": _parse_options(option),
    }
    out = get_client().db_upsert_connection(name, body)
    ok(f"db connection saved: {out.get('config', {}).get('name', name)}")


@app.command("test")
def test_connection(
    name: str = typer.Argument(..., help="连接名"),
    url: str = typer.Option("", "--url", help="临时连接串，仅用于测试，不保存"),
    json_output: bool = typer.Option(False, "--json", help="输出 JSON"),
) -> None:
    """测试已保存数据库连接；可临时传 --url。"""
    out = get_client().db_test_connection(name, url=url)
    if json_output:
        console.print_json(data=out)
        return
    ok(str(out.get("message") or out))


@app.command("delete")
def delete_connection(name: str = typer.Argument(..., help="连接名")) -> None:
    """删除数据库连接配置。"""
    get_client().db_delete_connection(name)
    ok(f"db connection deleted: {name}")


@app.command("export")
def export_connections(out: str = typer.Option(".sop-runtime/db_connections.json", "--out", "-o")) -> None:
    """导出无密钥连接配置，供 Agent/Data 工具读取。"""
    data = get_client().db_connections()
    path = Path(out).expanduser()
    if not path.is_absolute():
        path = get_config().project_path / path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    ok(f"wrote {path}")


def _render_connections(rows: list[dict[str, Any]]) -> None:
    tbl = Table(title="db connections", show_header=True, header_style="bold")
    for col in ("name", "type", "role", "capabilities", "host", "port", "database", "url_env", "secret_ref"):
        tbl.add_column(col)
    for row in rows:
        tbl.add_row(
            str(row.get("name", "")),
            str(row.get("type", "")),
            str(row.get("role", "")),
            ",".join(str(x) for x in row.get("capabilities", []) or []),
            str(row.get("host", "")),
            str(row.get("port") or ""),
            str(row.get("database", "")),
            str(row.get("url_env", "")),
            str(row.get("secret_ref", "")),
        )
    console.print(tbl)


@app.callback(invoke_without_command=True)
def _root(ctx: typer.Context) -> None:
    if ctx.invoked_subcommand is not None:
        return
    list_connections()
