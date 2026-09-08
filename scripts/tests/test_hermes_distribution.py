from __future__ import annotations

import importlib.util
import io
import json
import os
import stat
import tarfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "hermes-distribution.py"
SPEC = importlib.util.spec_from_file_location("hermes_distribution", SCRIPT)
dist = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(dist)


def _bundle(root: Path) -> Path:
    bundle = root / "stage"
    app = bundle / "Hermes" / "runtime" / "hermes-core"
    app.mkdir(parents=True)
    binary = app / "hermes-core"
    binary.write_text("core\n", encoding="utf-8")
    binary.chmod(0o755)
    (bundle / "Hermes" / "runtime" / "agentd").mkdir(parents=True)
    (bundle / "Hermes" / "runtime" / "agentd" / "sop-agentd").write_text("agentd\n", encoding="utf-8")
    return bundle


def _manifest(stage: Path) -> Path:
    rc = dist.main(["manifest", "--root", str(stage), "--mode", "core-only"])
    assert rc == 0
    return stage / dist.MANIFEST_NAME


def _archive(stage: Path, archive: Path) -> Path:
    with tarfile.open(archive, "w:gz") as tar:
        for path in sorted(stage.rglob("*")):
            tar.add(path, arcname=path.relative_to(stage).as_posix(), recursive=False)
    return archive


def _write_manifest(path: Path, files: object) -> Path:
    payload = {
        "schema_version": 1,
        "product": "Hermes",
        "version": "1.0.0",
        "platform": "macos",
        "arch": "arm64",
        "mode": "core-only",
        "api": {"base_path": "/api/hermes/v1"},
        "manifest_path": "hermes-manifest.json",
        "provenance": {"signed": False},
        "files": files,
    }
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def _tar_bytes_member(tar: tarfile.TarFile, name: str, data: bytes = b"x", mode: int = 0o644) -> None:
    info = tarfile.TarInfo(name)
    info.type = tarfile.REGTYPE
    info.mode = mode
    info.size = len(data)
    tar.addfile(info, io.BytesIO(data))


def _tar_dir_member(tar: tarfile.TarFile, name: str, mode: int = 0o755) -> None:
    info = tarfile.TarInfo(name)
    info.type = tarfile.DIRTYPE
    info.mode = mode
    tar.addfile(info)


def _tar_symlink_member(tar: tarfile.TarFile, name: str, target: str, mode: int = 0o777) -> None:
    info = tarfile.TarInfo(name)
    info.type = tarfile.SYMTYPE
    info.mode = mode
    info.linkname = target
    tar.addfile(info)


def test_manifest_records_product_contract_and_unsigned_provenance(tmp_path: Path) -> None:
    stage = _bundle(tmp_path)
    manifest_path = _manifest(stage)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    assert manifest["version"] == "1.0.0"
    assert manifest["mode"] == "core-only"
    assert manifest["api"]["base_path"] == "/api/hermes/v1"
    assert manifest["provenance"]["signed"] is False
    assert "not a trusted-publisher signature" in manifest["provenance"]["statement"]
    files = {entry["path"]: entry for entry in manifest["files"]}
    assert files["Hermes/runtime/hermes-core/hermes-core"]["sha256"]
    assert files["Hermes/runtime/hermes-core/hermes-core"]["size"] == 5


def test_valid_install_from_archive_to_new_destination(tmp_path: Path) -> None:
    stage = _bundle(tmp_path)
    _manifest(stage)
    archive = _archive(stage, tmp_path / "hermes.tar.gz")
    dest = tmp_path / "installed"

    assert dist.main(["install", "--archive", str(archive), "--dest", str(dest)]) == 0

    assert (dest / dist.MANIFEST_NAME).is_file()
    assert (dest / "Hermes" / "runtime" / "hermes-core" / "hermes-core").read_text(encoding="utf-8") == "core\n"
    assert dist.main(["verify", "--root", str(dest), "--manifest", str(dest / dist.MANIFEST_NAME)]) == 0


def test_install_refuses_existing_destination(tmp_path: Path) -> None:
    stage = _bundle(tmp_path)
    _manifest(stage)
    archive = _archive(stage, tmp_path / "hermes.tar.gz")
    dest = tmp_path / "installed"
    dest.mkdir()

    assert dist.main(["install", "--archive", str(archive), "--dest", str(dest)]) == 1
    assert list(dest.iterdir()) == []


