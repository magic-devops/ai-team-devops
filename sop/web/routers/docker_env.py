"""环境检查、Docker 开发验证、基础组件部署"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import subprocess, shutil, os, json
from pathlib import Path

router = APIRouter(prefix="/api/env", tags=["env"])
PROJECT_PATH = Path(os.getenv("PROJECT_PATH", "."))

def _run(cmd: list, cwd=None, timeout=30) -> dict:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd or str(PROJECT_PATH))
        return {"stdout": r.stdout[-3000:], "stderr": r.stderr[-500:], "returncode": r.returncode, "ok": r.returncode == 0}
    except subprocess.TimeoutExpired:
        return {"stdout": "", "stderr": "超时", "returncode": -1, "ok": False}
    except FileNotFoundError:
        return {"stdout": "", "stderr": f"命令未找到: {cmd[0]}", "returncode": -1, "ok": False}

@router.get("/check")
def env_check():
    """全面环境检查"""
    checks = {}
    tools = {"python3": ["python3","--version"], "git": ["git","--version"],
             "docker": ["docker","--version"], "docker-compose": ["docker","compose","version"],
             "java": ["java","-version"], "mvn": ["mvn","--version"],
             "node": ["node","--version"], "npm": ["npm","--version"],
             "claude": ["claude","--version"], "opencode": ["opencode","--version"]}
    for name, cmd in tools.items():
        r = _run(cmd, timeout=5)
        checks[name] = {"available": r["ok"], "version": (r["stdout"] or r["stderr"]).split("\n")[0][:60]}
    # Python 包检查
    for pkg in ["fastapi","lancedb","sentence_transformers"]:
        r = _run(["python3","-c",f"import {pkg}; print({pkg}.__version__ if hasattr({pkg},'__version__') else 'ok')"], timeout=5)
        checks[f"py:{pkg}"] = {"available": r["ok"], "version": r["stdout"].strip()[:30]}
    return checks

@router.get("/docker/ps")
def docker_ps():
    r = _run(["docker","ps","--format","{{json .}}"])
    if not r["ok"]: return {"error": r["stderr"], "containers": []}
    containers = []
    for line in r["stdout"].strip().split("\n"):
        if line.strip():
            try: containers.append(json.loads(line))
            except Exception: pass
    return {"containers": containers}

@router.get("/docker/images")
def docker_images():
    r = _run(["docker","images","--format","{{json .}}"])
    images = []
    for line in r["stdout"].strip().split("\n"):
        if line.strip():
            try: images.append(json.loads(line))
            except Exception: pass
    return {"images": images}

class DockerRunBody(BaseModel):
    image: str; name: Optional[str] = None; ports: Optional[List[str]] = []
    env: Optional[List[str]] = []; detach: bool = True

@router.post("/docker/run")
def docker_run(body: DockerRunBody):
    cmd = ["docker","run"]
    if body.detach: cmd.append("-d")
    if body.name: cmd += ["--name", body.name]
    for p in (body.ports or []): cmd += ["-p", p]
    for e in (body.env or []): cmd += ["-e", e]
    cmd.append(body.image)
    return _run(cmd, timeout=60)

@router.post("/docker/stop/{name}")
def docker_stop(name: str):
    return _run(["docker","stop", name])

@router.post("/docker/remove/{name}")
def docker_remove(name: str):
    return _run(["docker","rm","-f", name])

@router.post("/docker/build")
def docker_build(tag: str, dockerfile: str = "Dockerfile", context: str = "."):
    return _run(["docker","build","-t",tag,"-f",dockerfile,context], timeout=300)

@router.get("/docker/compose/services")
def compose_services():
    r = _run(["docker","compose","ps","--format","json"])
    if not r["ok"]: return {"error": r["stderr"], "services": []}
    try: return {"services": json.loads(r["stdout"])}
    except Exception: return {"services": [], "raw": r["stdout"][:500]}

@router.post("/docker/compose/{action}")
def compose_action(action: str):
    if action not in ("up","down","restart","pull"): raise HTTPException(400, "Invalid action")
    cmd = ["docker","compose", action]
    if action == "up": cmd.append("-d")
    return _run(cmd, timeout=120)

PRESETS = {
    "mysql": {"image":"mysql:8","name":"dev-mysql","ports":["3306:3306"],"env":["MYSQL_ROOT_PASSWORD=root","MYSQL_DATABASE=devdb"]},
    "redis": {"image":"redis:7","name":"dev-redis","ports":["6379:6379"],"env":[]},
    "postgres": {"image":"postgres:16","name":"dev-postgres","ports":["5432:5432"],"env":["POSTGRES_PASSWORD=root","POSTGRES_DB=devdb"]},
    "mongo": {"image":"mongo:7","name":"dev-mongo","ports":["27017:27017"],"env":[]},
    "rabbitmq": {"image":"rabbitmq:3-management","name":"dev-rabbitmq","ports":["5672:5672","15672:15672"],"env":[]},
    "minio": {"image":"minio/minio","name":"dev-minio","ports":["9000:9000","9001:9001"],"env":["MINIO_ROOT_USER=admin","MINIO_ROOT_PASSWORD=admin123"]},
}

@router.get("/docker/presets")
def get_presets(): return PRESETS

@router.post("/docker/presets/{name}/start")
def start_preset(name: str):
    if name not in PRESETS: raise HTTPException(404, "Preset not found")
    p = PRESETS[name]
    return docker_run(DockerRunBody(image=p["image"], name=p["name"], ports=p["ports"], env=p["env"]))
