"""
@module: sop_cli.commands.agentd
@purpose: sop-agentd 守护进程控制：install / start / stop / status / logs
@ai_safe_edit:
  - macOS launchd / Linux systemd 模板见 install/
  - 与 apps/agent-runtime/cmd/sop-agentd 二进制配套
"""
from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import textwrap
from pathlib import Path

import typer

from .._util import console, err, kv, ok, warn

app = typer.Typer(help="sop-agentd 守护进程控制")

_PID_FILE = ".sop-runtime/agentd.pid"
_LOG_FILE = ".sop-runtime/logs/agentd.log"


def _read_pid(pidf: Path) -> int | None:
    try:
        return int(pidf.read_text().strip())
    except (OSError, ValueError):
        return None


def _pid_state(pid: int) -> str:
    try:
        os.kill(pid, 0)
        return "running"
    except ProcessLookupError:
        return "missing"
    except PermissionError:
        return "inaccessible"


def _runtime(project: Path) -> Path:
    rt = project / ".sop-runtime"
    rt.mkdir(parents=True, exist_ok=True)
    (rt / "logs").mkdir(exist_ok=True)
    return rt


def _binary() -> str | None:
    """优先 PATH 中的 sop-agentd；fallback 到仓库 apps/agent-runtime/bin/。"""
    p = shutil.which("sop-agentd")
    if p:
        return p
    here = Path(__file__).resolve()
    for parent in here.parents:
        cand = parent / "apps" / "agent-runtime" / "bin" / "sop-agentd"
        if cand.is_file() and os.access(cand, os.X_OK):
            return str(cand)
    return None


@app.command()
def start(foreground: bool = typer.Option(False, "--foreground", "-f")) -> None:
    """启动 sop-agentd。"""
    bin_path = _binary()
    if not bin_path:
        err("未找到 sop-agentd 二进制。请先构建：\n  cd apps/agent-runtime && go build -o bin/sop-agentd ./cmd/sop-agentd")
        raise typer.Exit(2)
    project = Path.cwd()
    rt = _runtime(project)
    pidf = rt / "agentd.pid"
    if pidf.is_file():
        pid = _read_pid(pidf)
        if pid is None:
            pidf.unlink(missing_ok=True)
        else:
            state = _pid_state(pid)
            if state == "running":
                warn(f"sop-agentd 已在运行，pid={pid}")
                raise typer.Exit(0)
            if state == "inaccessible":
                warn(f"PID 文件存在但当前环境无权探测 pid={pid}，为避免重复启动请先确认该进程或清理 PID 文件")
                raise typer.Exit(3)
            pidf.unlink(missing_ok=True)

    if foreground:
        kv("启动", bin_path)
        os.execv(bin_path, [bin_path])
        return  # unreachable

    logf = rt / "logs" / "agentd.log"
    proc = subprocess.Popen(
        [bin_path],
        cwd=str(project),
        stdout=open(logf, "a"),
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    pidf.write_text(str(proc.pid))
    ok(f"sop-agentd 启动，pid={proc.pid}，日志: {logf}")


@app.command()
def stop() -> None:
    """停止 sop-agentd。"""
    project = Path.cwd()
    pidf = project / _PID_FILE
    if not pidf.is_file():
        warn("未发现 PID 文件，可能未启动")
        raise typer.Exit(0)
    remove_pid_file = False
    try:
        pid = _read_pid(pidf)
        if pid is None:
            warn("PID 文件失效")
            remove_pid_file = True
            return
        os.kill(pid, signal.SIGTERM)
        ok(f"已发送 SIGTERM 到 pid={pid}")
        remove_pid_file = True
    except ProcessLookupError:
        warn("进程不存在")
        remove_pid_file = True
    except PermissionError:
        warn(f"当前环境无权停止 pid={pid}，保留 PID 文件便于后续诊断")
    finally:
        if remove_pid_file:
            pidf.unlink(missing_ok=True)


@app.command()
def status() -> None:
    """显示运行状态 + IPC 健康。"""
    from sop_sdk import AgentdIpcClient

    project = Path.cwd()
    pidf = project / _PID_FILE
    if pidf.is_file():
        pid = _read_pid(pidf)
        if pid is None:
            warn("PID 文件失效")
        else:
            state = _pid_state(pid)
            if state == "running":
                ok(f"进程运行中 pid={pid}")
            elif state == "inaccessible":
                warn(f"PID 文件存在但当前环境无权探测 pid={pid}")
            else:
                warn("PID 文件失效")
    else:
        warn("未启动")

    ipc = AgentdIpcClient(project / ".sop-runtime" / "agentd.sock")
    kv("ipc_diagnose", ipc.diagnose())
    if ipc.available():
        out = ipc.health()
        kv("ipc", out)
    else:
        warn(f"IPC 不可用：{ipc.diagnose().get('endpoint')}")


@app.command()
def logs(tail: int = typer.Option(80, "-n")) -> None:
    """查看日志尾部。"""
    log = Path.cwd() / _LOG_FILE
    if not log.is_file():
        warn(f"日志不存在：{log}")
        raise typer.Exit(0)
    try:
        subprocess.call(["tail", "-n", str(tail), str(log)])
    except FileNotFoundError:  # pragma: no cover
        console.print(log.read_text(encoding="utf-8")[-(tail * 200):])


@app.command()
def install() -> None:
    """安装 launchd（macOS）/ systemd（Linux）user unit。"""
    project = Path.cwd().resolve()
    bin_path = _binary() or "/usr/local/bin/sop-agentd"
    if sys.platform == "darwin":
        plist_path = Path.home() / "Library" / "LaunchAgents" / "dev.sop.agentd.plist"
        plist_path.parent.mkdir(parents=True, exist_ok=True)
        plist_path.write_text(textwrap.dedent(f"""\
            <?xml version="1.0" encoding="UTF-8"?>
            <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
            <plist version="1.0"><dict>
              <key>Label</key><string>dev.sop.agentd</string>
              <key>ProgramArguments</key><array><string>{bin_path}</string></array>
              <key>WorkingDirectory</key><string>{project}</string>
              <key>RunAtLoad</key><true/>
              <key>KeepAlive</key><true/>
              <key>StandardOutPath</key><string>{project}/.sop-runtime/logs/agentd.log</string>
              <key>StandardErrorPath</key><string>{project}/.sop-runtime/logs/agentd.err</string>
            </dict></plist>
        """))
        subprocess.call(["launchctl", "load", str(plist_path)])
        ok(f"launchd 已安装：{plist_path}")
    elif sys.platform.startswith("linux"):
        unit_dir = Path.home() / ".config" / "systemd" / "user"
        unit_dir.mkdir(parents=True, exist_ok=True)
        unit = unit_dir / "sop-agentd.service"
        unit.write_text(textwrap.dedent(f"""\
            [Unit]
            Description=sop agentd
            After=network-online.target

            [Service]
            ExecStart={bin_path}
            WorkingDirectory={project}
            Restart=on-failure
            RestartSec=5

            [Install]
            WantedBy=default.target
        """))
        subprocess.call(["systemctl", "--user", "daemon-reload"])
        subprocess.call(["systemctl", "--user", "enable", "--now", "sop-agentd.service"])
        ok(f"systemd user unit 已安装：{unit}")
    else:
        warn(f"暂不支持自动安装：{sys.platform}（请使用 `sop agentd start` 前台运行）")