def test_verify_rejects_tampered_file(tmp_path: Path) -> None:
    stage = _bundle(tmp_path)
    manifest = _manifest(stage)
    (stage / "Hermes" / "runtime" / "hermes-core" / "hermes-core").write_text("changed\n", encoding="utf-8")

    assert dist.main(["verify", "--root", str(stage), "--manifest", str(manifest)]) == 1


def test_verify_rejects_missing_file(tmp_path: Path) -> None:
    stage = _bundle(tmp_path)
    manifest = _manifest(stage)
    (stage / "Hermes" / "runtime" / "agentd" / "sop-agentd").unlink()

    assert dist.main(["verify", "--root", str(stage), "--manifest", str(manifest)]) == 1


def test_verify_rejects_unlisted_file(tmp_path: Path) -> None:
    stage = _bundle(tmp_path)
    manifest = _manifest(stage)
    (stage / "Hermes" / "extra.txt").write_text("extra\n", encoding="utf-8")

    assert dist.main(["verify", "--root", str(stage), "--manifest", str(manifest)]) == 1


def test_manifest_rejects_symlink_traversal(tmp_path: Path) -> None:
    stage = _bundle(tmp_path)
    os.symlink("../../outside", stage / "Hermes" / "bad-link")

    assert dist.main(["manifest", "--root", str(stage), "--mode", "core-only"]) == 1


def test_verify_preserves_safe_symlink(tmp_path: Path) -> None:
    stage = _bundle(tmp_path)
    os.symlink("hermes-core", stage / "Hermes" / "runtime" / "current-core")
    manifest = _manifest(stage)
    archive = _archive(stage, tmp_path / "hermes.tar.gz")
    dest = tmp_path / "installed"

    assert dist.main(["install", "--archive", str(archive), "--dest", str(dest)]) == 0
    link = dest / "Hermes" / "runtime" / "current-core"
    assert link.is_symlink()
    assert os.readlink(link) == "hermes-core"
    assert dist.main(["verify", "--root", str(dest), "--manifest", str(dest / manifest.name)]) == 0


def test_install_rejects_archive_traversal(tmp_path: Path) -> None:
    archive = tmp_path / "bad.tar.gz"
    payload = tmp_path / "payload"
    payload.write_text("bad\n", encoding="utf-8")
    with tarfile.open(archive, "w:gz") as tar:
        tar.add(payload, arcname="../escape")

    assert dist.main(["install", "--archive", str(archive), "--dest", str(tmp_path / "installed")]) == 1
    assert not (tmp_path / "installed").exists()


def test_relative_paths_reject_cross_platform_unsafe_names() -> None:
    for value in (
        "C:/Hermes/file",
        "Hermes\\runtime",
        "Hermes/file:name",
        "Hermes/\x00bad",
        "../Hermes",
        "Hermes/CON",
        "Hermes/con.txt",
        "Hermes/PRN.log",
        "Hermes/AUX",
        "Hermes/NUL.data",
        "Hermes/COM1",
        "Hermes/com9.txt",
        "Hermes/LPT1",
        "Hermes/lpt9.txt",
        "Hermes/trailing.",
        "Hermes/trailing ",
    ):
        try:
            dist._validate_relative_path(value)
        except dist.DistributionError:
            pass
        else:
            raise AssertionError(f"unsafe path accepted: {value}")


def test_symlink_targets_reject_windows_devices_and_trailing_names() -> None:
    for target in ("CON", "safe/NUL.txt", "COM1/data", "safe/LPT9.log", "safe/trailing.", "safe/trailing "):
        try:
            dist._validate_symlink_target(target)
        except dist.DistributionError:
            pass
        else:
            raise AssertionError(f"unsafe symlink target accepted: {target}")


def test_archive_root_dot_is_only_directory_sentinel(tmp_path: Path) -> None:
    archive = tmp_path / "bad-root.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        _tar_bytes_member(tar, ".")

    assert dist.main(["install", "--archive", str(archive), "--dest", str(tmp_path / "installed")]) == 1
    assert not (tmp_path / "installed").exists()


