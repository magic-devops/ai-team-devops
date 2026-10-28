import io
import json
import tarfile
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace

import pytest

from sop_manager.routers import skill_repo, skills


def _force_cp936_default_encoding(monkeypatch):
    read_text = Path.read_text
    write_text = Path.write_text

    def cp936_read_text(path, encoding=None, errors=None):
        return read_text(path, encoding=encoding or "cp936", errors=errors)

    def cp936_write_text(path, data, encoding=None, errors=None, newline=None):
        return write_text(path, data, encoding=encoding or "cp936", errors=errors, newline=newline)

    monkeypatch.setattr(Path, "read_text", cp936_read_text)
    monkeypatch.setattr(Path, "write_text", cp936_write_text)


def test_skills_page_reads_utf8_skill_content_with_cp936_system_default(tmp_path, monkeypatch):
    skill = {"skill_id": "CUSTOM-001", "name": "代码审查", "description": "检查边界条件"}
    (tmp_path / "CUSTOM-001.json").write_bytes(json.dumps(skill, ensure_ascii=False).encode("utf-8"))
    monkeypatch.setattr(skills, "_skills_dir", lambda: tmp_path)
    _force_cp936_default_encoding(monkeypatch)

    result = next(item for item in skills.list_skills() if item["skill_id"] == "CUSTOM-001")

    assert result["name"] == "代码审查"
    assert result["description"] == "检查边界条件"


def test_skill_repo_reads_utf8_installed_content_with_cp936_system_default(tmp_path, monkeypatch):
    installed = {
        "imported/CUSTOM-001": {
            "skill_id": "CUSTOM-001",
            "data": {"name": "需求拆解", "description": "按目标拆分任务"},
        }
    }
    (tmp_path / "installed.json").write_bytes(json.dumps(installed, ensure_ascii=False).encode("utf-8"))
    monkeypatch.setattr(skill_repo, "_installed_file", lambda: tmp_path / "installed.json")
    _force_cp936_default_encoding(monkeypatch)

    result = skill_repo.list_installed()

    assert result["imported/CUSTOM-001"]["data"]["name"] == "需求拆解"
    assert result["imported/CUSTOM-001"]["data"]["description"] == "按目标拆分任务"


def test_create_skill_persists_utf8_json_with_cp936_system_default(tmp_path, monkeypatch):
    monkeypatch.setattr(skills, "_skills_dir", lambda: tmp_path)
    monkeypatch.setattr(skills, "project_file_write_scope", nullcontext)
    _force_cp936_default_encoding(monkeypatch)

    skills.create_skill(
        skills.SkillDef(skill_id="CUSTOM-002", name="代码审查", description="检查边界条件")
    )

    saved = json.loads((tmp_path / "CUSTOM-002.json").read_bytes().decode("utf-8"))
    assert saved["name"] == "代码审查"


def test_skill_repo_persists_installed_json_as_utf8_with_cp936_system_default(tmp_path, monkeypatch):
    monkeypatch.setattr(skill_repo, "_repo_dir", lambda: tmp_path)
    monkeypatch.setattr(skill_repo, "project_file_write_scope", nullcontext)
    _force_cp936_default_encoding(monkeypatch)

    skill_repo._save_installed({"imported/CUSTOM-002": {"data": {"name": "技能测试"}}})

    saved = json.loads((tmp_path / "installed.json").read_bytes().decode("utf-8"))
    assert saved["imported/CUSTOM-002"]["data"]["name"] == "技能测试"


def test_skills_page_reads_legacy_cp936_skill_file(tmp_path, monkeypatch):
    skill = {"skill_id": "CUSTOM-003", "name": "旧技能", "description": "兼容历史文件"}
    (tmp_path / "CUSTOM-003.json").write_bytes(json.dumps(skill, ensure_ascii=False).encode("cp936"))
    monkeypatch.setattr(skills, "_skills_dir", lambda: tmp_path)

    result = next(item for item in skills.list_skills() if item["skill_id"] == "CUSTOM-003")

    assert result["name"] == "旧技能"
    assert result["description"] == "兼容历史文件"


def test_npm_skill_json_rejects_invalid_utf8_instead_of_replacing(monkeypatch):
    def fake_npm_pack(command, **_kwargs):
        destination = Path(command[command.index("--pack-destination") + 1])
        archive = destination / "skill-package.tgz"
        raw = b'{"name":"\xff"}'
        with tarfile.open(archive, "w:gz") as tar:
            member = tarfile.TarInfo("package/skill.json")
            member.size = len(raw)
            tar.addfile(member, io.BytesIO(raw))
        return SimpleNamespace(returncode=0, stderr="", stdout="")

    monkeypatch.setattr(skill_repo.subprocess, "run", fake_npm_pack)

    with pytest.raises(UnicodeDecodeError):
        skill_repo._load_skill_from_npm_pack("example/skill")
