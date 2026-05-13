"""环境检查、Docker 开发验证、基础组件部署、自定义检查 / 版本约束 / AI 诊断与受控修复"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/env", tags=["env"])
PROJECT_PATH = Path(os.getenv("PROJECT_PATH", ".")).resolve()

_CUSTOM_CHECKS_PATH = PROJECT_PATH / ".ai-memory" / "env_custom_checks.json"
_VERSION_PINS_PATH = PROJECT_PATH / ".ai-memory" / "env_version_pins.json"
_EXEC_ALLOWLIST_EXTRA_PATH = PROJECT_PATH / ".ai-memory" / "env_exec_allowlist_extra.json"
_DOCKER_CUSTOM_PRESETS_PATH = PROJECT_PATH / ".ai-memory" / "docker_custom_presets.json"

_DEFAULT_EXEC_ALLOW: Set[str] = {
    "python3",
    "pip",
    "pip3",
    "node",
    "npm",
    "npx",
    "git",
    "docker",
    "java",
    "mvn",
    "curl",
    "which",
    "rg",
    "uname",
    "ls",
    "test",
    "bash",
    "sh",
    "go",
    "uv",
    "pnpm",
    "corepack",
    "claude",
    "opencode",
    "aider",
}


def _run(cmd: list, cwd=None, timeout=30) -> dict:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd or str(PROJECT_PATH))
        return {"stdout": r.stdout[-3000:], "stderr": r.stderr[-500:], "returncode": r.returncode, "ok": r.returncode == 0}
    except subprocess.TimeoutExpired:
        return {"stdout": "", "stderr": "超时", "returncode": -1, "ok": False}
    except FileNotFoundError:
        return {"stdout": "", "stderr": f"命令未找到: {cmd[0]}", "returncode": -1, "ok": False}


def _exec_allowlist() -> Set[str]:
    s = set(_DEFAULT_EXEC_ALLOW)
    if _EXEC_ALLOWLIST_EXTRA_PATH.exists():
        try:
            extra = json.loads(_EXEC_ALLOWLIST_EXTRA_PATH.read_text(encoding="utf-8"))
            if isinstance(extra, list):
                for x in extra:
                    if isinstance(x, str) and re.match(r"^[a-zA-Z0-9._-]{1,48}$", x):
                        s.add(x)
        except Exception:
            pass
    return s


def _validate_argv(argv: List[str]) -> List[str]:
    if not argv or len(argv) > 20:
        raise HTTPException(400, "命令 argv 非法或过长")
    allow = _exec_allowlist()
    if argv[0] not in allow:
        raise HTTPException(400, f"可执行文件「{argv[0]}」不在允许列表；可在 .ai-memory/env_exec_allowlist_extra.json 追加白名单")
    if argv[0] in ("bash", "sh") and len(argv) == 2:
        sp = Path(argv[1]).resolve()
        root = PROJECT_PATH.resolve()
        if not str(sp).startswith(str(root) + os.sep) or not str(sp).endswith(".sh"):
            raise HTTPException(400, "bash/sh 仅允许执行 PROJECT_PATH 下的 .sh 脚本路径")
    if argv[0] in ("bash", "sh") and len(argv) >= 2 and argv[1] == "-c" and len(argv) >= 3:
        script = argv[2]
        if len(script) > 4000 or re.search(r"[;&|`$()<>]", script):
            raise HTTPException(400, "bash -c 脚本过长或含危险字符")
    return argv


def _safe_path_under_project(rel_or_abs: str) -> Path:
    raw = (rel_or_abs or "").strip()
    if not raw:
        raise HTTPException(400, "path 不能为空")
    p = Path(raw)
    if not p.is_absolute():
        target = (PROJECT_PATH / p).resolve()
    else:
        target = p.resolve()
    root = PROJECT_PATH.resolve()
    if not str(target).startswith(str(root) + os.sep) and target != root:
        raise HTTPException(400, "path 必须位于 PROJECT_PATH 目录内")
    return target


def _builtin_checks_dict() -> Dict[str, Any]:
    checks: Dict[str, Any] = {}
    tools = {
        "python3": ["python3", "--version"],
        "git": ["git", "--version"],
        "docker": ["docker", "--version"],
        "docker-compose": ["docker", "compose", "version"],
        "java": ["java", "-version"],
        "mvn": ["mvn", "--version"],
        "node": ["node", "--version"],
        "npm": ["npm", "--version"],
        "pnpm": ["pnpm", "--version"],
        "go": ["go", "version"],
        "uv": ["uv", "--version"],
        "claude": ["claude", "--version"],
        "opencode": ["opencode", "--version"],
    }
    for name, cmd in tools.items():
        r = _run(cmd, timeout=8)
        line = (r["stdout"] or r["stderr"] or "").split("\n")[0][:120]
        checks[name] = {"available": r["ok"], "version": line}
    for pkg in ["fastapi", "lancedb", "sentence_transformers"]:
        r = _run(
            ["python3", "-c", f"import {pkg}; print({pkg}.__version__ if hasattr({pkg},'__version__') else 'ok')"],
            timeout=12,
        )
        checks[f"py:{pkg}"] = {"available": r["ok"], "version": (r["stdout"] or "").strip()[:40]}
    return checks


def _default_pins() -> Dict[str, Any]:
    return {
        "runtime": {"python3": ">=3.10", "node": ">=18"},
        "tools": {"npm": ">=9", "docker": ">=24"},
        "notes": "",
    }


def _load_pins() -> Dict[str, Any]:
    if not _VERSION_PINS_PATH.exists():
        return _default_pins()
    try:
        d = json.loads(_VERSION_PINS_PATH.read_text(encoding="utf-8"))
        if not isinstance(d, dict):
            return _default_pins()
        d.setdefault("runtime", _default_pins()["runtime"])
        d.setdefault("tools", {})
        d.setdefault("notes", "")
        return d
    except Exception:
        return _default_pins()


def _save_pins(d: Dict[str, Any]) -> None:
    _VERSION_PINS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _VERSION_PINS_PATH.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_custom_catalog() -> List[Dict[str, Any]]:
    if not _CUSTOM_CHECKS_PATH.exists():
        return []
    try:
        d = json.loads(_CUSTOM_CHECKS_PATH.read_text(encoding="utf-8"))
        return d if isinstance(d, list) else []
    except Exception:
        return []


def _save_custom_catalog(items: List[Dict[str, Any]]) -> None:
    _CUSTOM_CHECKS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _CUSTOM_CHECKS_PATH.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_docker_custom_presets() -> List[Dict[str, Any]]:
    if not _DOCKER_CUSTOM_PRESETS_PATH.exists():
        return []
    try:
        d = json.loads(_DOCKER_CUSTOM_PRESETS_PATH.read_text(encoding="utf-8"))
        arr = d.get("presets") if isinstance(d, dict) else d
        return arr if isinstance(arr, list) else []
    except Exception:
        return []


def _save_docker_custom_presets(items: List[Dict[str, Any]]) -> None:
    _DOCKER_CUSTOM_PRESETS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _DOCKER_CUSTOM_PRESETS_PATH.write_text(
        json.dumps({"presets": items}, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _parse_mm(text: str) -> Optional[tuple]:
    m = re.search(r"(\d+)\.(\d+)", text or "")
    if not m:
        return None
    return int(m.group(1)), int(m.group(2))


def _pin_to_tuple(pin: str) -> Optional[tuple]:
    m = re.search(r">=\s*(\d+)\.(\d+)", pin or "")
    if m:
        return int(m.group(1)), int(m.group(2))
    m2 = re.search(r"(\d+)\.(\d+)", pin or "")
    if m2:
        return int(m2.group(1)), int(m2.group(2))
    return None


def _evaluate_pin_warnings(builtin: Dict[str, Any], pins: Dict[str, Any]) -> List[str]:
    warns: List[str] = []
    rt = pins.get("runtime") or {}
    for key, pin in rt.items():
        if key not in builtin or not isinstance(pin, str):
            continue
        info = builtin.get(key) or {}
        if not info.get("available"):
            warns.append(f"{key}: 未安装，期望 {pin}")
            continue
        ver_line = str(info.get("version") or "")
        got = _parse_mm(ver_line)
        need = _pin_to_tuple(pin)
        if got and need and (got[0] < need[0] or (got[0] == need[0] and got[1] < need[1])):
            warns.append(f"{key}: 当前 {ver_line.strip()[:40]} 低于约束 {pin}")
    return warns


def _run_one_custom(c: Dict[str, Any]) -> Dict[str, Any]:
    name = c.get("name") or c.get("id") or "custom"
    kind = (c.get("kind") or "command").strip()
    timeout = int(c.get("timeout_sec") or 15)
    timeout = max(3, min(timeout, 120))
    if kind == "file_exists":
        try:
            p = _safe_path_under_project(str(c.get("path") or ""))
            ok = p.exists()
            return {"available": ok, "version": str(p) if ok else "不存在", "name": name, "kind": kind}
        except HTTPException as e:
            return {"available": False, "version": str(e.detail), "name": name, "kind": kind}
    if kind == "command":
        argv = c.get("argv") or []
        if not isinstance(argv, list) or not all(isinstance(x, str) for x in argv):
            return {"available": False, "version": "argv 非法", "name": name, "kind": kind}
        try:
            argv2 = _validate_argv(list(argv))
        except HTTPException as e:
            return {"available": False, "version": str(e.detail), "name": name, "kind": kind}
        r = _run(argv2, timeout=timeout)
        line = (r["stdout"] or r["stderr"] or "").split("\n")[0][:200]
        return {"available": r["ok"], "version": line, "name": name, "kind": kind, "stderr": (r.get("stderr") or "")[:200]}
    if kind == "version_command":
        argv = c.get("argv") or []
        min_v = str(c.get("min_semver") or c.get("min_version") or "")
        if not isinstance(argv, list) or not argv:
            return {"available": False, "version": "缺少 argv", "name": name, "kind": kind}
        try:
            argv2 = _validate_argv(list(argv))
        except HTTPException as e:
            return {"available": False, "version": str(e.detail), "name": name, "kind": kind}
        r = _run(argv2, timeout=timeout)
        out = (r["stdout"] or r["stderr"] or "").strip()
        got = _parse_mm(out)
        need = _pin_to_tuple(min_v) if min_v else None
        ok = r["ok"]
        if ok and need and got:
            ok = got[0] > need[0] or (got[0] == need[0] and got[1] >= need[1])
        return {"available": ok, "version": out[:120] or "-", "name": name, "kind": kind, "stderr": (r.get("stderr") or "")[:200]}
    return {"available": False, "version": f"未知 kind: {kind}", "name": name, "kind": kind}


def _env_llm(user: str, max_tokens: int = 4096) -> str:
    try:
        import anthropic
    except ImportError:
        raise HTTPException(503, "请安装 anthropic: pip install anthropic")
    key = os.getenv("ANTHROPIC_API_KEY", "")
    if not key:
        raise HTTPException(503, "未配置 ANTHROPIC_API_KEY，无法使用 AI 环境诊断")
    client = anthropic.Anthropic(api_key=key)
    system = """你是资深 DevOps / 平台工程师。根据用户提供的「环境检查结果」JSON，输出：