def test_install_rejects_duplicate_normalized_archive_paths(tmp_path: Path) -> None:
    archive = tmp_path / "duplicate.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        _tar_bytes_member(tar, "Hermes/file", b"a")
        _tar_bytes_member(tar, "./Hermes/file", b"b")

    assert dist.main(["install", "--archive", str(archive), "--dest", str(tmp_path / "installed")]) == 1


def test_install_rejects_ancestor_file_and_symlink_conflicts(tmp_path: Path) -> None:
    file_archive = tmp_path / "ancestor-file.tar.gz"
    with tarfile.open(file_archive, "w:gz") as tar:
        _tar_bytes_member(tar, "Hermes", b"file")
        _tar_bytes_member(tar, "Hermes/runtime/core", b"core")
    assert dist.main(["install", "--archive", str(file_archive), "--dest", str(tmp_path / "file-installed")]) == 1

    symlink_archive = tmp_path / "ancestor-link.tar.gz"
    with tarfile.open(symlink_archive, "w:gz") as tar:
        _tar_symlink_member(tar, "Hermes/runtime", "safe")
        _tar_bytes_member(tar, "Hermes/runtime/core", b"core")
    assert dist.main(["install", "--archive", str(symlink_archive), "--dest", str(tmp_path / "link-installed")]) == 1


def test_install_rejects_file_or_symlink_with_existing_descendants(tmp_path: Path) -> None:
    archive = tmp_path / "descendant.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        _tar_dir_member(tar, "Hermes")
        _tar_bytes_member(tar, "Hermes/runtime/core", b"core")
        _tar_symlink_member(tar, "Hermes/runtime", "other")

    assert dist.main(["install", "--archive", str(archive), "--dest", str(tmp_path / "installed")]) == 1


def test_install_rejects_setuid_and_setgid_archive_modes(tmp_path: Path) -> None:
    archive = tmp_path / "setuid.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        _tar_bytes_member(tar, "Hermes/core", b"core", mode=stat.S_ISUID | 0o755)

    assert dist.main(["install", "--archive", str(archive), "--dest", str(tmp_path / "installed")]) == 1


def test_manifest_schema_rejects_malformed_files_array_and_entries(tmp_path: Path, capsys) -> None:
    stage = _bundle(tmp_path)
    manifest = _write_manifest(stage / dist.MANIFEST_NAME, None)
    assert dist.main(["verify", "--root", str(stage), "--manifest", str(manifest)]) == 1
    assert json.loads(capsys.readouterr().out)["error"]["code"] == "distribution_error"

    manifest = _write_manifest(stage / dist.MANIFEST_NAME, [None])
    assert dist.main(["verify", "--root", str(stage), "--manifest", str(manifest)]) == 1
    assert json.loads(capsys.readouterr().out)["error"]["message"] == "manifest file entries must be objects"

    manifest = _write_manifest(stage / dist.MANIFEST_NAME, [
        {"path": "Hermes", "type": [], "mode": "0755"},
    ])
    assert dist.main(["verify", "--root", str(stage), "--manifest", str(manifest)]) == 1
    assert "type must be a string" in json.loads(capsys.readouterr().out)["error"]["message"]


def test_manifest_schema_rejects_bad_modes_and_duplicate_paths(tmp_path: Path) -> None:
    stage = _bundle(tmp_path)
    manifest = _write_manifest(stage / dist.MANIFEST_NAME, [
        {"path": "Hermes", "type": "directory", "mode": "0755"},
        {"path": "./Hermes", "type": "directory", "mode": "0755"},
    ])
    assert dist.main(["verify", "--root", str(stage), "--manifest", str(manifest)]) == 1

    manifest = _write_manifest(stage / dist.MANIFEST_NAME, [
        {"path": "Hermes", "type": "directory", "mode": "4755"},
    ])
    assert dist.main(["verify", "--root", str(stage), "--manifest", str(manifest)]) == 1

    manifest = _write_manifest(stage / dist.MANIFEST_NAME, [
        {"path": "Hermes/file", "type": "file", "mode": "0644", "size": 1, "sha256": "z" * 64},
    ])
    assert dist.main(["verify", "--root", str(stage), "--manifest", str(manifest)]) == 1


