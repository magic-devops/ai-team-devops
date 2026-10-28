"""Exercise the document APIs consumed by the editor on a CP936 Windows host."""
from contextlib import nullcontext
import importlib
import json
import ast
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from sop_manager.routers import system, workspace
from sop_manager.routers.business_access import read_business_access


@pytest.fixture
def document_client(tmp_path, monkeypatch):
    original_read = Path.read_text
    original_write = Path.write_text
    monkeypatch.setattr(Path, "read_text", lambda p, encoding=None, errors=None:
                        original_read(p, encoding=encoding or "cp936", errors=errors))
    monkeypatch.setattr(Path, "write_text", lambda p, data, encoding=None, errors=None, newline=None:
                        original_write(p, data, encoding=encoding or "cp936", errors=errors, newline=newline))
    monkeypatch.setattr(workspace, "sop_dir", lambda: tmp_path / "ai-sop")
    monkeypatch.setattr(workspace, "resolved_project_path", lambda: tmp_path)
    monkeypatch.setattr(system, "resolved_ai_memory_root", lambda: tmp_path / "ai-memory")
    monkeypatch.setattr(system, "_try_sop_ops", lambda: tmp_path / "ai-sop-ops")
    monkeypatch.setattr(workspace, "project_file_write_scope", nullcontext)
    monkeypatch.setattr(system, "project_file_write_scope", nullcontext)
    app = FastAPI()
    app.include_router(workspace.router)
    app.include_router(system.router)
    app.dependency_overrides[read_business_access] = lambda: None
    with TestClient(app) as client:
        yield client


DOCUMENTS = [
    ("ai-sop/specs/ai-collab/PROMPT_SPEC.md", "/api/v1/specs/content?path=ai-collab/PROMPT_SPEC.md"),
    ("sop/custom/design.md", "/api/v1/custom/content?path=design.md"),
    ("ai-memory/rules/RULES.md", "/api/v1/system/memory/rules/RULES.md"),
    ("ai-sop-ops/example.py", "/api/v1/system/scripts/example.py/content"),
]


@pytest.mark.parametrize("relative,url", DOCUMENTS)
@pytest.mark.parametrize("encoding", ["utf-8", "utf-8-sig", "cp936"])
def test_document_api_preserves_chinese(document_client, tmp_path, relative, url, encoding):
    content = "# Prompt 工程规范\n\n系统提示（System）= 角色 + 规则 + 约束\n"
    target = tmp_path / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content.encode(encoding))

    response = document_client.get(url)

    assert response.status_code == 200
    assert response.json()["content"] == content


@pytest.mark.parametrize("relative,url", DOCUMENTS)
def test_invalid_document_encoding_is_reported(document_client, tmp_path, relative, url):
    target = tmp_path / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"# invalid \xff")

    response = document_client.get(url)

    assert response.status_code == 422
    assert "UTF-8" in response.json()["detail"]
    assert target.read_bytes() == b"# invalid \xff"


def test_script_save_and_reload_preserves_unicode(document_client, tmp_path):
    target = tmp_path / "ai-sop-ops/example.py"
    target.parent.mkdir(parents=True)
    content = "# 中文脚本 🚀\nprint('操作完成')\n"
    response = document_client.put("/api/v1/system/scripts/example.py", json={"content": content})
    assert response.status_code == 200
    assert target.read_bytes().decode("utf-8").replace("\r\n", "\n") == content
    assert document_client.get("/api/v1/system/scripts/example.py/content").json()["content"] == content


def test_spec_save_and_reload_preserves_unicode(document_client, tmp_path):
    target = tmp_path / "ai-sop/specs/ai-collab/PROMPT_SPEC.md"
    content = "# Prompt 工程规范 🚀\n用户消息 = 任务 + 上下文 + 输出要求\n"
    response = document_client.put("/api/v1/specs/content?path=ai-collab/PROMPT_SPEC.md", json={"content": content})
    assert response.status_code == 200
    assert target.read_bytes().decode("utf-8").replace("\r\n", "\n") == content
    assert document_client.get("/api/v1/specs/content?path=ai-collab/PROMPT_SPEC.md").json()["content"] == content


@pytest.mark.parametrize("module_name", ["data_ingest", "data_quality", "llm_gateway_v2", "metrics_service", "ops_center", "tag_service"])
def test_domain_metadata_preserves_chinese_on_windows(document_client, tmp_path, monkeypatch, module_name):
    module = importlib.import_module(f"sop_manager.routers.{module_name}")
    def storage_dir(sub):
        path = tmp_path / module_name / sub
        path.mkdir(parents=True, exist_ok=True)
        return path
    monkeypatch.setattr(module, "_dir", storage_dir)
    if hasattr(module, "project_file_write_scope"):
        monkeypatch.setattr(module, "project_file_write_scope", nullcontext)
    if hasattr(module, "attach_scope"):
        monkeypatch.setattr(module, "attach_scope", lambda item, **kwargs: item)
        monkeypatch.setattr(module, "scope_matches", lambda item, **kwargs: True)
    item = {"id": "example", "name": "中文名称", "description": "展示内容 🚀"}
    module._save("entries", item)
    stored = tmp_path / module_name / "entries/example.json"
    assert json.loads(stored.read_bytes().decode("utf-8"))["description"] == item["description"]
    assert module._load_all("entries")[0]["description"] == item["description"]
    # Data saved by an older CP936 Windows host must still be readable.
    item["description"] = "历史内容"
    stored.write_bytes(json.dumps(item, ensure_ascii=False).encode("cp936"))
    assert module._load_all("entries")[0]["description"] == "历史内容"


def test_screenshot_document_is_served_without_changes(document_client, monkeypatch):
    root = Path(__file__).resolve().parents[3] / "ai-sop"
    original = (root / "specs/ai-collab/PROMPT_SPEC.md").read_bytes()
    monkeypatch.setattr(workspace, "sop_dir", lambda: root)
    response = document_client.get("/api/v1/specs/content?path=ai-collab/PROMPT_SPEC.md")
    assert response.status_code == 200
    assert response.json()["content"] == original.decode("utf-8-sig").replace("\r\n", "\n")
    assert "Prompt 工程规范" in response.json()["content"]
    assert (root / "specs/ai-collab/PROMPT_SPEC.md").read_bytes() == original


@pytest.mark.parametrize("kind", ["specs", "custom"])
def test_legacy_document_api_preserves_chinese(document_client, tmp_path, monkeypatch, kind):
    from sop_manager import legacy_api_dashboard as legacy
    monkeypatch.setattr(legacy, "__file__", str(tmp_path / "legacy/app.py"))
    monkeypatch.setenv("PROJECT_PATH", str(tmp_path))
    relative = "specs/document.md" if kind == "specs" else "sop/custom/document.md"
    target = tmp_path / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes("# 工程规范\n中文内容".encode("utf-8"))
    with TestClient(legacy.app) as client:
        response = client.get(f"/api/{kind}/content?path=document.md")
    assert response.status_code == 200
    assert response.json()["content"] == "# 工程规范\n中文内容"


def test_manager_text_io_does_not_use_platform_default_encoding():
    root = Path(workspace.__file__).resolve().parent.parent
    implicit = []
    for path in root.rglob("*.py"):
        if path.name.startswith("test_"):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8-sig"))
        for node in ast.walk(tree):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr in {"read_text", "write_text"}
                    and not any(keyword.arg == "encoding" for keyword in node.keywords)):
                implicit.append(f"{path.relative_to(root)}:{node.lineno}")
    assert not implicit, "Text I/O must choose an encoding explicitly: " + ", ".join(implicit)