1) 简短结论（Markdown）
2) 分步修复清单（编号列表），每步给出可在项目根目录执行的 shell 命令；优先使用仓库内已有脚本（如 sop/tools/install-integrations.sh、sop/tools/health-check.sh、sop/tools/init-ai-project.sh）。
3) 标注风险等级（低/中/高）与是否需人工确认。
4) 不要编造不存在的路径；若信息不足写「需补充」。
只输出 Markdown，不要 JSON。"""
    msg = client.messages.create(
        model=os.getenv("ENV_AI_MODEL", "claude-3-5-sonnet-20241022"),
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    if not msg.content:
        return ""
    return getattr(msg.content[0], "text", "") or ""


# ── 内置检查（兼容旧前端扁平结构）────────────────────────────────────


@router.get("/check")
def env_check():
    """全面环境检查（仅内置项，兼容旧版 UI）"""
    return _builtin_checks_dict()


@router.get("/check/full")
def env_check_full():
    builtin = _builtin_checks_dict()
    catalog = _load_custom_catalog()
    custom: Dict[str, Any] = {}
    for c in catalog:
        cid = c.get("id")
        if not cid:
            continue
        custom[f"custom:{cid}"] = _run_one_custom(c)
    pins = _load_pins()
    pin_warnings = _evaluate_pin_warnings(builtin, pins)
    return {
        "builtin": builtin,
        "custom": custom,
        "custom_catalog": catalog,
        "pins": pins,
        "pin_warnings": pin_warnings,
    }


class CustomCheckCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    kind: str = Field(..., description="command | file_exists | version_command")
    argv: Optional[List[str]] = None
    path: Optional[str] = None
    min_semver: Optional[str] = None
    optional: bool = True
    timeout_sec: int = Field(15, ge=3, le=120)


class CustomCheckUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    kind: Optional[str] = None
    argv: Optional[List[str]] = None
    path: Optional[str] = None
    min_semver: Optional[str] = None
    optional: Optional[bool] = None
    timeout_sec: Optional[int] = Field(None, ge=3, le=120)


class VersionPinsBody(BaseModel):
    runtime: Optional[Dict[str, str]] = None
    tools: Optional[Dict[str, str]] = None
    notes: Optional[str] = Field(None, max_length=2000)


class AiEnvPlanBody(BaseModel):
    """可选传入上次 /check/full 的 JSON；不传则服务端自跑一遍。"""
    snapshot: Optional[Dict[str, Any]] = None
    extra_context: Optional[str] = Field(None, max_length=8000)


class RemediateRunBody(BaseModel):
    action: str = Field(..., description="install_integrations | health_check")


class ExecAllowlistAppendBody(BaseModel):
    binary: str = Field(..., min_length=1, max_length=48)


def _script_path(rel: str) -> Optional[Path]:
    p = (PROJECT_PATH / rel).resolve()
    root = PROJECT_PATH.resolve()
    if not str(p).startswith(str(root) + os.sep):
        return None
    return p if p.is_file() else None


@router.get("/custom-checks")
def list_custom_checks():
    return {"items": _load_custom_catalog()}


@router.post("/custom-checks")
def add_custom_check(body: CustomCheckCreate):
    kind = (body.kind or "").strip()
    if kind not in ("command", "file_exists", "version_command"):
        raise HTTPException(400, "kind 须为 command | file_exists | version_command")
    if kind == "file_exists" and not (body.path or "").strip():
        raise HTTPException(400, "file_exists 需要 path")
    if kind in ("command", "version_command") and not body.argv:
        raise HTTPException(400, "command / version_command 需要 argv 数组")
    items = _load_custom_catalog()
    nid = f"chk-{uuid.uuid4().hex[:12]}"
    row = {
        "id": nid,
        "name": body.name.strip(),
        "kind": kind,
        "argv": body.argv,
        "path": body.path,
        "min_semver": body.min_semver,
        "optional": bool(body.optional),
        "timeout_sec": body.timeout_sec,
    }
    items.append(row)
    _save_custom_catalog(items)
    return {"ok": True, "id": nid}


@router.patch("/custom-checks/{check_id}")
def update_custom_check(check_id: str, body: CustomCheckUpdate):
    if not re.match(r"^chk-[a-f0-9]{12}$", check_id or ""):
        raise HTTPException(400, "非法检查 ID")
    items = _load_custom_catalog()
    for i, it in enumerate(items):
        if it.get("id") != check_id:
            continue
        try:
            patch = body.model_dump(exclude_unset=True)
        except AttributeError:
            patch = body.dict(exclude_unset=True)
        for k, v in patch.items():
            if v is not None:
                it[k] = v
        items[i] = it
        break
    if not found:
        raise HTTPException(404, "未找到")
    _save_custom_catalog(items)
    return {"ok": True}


@router.delete("/custom-checks/{check_id}")
def delete_custom_check(check_id: str):
    if not re.match(r"^chk-[a-f0-9]{12}$", check_id or ""):
        raise HTTPException(400, "非法检查 ID")
    items = _load_custom_catalog()
    nxt = [x for x in items if x.get("id") != check_id]
    if len(nxt) == len(items):
        raise HTTPException(404, "未找到")
    _save_custom_catalog(nxt)
    return {"ok": True}


@router.get("/version-pins")
def get_version_pins():
    return _load_pins()


@router.put("/version-pins")
def put_version_pins(body: VersionPinsBody):
    cur = _load_pins()
    if body.runtime is not None:
        cur["runtime"] = body.runtime
    if body.tools is not None:
        cur["tools"] = body.tools
    if body.notes is not None:
        cur["notes"] = body.notes
    _save_pins(cur)
    return {"ok": True, "pins": cur}


@router.post("/exec-allowlist/append")
def append_exec_allowlist(body: ExecAllowlistAppendBody):
    b = body.binary.strip()
    if not re.match(r"^[a-zA-Z0-9._-]{1,48}$", b):
        raise HTTPException(400, "binary 格式非法")
    extra: List[str] = []
    if _EXEC_ALLOWLIST_EXTRA_PATH.exists():
        try:
            x = json.loads(_EXEC_ALLOWLIST_EXTRA_PATH.read_text(encoding="utf-8"))
            if isinstance(x, list):
                extra = [str(s) for s in x if isinstance(s, str)]
        except Exception:
            extra = []
    if b not in extra:
        extra.append(b)
    _EXEC_ALLOWLIST_EXTRA_PATH.parent.mkdir(parents=True, exist_ok=True)
    _EXEC_ALLOWLIST_EXTRA_PATH.write_text(json.dumps(extra, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "extra": extra}


@router.post("/ai-plan")
def ai_env_plan(body: AiEnvPlanBody):
    snap = body.snapshot
    if not snap:
        snap = env_check_full()
    user = "环境检查快照（JSON）：\n```json\n" + json.dumps(snap, ensure_ascii=False, indent=2)[:24000] + "\n```\n"
    if body.extra_context:
        user += "\n补充上下文：\n" + body.extra_context.strip()[:8000]
    try:
        md = _env_llm(user)
        if not md.strip():
            raise HTTPException(502, "模型返回为空")
        return {"ok": True, "markdown": md}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"AI 诊断失败: {e}") from e


@router.post("/remediate-run")
def remediate_run(body: RemediateRunBody):
    action = (body.action or "").strip()
    if action == "install_integrations":
        script = _script_path("sop/tools/install-integrations.sh")
        if not script:
            raise HTTPException(404, "未找到 sop/tools/install-integrations.sh（请确认 PROJECT_PATH 为仓库根）")
        return _run(["bash", str(script)], cwd=str(PROJECT_PATH), timeout=900)
    if action == "health_check":
        script = _script_path("sop/tools/health-check.sh")
        if not script:
            raise HTTPException(404, "未找到 sop/tools/health-check.sh")
        return _run(["bash", str(script)], cwd=str(PROJECT_PATH), timeout=120)
    raise HTTPException(400, "action 仅支持 install_integrations | health_check")


PRESETS: Dict[str, Dict[str, Any]] = {
    "mysql": {"image": "mysql:8", "name": "dev-mysql", "ports": ["3306:3306"], "env": ["MYSQL_ROOT_PASSWORD=root", "MYSQL_DATABASE=devdb"]},
    "redis": {"image": "redis:7", "name": "dev-redis", "ports": ["6379:6379"], "env": []},
    "postgres": {"image": "postgres:16", "name": "dev-postgres", "ports": ["5432:5432"], "env": ["POSTGRES_PASSWORD=root", "POSTGRES_DB=devdb"]},
    "mongo": {"image": "mongo:7", "name": "dev-mongo", "ports": ["27017:27017"], "env": []},
    "rabbitmq": {"image": "rabbitmq:3-management", "name": "dev-rabbitmq", "ports": ["5672:5672", "15672:15672"], "env": []},
    "minio": {"image": "minio/minio", "name": "dev-minio", "ports": ["9000:9000", "9001:9001"], "env": ["MINIO_ROOT_USER=admin", "MINIO_ROOT_PASSWORD=admin123"]},
}

_DOCKER_IMG_REF_RE = re.compile(r"^[a-zA-Z0-9_.\-/:@]{1,300}$")
_DOCKER_PORT_RE = re.compile(r"^\d{1,5}:\d{1,5}(/(tcp|udp))?$")
_PRESET_KEY_RE = re.compile(r"^[a-z][a-z0-9_-]{1,40}$")


def _validate_docker_image_ref(image: str) -> str:
    s = (image or "").strip()
    if not s or len(s) > 300 or ".." in s or "\n" in s or "\x00" in s:
        raise HTTPException(400, "非法镜像引用")
    if not _DOCKER_IMG_REF_RE.match(s):
        raise HTTPException(400, "镜像引用含非法字符（允许字母数字 . - / @）")
    return s


def _validate_docker_container_name(name: Optional[str]) -> Optional[str]:
    if name is None or not str(name).strip():
        return None
    n = str(name).strip()
    if not re.match(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$", n):
        raise HTTPException(400, "非法容器名")
    return n


def _validate_docker_port_maps(ports: Optional[List[str]]) -> List[str]:
    out: List[str] = []
    for p in ports or []:
        ps = (p or "").strip()
        if not ps:
            continue
        if not _DOCKER_PORT_RE.match(ps):
            raise HTTPException(400, f"非法端口映射（host:port[/tcp]）: {ps}")
        out.append(ps)
    return out


def _validate_docker_env_lines(env: Optional[List[str]]) -> List[str]:
    out: List[str] = []
    for line in env or []:
        line = (line or "").strip()
        if not line:
            continue
        if len(line) > 800:
            raise HTTPException(400, "环境变量行过长")
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", line):
            raise HTTPException(400, f"非法环境变量（须 KEY=value）: {line[:60]}")
        if re.search(r"[`\$\n\r;]", line):
            raise HTTPException(400, "环境变量含非法字符")
        out.append(line)
    return out


def _validate_docker_volume_pairs(vols: Optional[List[str]]) -> List[str]:
    out: List[str] = []
    for spec in vols or []:
        spec = (spec or "").strip()
        if not spec:
            continue
        if ":" not in spec:
            raise HTTPException(400, "volume 须为 host路径:容器绝对路径")
        left, right = spec.split(":", 1)
        left, right = left.strip(), right.strip()
        if not right or not right.startswith("/"):
            raise HTTPException(400, "volume 容器侧须为绝对路径（以 / 开头）")
        host = _safe_path_under_project(left)
        out.append(f"{host}:{right}")
    return out


def _validate_restart_policy(r: Optional[str]) -> Optional[str]:
    if r is None:
        return None
    t = str(r).strip().lower()
    if not t or t in ("no", "default"):
        return None
    if t not in ("unless-stopped", "always", "on-failure"):
        raise HTTPException(400, "restart 仅支持 no / unless-stopped / always / on-failure")
    return t


class DockerRunBody(BaseModel):
    image: str
    name: Optional[str] = None
    ports: List[str] = Field(default_factory=list)
    env: List[str] = Field(default_factory=list)
    volumes: List[str] = Field(default_factory=list)
    detach: bool = True
    restart: Optional[str] = None


def _docker_run_argv(body: DockerRunBody) -> List[str]:
    cmd = ["docker", "run"]
    if body.detach:
        cmd.append("-d")
    nm = _validate_docker_container_name(body.name)
    if nm:
        cmd += ["--name", nm]
    rp = _validate_restart_policy(body.restart)
    if rp:
        cmd += ["--restart", rp]
    for p in _validate_docker_port_maps(body.ports):
        cmd += ["-p", p]
    for e in _validate_docker_env_lines(body.env):
        cmd += ["-e", e]
    for v in _validate_docker_volume_pairs(body.volumes):
        cmd += ["-v", v]
    cmd.append(_validate_docker_image_ref(body.image))
    return cmd


class DockerCustomPresetCreate(BaseModel):
    key: str = Field(..., min_length=2, max_length=42)
    label: str = Field("", max_length=120)
    image: str = Field(..., min_length=1, max_length=300)
    container_name: Optional[str] = Field(None, max_length=120)
    ports: List[str] = Field(default_factory=list)
    env: List[str] = Field(default_factory=list)
    volumes: List[str] = Field(default_factory=list)
    restart: Optional[str] = Field(None, max_length=32)


class DockerCustomPresetUpdate(BaseModel):
    key: Optional[str] = Field(None, min_length=2, max_length=42)
    label: Optional[str] = Field(None, max_length=120)
    image: Optional[str] = Field(None, min_length=1, max_length=300)
    container_name: Optional[str] = None
    ports: Optional[List[str]] = None
    env: Optional[List[str]] = None
    volumes: Optional[List[str]] = None
    restart: Optional[str] = None


class DockerImageRefBody(BaseModel):
    image: str = Field(..., min_length=1, max_length=300)


class DockerImageRemoveBody(BaseModel):
    ref: str = Field(..., min_length=1, max_length=320)


def _docker_json_lines(stdout: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for line in (stdout or "").strip().split("\n"):
        if line.strip():
            try:
                rows.append(json.loads(line))
            except Exception:
                pass
    return rows


@router.get("/docker/ps")
def docker_ps():
    r = _run(["docker", "ps", "--format", "{{json .}}"], timeout=45)
    if not r["ok"]:
        return {"error": r["stderr"], "containers": []}
    return {"containers": _docker_json_lines(r["stdout"])}


@router.get("/docker/ps-all")
def docker_ps_all():
    r = _run(["docker", "ps", "-a", "--format", "{{json .}}"], timeout=60)
    if not r["ok"]:
        return {"error": r["stderr"], "containers": []}
    return {"containers": _docker_json_lines(r["stdout"])}


@router.get("/docker/images")
def docker_images():
    r = _run(["docker", "images", "--format", "{{json .}}"], timeout=60)
    if not r["ok"]:
        return {"error": r["stderr"], "images": []}
    return {"images": _docker_json_lines(r["stdout"])}


@router.post("/docker/images/pull")
def docker_image_pull(body: DockerImageRefBody):
    img = _validate_docker_image_ref(body.image)
    return _run(["docker", "pull", img], timeout=900)


@router.post("/docker/images/remove")
def docker_image_remove(body: DockerImageRemoveBody):
    ref = (body.ref or "").strip()
    if not ref or len(ref) > 320 or ".." in ref or " " in ref or "\n" in ref:
        raise HTTPException(400, "非法镜像删除引用")
    if not (re.match(r"^sha256:[a-f0-9]{64}$", ref) or re.match(r"^[a-zA-Z0-9._\-/:@]+$", ref)):
        raise HTTPException(400, "非法镜像删除引用")
    return _run(["docker", "rmi", "-f", ref], timeout=180)


@router.post("/docker/run")
def docker_run(body: DockerRunBody):
    cmd = _docker_run_argv(body)
    return _run(cmd, timeout=120)


@router.post("/docker/stop/{name}")
def docker_stop(name: str):
    if not re.match(r"^[a-zA-Z0-9._-]{1,120}$", name or ""):
        raise HTTPException(400, "非法容器名")
    return _run(["docker", "stop", name])


@router.post("/docker/remove/{name}")
def docker_remove(name: str):
    if not re.match(r"^[a-zA-Z0-9._-]{1,120}$", name or ""):
        raise HTTPException(400, "非法容器名")
    return _run(["docker", "rm", "-f", name])


@router.post("/docker/start/{name}")
def docker_start(name: str):
    """启动已存在但已停止的容器。"""
    if not re.match(r"^[a-zA-Z0-9._-]{1,120}$", name or ""):
        raise HTTPException(400, "非法容器名")
    return _run(["docker", "start", name], timeout=120)


@router.post("/docker/build")
def docker_build(tag: str, dockerfile: str = "Dockerfile", context: str = "."):
    t = (tag or "").strip()
    if not t or len(t) > 200 or "\n" in t or "\x00" in t or ".." in t:
        raise HTTPException(400, "非法 tag")
    if not re.match(r"^[a-zA-Z0-9_.\-/:]{1,200}$", t):
        raise HTTPException(400, "非法 tag")
    df = _safe_path_under_project((dockerfile or "Dockerfile").strip() or "Dockerfile")
    if not df.is_file():
        raise HTTPException(400, "Dockerfile 不存在或不是文件")
    ctx = _safe_path_under_project((context or ".").strip())
    if not ctx.is_dir():
        raise HTTPException(400, "构建上下文不是目录")
    return _run(["docker", "build", "-t", t, "-f", str(df), str(ctx)], timeout=600)


@router.get("/docker/compose/services")
def compose_services():
    r = _run(["docker", "compose", "ps", "--format", "json"])
    if not r["ok"]:
        return {"error": r["stderr"], "services": []}
    try:
        return {"services": json.loads(r["stdout"])}
    except Exception:
        return {"services": [], "raw": r["stdout"][:500]}


@router.post("/docker/compose/{action}")
def compose_action(action: str):
    if action not in ("up", "down", "restart", "pull"):
        raise HTTPException(400, "Invalid action")
    cmd = ["docker", "compose", action]
    if action == "up":
        cmd.append("-d")
    return _run(cmd, timeout=120)


@router.get("/docker/presets")
def get_presets():
    """向后兼容：仅返回内置预设 dict。"""
    return PRESETS


@router.get("/docker/presets/catalog")
def docker_presets_catalog():
    """内置 + 自定义预设（持久化在 .ai-memory/docker_custom_presets.json）。"""
    return {"builtin": PRESETS, "custom": _load_docker_custom_presets()}


@router.post("/docker/custom-presets")
def docker_custom_preset_create(body: DockerCustomPresetCreate):
    k = body.key.strip().lower()
    if not _PRESET_KEY_RE.match(k):
        raise HTTPException(400, "key 须为小写字母开头，仅 a-z0-9_-")
    if k in PRESETS:
        raise HTTPException(400, "与内置 preset key 冲突")
    items = _load_docker_custom_presets()
    if any(str(x.get("key")) == k for x in items):
        raise HTTPException(400, "key 已存在")
    pid = f"dc-{uuid.uuid4().hex[:10]}"
    row = {
        "id": pid,
        "key": k,
        "label": (body.label or k).strip()[:120] or k,
        "image": _validate_docker_image_ref(body.image),
        "container_name": _validate_docker_container_name(body.container_name),
        "ports": _validate_docker_port_maps(body.ports),
        "env": _validate_docker_env_lines(body.env),
        "volumes": _validate_docker_volume_pairs(body.volumes),
        "restart": _validate_restart_policy(body.restart),
    }
    items.append(row)
    _save_docker_custom_presets(items)
    return {"ok": True, "preset": row}


@router.put("/docker/custom-presets/{preset_id}")
def docker_custom_preset_update(preset_id: str, body: DockerCustomPresetUpdate):
    pid = (preset_id or "").strip()
    items = _load_docker_custom_presets()
    idx = next((i for i, x in enumerate(items) if str(x.get("id")) == pid), -1)
    if idx < 0:
        raise HTTPException(404, "未找到自定义预设")
    cur = dict(items[idx])
    try:
        patch = body.model_dump(exclude_unset=True)
    except AttributeError:
        patch = body.dict(exclude_unset=True)
    if "key" in patch and patch["key"] is not None:
        k = str(patch["key"]).strip().lower()
        if not _PRESET_KEY_RE.match(k):
            raise HTTPException(400, "非法 key")
        if k in PRESETS:
            raise HTTPException(400, "与内置 preset 冲突")
        if any(str(x.get("key")) == k for j, x in enumerate(items) if j != idx):
            raise HTTPException(400, "key 已存在")
        cur["key"] = k
    if "label" in patch and patch["label"] is not None:
        cur["label"] = str(patch["label"])[:120]
    if "image" in patch and patch["image"]:
        cur["image"] = _validate_docker_image_ref(str(patch["image"]))
    if "container_name" in patch:
        cur["container_name"] = _validate_docker_container_name(patch.get("container_name"))
    if "ports" in patch and patch["ports"] is not None:
        cur["ports"] = _validate_docker_port_maps(list(patch["ports"]))
    if "env" in patch and patch["env"] is not None:
        cur["env"] = _validate_docker_env_lines(list(patch["env"]))
    if "volumes" in patch and patch["volumes"] is not None:
        cur["volumes"] = _validate_docker_volume_pairs(list(patch["volumes"]))
    if "restart" in patch:
        cur["restart"] = _validate_restart_policy(patch.get("restart"))
    items[idx] = cur
    _save_docker_custom_presets(items)
    return {"ok": True, "preset": cur}


@router.delete("/docker/custom-presets/{preset_id}")
def docker_custom_preset_delete(preset_id: str):
    pid = (preset_id or "").strip()
    items = _load_docker_custom_presets()
    nxt = [x for x in items if str(x.get("id")) != pid]
    if len(nxt) == len(items):
        raise HTTPException(404, "未找到")
    _save_docker_custom_presets(nxt)
    return {"ok": True}


@router.post("/docker/presets/{name}/start")
def start_preset(name: str):
    n = (name or "").strip()
    if n in PRESETS:
        p = PRESETS[n]
        return docker_run(
            DockerRunBody(
                image=p["image"],
                name=p.get("name"),
                ports=list(p.get("ports") or []),
                env=list(p.get("env") or []),
                volumes=[],
                detach=True,
                restart=None,
            )
        )
    for c in _load_docker_custom_presets():
        if str(c.get("key")) == n or str(c.get("id")) == n:
            return docker_run(
                DockerRunBody(
                    image=c["image"],
                    name=c.get("container_name"),
                    ports=list(c.get("ports") or []),
                    env=list(c.get("env") or []),
                    volumes=list(c.get("volumes") or []),
                    detach=True,
                    restart=c.get("restart"),
                )
            )
    raise HTTPException(404, "Preset 不存在")