def test_manifest_schema_rejects_non_string_manifest_path_and_invalid_utf8(tmp_path: Path) -> None:
    stage = _bundle(tmp_path)
    payload = json.loads(_write_manifest(stage / dist.MANIFEST_NAME, []).read_text(encoding="utf-8"))
    payload["manifest_path"] = []
    (stage / dist.MANIFEST_NAME).write_text(json.dumps(payload), encoding="utf-8")

    assert dist.main(["verify", "--root", str(stage), "--manifest", str(stage / dist.MANIFEST_NAME)]) == 1

    bad = stage / "bad-manifest.json"
    bad.write_bytes(b"\xff\xfe")
    assert dist.main(["verify", "--root", str(stage), "--manifest", str(bad)]) == 1


def test_verify_rejects_mode_mismatch_for_files_and_directories(tmp_path: Path) -> None:
    stage = _bundle(tmp_path)
    manifest = _manifest(stage)
    payload = json.loads(manifest.read_text(encoding="utf-8"))
    for entry in payload["files"]:
        if entry["path"] == "Hermes":
            entry["mode"] = "0700"
        if entry["path"] == "Hermes/runtime/hermes-core/hermes-core":
            entry["mode"] = "0600"
    manifest.write_text(json.dumps(payload), encoding="utf-8")

    assert dist.main(["verify", "--root", str(stage), "--manifest", str(manifest)]) == 1


def test_verify_rejects_directory_symlink(tmp_path: Path) -> None:
    stage = tmp_path / "stage"
    stage.mkdir()
    target = tmp_path / "target"
    target.mkdir()
    os.symlink(target, stage / "Hermes")
    manifest = _write_manifest(stage / dist.MANIFEST_NAME, [
        {"path": "Hermes", "type": "directory", "mode": "0755"},
    ])

    assert dist.main(["verify", "--root", str(stage), "--manifest", str(manifest)]) == 1


def test_verify_rejects_symlink_chain_that_resolves_outside_root(tmp_path: Path) -> None:
    stage = tmp_path / "stage"
    stage.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    os.symlink(".", stage / "l2")
    os.symlink("l2/..", stage / "l1")
    manifest = _write_manifest(stage / dist.MANIFEST_NAME, [
        {"path": "l2", "type": "symlink", "mode": "0777", "target": "."},
        {"path": "l1", "type": "symlink", "mode": "0777", "target": "l2/.."},
    ])

    assert dist.main(["verify", "--root", str(stage), "--manifest", str(manifest)]) == 1


def test_verify_rejects_symlink_cycle(tmp_path: Path) -> None:
    stage = tmp_path / "stage"
    stage.mkdir()
    os.symlink("b", stage / "a")
    os.symlink("a", stage / "b")
    manifest = _write_manifest(stage / dist.MANIFEST_NAME, [
        {"path": "a", "type": "symlink", "mode": "0777", "target": "b"},
        {"path": "b", "type": "symlink", "mode": "0777", "target": "a"},
    ])

    assert dist.main(["verify", "--root", str(stage), "--manifest", str(manifest)]) == 1


def test_install_validates_manifest_name_before_destination_reservation(tmp_path: Path) -> None:
    stage = _bundle(tmp_path)
    _manifest(stage)
    archive = _archive(stage, tmp_path / "hermes.tar.gz")
    dest = tmp_path / "installed"

    assert dist.main(["install", "--archive", str(archive), "--dest", str(dest), "--manifest-name", "bad\\name"]) == 1
    assert not dest.exists()


def test_cli_returns_structured_os_errors(tmp_path: Path, capsys) -> None:
    missing_parent = tmp_path / "missing" / "installed"
    assert dist.main(["install", "--source", str(tmp_path), "--dest", str(missing_parent)]) == 1
    payload = json.loads(capsys.readouterr().out)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "distribution_error"

    assert dist.main(["verify", "--root", str(tmp_path / "missing-root"), "--manifest", str(tmp_path / "m.json")]) == 1
    payload = json.loads(capsys.readouterr().out)
    assert payload["error"]["message"].startswith("install root does not exist")
