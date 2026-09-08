#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import stat
import string
import sys
import tarfile
import uuid
from pathlib import Path, PurePosixPath
from typing import Any

MANIFEST_NAME = "hermes-manifest.json"
SCHEMA_VERSION = 1
DEFAULT_API_BASE = "/api/hermes/v1"
WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}


class DistributionError(Exception):
    pass


def _error(message: str, *, code: str = "distribution_error") -> dict[str, str]:
    return {"code": code, "message": message}


def _json_result(ok: bool, **fields: Any) -> int:
    print(json.dumps({"ok": ok, **fields}, sort_keys=True))
    return 0 if ok else 1


def _fail(message: str, *, exit_code: int = 1, json_output: bool = False, code: str = "distribution_error") -> int:
    if json_output:
        return _json_result(False, error=_error(message, code=code))
    print(message, file=sys.stderr)
    return exit_code


def _fail_exception(exc: BaseException, *, json_output: bool = False) -> int:
    code = "os_error" if isinstance(exc, OSError) else "distribution_error"
    return _fail(str(exc), json_output=json_output, code=code)


def _rel_posix(path: Path, root: Path) -> str:
    rel = path.relative_to(root).as_posix()
    return _validate_relative_path(rel)


def _validate_relative_path(value: str, *, allow_root: bool = False) -> str:
    if not isinstance(value, str) or not value or "\x00" in value:
        raise DistributionError("empty or invalid manifest path")
    if "\\" in value or ":" in value:
        raise DistributionError(f"cross-platform unsafe path is not allowed: {value}")
    normalized = PurePosixPath(value)
    if normalized.is_absolute():
        raise DistributionError(f"absolute path is not allowed: {value}")
    normalized_value = normalized.as_posix()
    if normalized_value == ".":
        if allow_root:
            return "."
        raise DistributionError("root path is only allowed as an archive directory sentinel")
    parts = normalized.parts
    if any(part in {"", ".", ".."} for part in parts):
        raise DistributionError(f"path traversal is not allowed: {value}")
    for part in parts:
        _validate_path_component(part, value)
    return normalized_value


def _validate_path_component(part: str, original: str) -> None:
    if part.endswith((" ", ".")):
        raise DistributionError(f"path component with trailing dot or space is not allowed: {original}")
    stem = part.split(".", 1)[0].upper()
    if stem in WINDOWS_RESERVED_NAMES:
        raise DistributionError(f"Windows reserved device path component is not allowed: {original}")


def _validate_symlink_target(target: str) -> str:
    if not isinstance(target, str) or not target or "\x00" in target:
        raise DistributionError("empty or invalid symlink target")
    if "\\" in target or ":" in target:
        raise DistributionError(f"cross-platform unsafe symlink target is not allowed: {target}")
    target_path = PurePosixPath(target)
    if target_path.is_absolute():
        raise DistributionError(f"absolute symlink target is not allowed: {target}")
    depth = 0
    for part in target_path.parts:
        if part in {"", "."}:
            continue
        if part == "..":
            depth -= 1
        else:
            _validate_path_component(part, target)
            depth += 1
        if depth < 0:
            raise DistributionError(f"symlink target escapes install root: {target}")
    return target


def _parse_mode(value: Any, rel: str) -> int:
    if not isinstance(value, str) or len(value) != 4 or any(char not in "01234567" for char in value):
        raise DistributionError(f"invalid POSIX mode for {rel}")
    mode = int(value, 8)
    if mode & (stat.S_ISUID | stat.S_ISGID):
        raise DistributionError(f"setuid/setgid mode is not allowed for {rel}")
    return mode


def _verify_recorded_mode(path: Path, entry: dict[str, Any], rel: str) -> None:
    expected = _parse_mode(entry.get("mode"), rel)
    actual = stat.S_IMODE(path.lstat().st_mode)
    if actual != expected:
        raise DistributionError(f"POSIX mode mismatch: {rel}")


def _verify_symlink_target_within_root(path: Path, root: Path, rel: str) -> None:
    try:
        resolved = path.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise DistributionError(f"symlink target cannot be resolved safely: {rel}") from exc
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise DistributionError(f"symlink target escapes install root: {rel}") from exc


def _member_mode(member: tarfile.TarInfo, rel: str) -> int:
    mode = stat.S_IMODE(member.mode)
    if mode & (stat.S_ISUID | stat.S_ISGID):
        raise DistributionError(f"setuid/setgid archive mode is not allowed for {rel}")
    return mode


def _ancestors(rel: str) -> list[str]:
    parts = PurePosixPath(rel).parts
    return [PurePosixPath(*parts[:index]).as_posix() for index in range(1, len(parts))]


def _ensure_no_symlink_parent(path: Path, root: Path) -> None:
    current = root
    for part in path.relative_to(root).parts[:-1]:
        current = current / part
        if current.is_symlink():
            raise DistributionError(f"refusing to extract through symlink parent: {current.relative_to(root).as_posix()}")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _host_platform() -> str:
    system = platform.system().lower()
    if system == "darwin":
        return "macos"
    if system.startswith(("msys", "mingw", "cygwin")):
        return "windows"
    return system


def _host_arch() -> str:
    machine = platform.machine().lower()
    if machine in {"arm64", "aarch64"}:
        return "arm64"
    if machine in {"x86_64", "amd64"}:
        return "x64"
    return machine


def build_manifest(
    root: Path,
    *,
    version: str,
    package_mode: str,
    target_platform: str,
    target_arch: str,
    api_base: str,
    manifest_name: str = MANIFEST_NAME,
) -> dict[str, Any]:
    root = root.resolve()
    if not root.is_dir():
        raise DistributionError(f"staging root does not exist: {root}")
    manifest_rel = _validate_relative_path(manifest_name)
    entries: list[dict[str, Any]] = []
    for path in sorted(root.rglob("*"), key=lambda item: item.relative_to(root).as_posix()):
        rel = _rel_posix(path, root)
        if rel == manifest_rel:
            continue
        mode = stat.S_IMODE(path.lstat().st_mode)
        if path.is_symlink():
            entries.append(
                {
                    "path": rel,
                    "type": "symlink",
                    "target": _validate_symlink_target(os.readlink(path)),
                    "mode": f"{mode:04o}",
                }
            )
        elif path.is_file():
            entries.append(
                {
                    "path": rel,
                    "type": "file",
                    "size": path.stat().st_size,
                    "sha256": _sha256(path),
                    "mode": f"{mode:04o}",
                }
            )
        elif path.is_dir():
            entries.append({"path": rel, "type": "directory", "mode": f"{mode:04o}"})
        else:
            raise DistributionError(f"unsupported file type in staging root: {rel}")
    return {
        "schema_version": SCHEMA_VERSION,
        "product": "Hermes",
        "version": version,
        "platform": target_platform,
        "arch": target_arch,
        "mode": package_mode,
        "api": {"base_path": api_base},
        "manifest_path": manifest_rel,
        "provenance": {
            "signed": False,
            "publisher": None,
            "statement": (
                "Unsigned development portable runtime bundle. SHA-256 values provide integrity "
                "checks only; they are not a trusted-publisher signature."
            ),
        },
        "files": entries,
    }


def write_manifest(args: argparse.Namespace) -> int:
    try:
        root = Path(args.root)
        manifest = build_manifest(
            root,
            version=args.version,
            package_mode=args.mode,
            target_platform=args.platform,
            target_arch=args.arch,
            api_base=args.api_base,
            manifest_name=args.manifest_name,
        )
        out = Path(args.out) if args.out else root / args.manifest_name
        if out.exists() and not args.force:
            raise DistributionError(f"manifest already exists: {out}")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return _json_result(True, manifest=str(out), files=len(manifest["files"]))
    except (DistributionError, OSError) as exc:
        return _fail_exception(exc, json_output=args.json)


def _read_manifest(path: Path) -> dict[str, Any]:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise DistributionError(f"cannot read manifest: {path}") from exc
    except UnicodeDecodeError as exc:
        raise DistributionError(f"manifest is not valid UTF-8: {path}") from exc
    except json.JSONDecodeError as exc:
        raise DistributionError(f"manifest is not valid JSON: {path}") from exc
    if not isinstance(manifest, dict):
        raise DistributionError("manifest root must be an object")
    return manifest


def _validate_manifest_header(manifest: dict[str, Any]) -> None:
    if manifest.get("schema_version") != SCHEMA_VERSION:
        raise DistributionError("unsupported manifest schema_version")
    if manifest.get("product") != "Hermes":
        raise DistributionError("manifest product is not Hermes")
    for field in ("version", "platform", "arch", "mode"):
        if not isinstance(manifest.get(field), str) or not manifest[field]:
            raise DistributionError(f"manifest field must be a non-empty string: {field}")
    api = manifest.get("api")
    if not isinstance(api, dict) or not isinstance(api.get("base_path"), str) or not api["base_path"]:
        raise DistributionError("manifest api.base_path must be a non-empty string")
    provenance = manifest.get("provenance")
    if not isinstance(provenance, dict) or not isinstance(provenance.get("signed"), bool):
        raise DistributionError("manifest provenance.signed must be a boolean")
    manifest_path = manifest.get("manifest_path", MANIFEST_NAME)
    if not isinstance(manifest_path, str):
        raise DistributionError("manifest_path must be a string")
    _validate_relative_path(manifest_path)


def _validate_manifest_entry(entry: Any, seen: set[str], blockers: set[str]) -> None:
    if not isinstance(entry, dict):
        raise DistributionError("manifest file entries must be objects")
    rel = _validate_relative_path(entry.get("path", ""))
    if rel in seen:
        raise DistributionError(f"duplicate manifest path: {rel}")
    kind = entry.get("type")
    if not isinstance(kind, str):
        raise DistributionError(f"manifest entry type must be a string for {rel}")
    if kind not in {"file", "directory", "symlink"}:
        raise DistributionError(f"unsupported manifest entry type for {rel}: {kind}")
    _parse_mode(entry.get("mode"), rel)
    for ancestor in _ancestors(rel):
        if ancestor in blockers:
            raise DistributionError(f"manifest path descends through file or symlink: {rel}")
    if kind in {"file", "symlink"}:
        for existing in seen:
            if existing.startswith(rel + "/"):
                raise DistributionError(f"manifest file or symlink has descendants: {rel}")
        blockers.add(rel)
    seen.add(rel)
    if kind == "symlink":
        _validate_symlink_target(entry.get("target", ""))
    if kind == "file":
        _validate_manifest_file_entry(entry, rel)


def _validate_manifest_file_entry(entry: dict[str, Any], rel: str) -> None:
    if not isinstance(entry.get("size"), int) or entry["size"] < 0:
        raise DistributionError(f"invalid file size for {rel}")
    digest = entry.get("sha256")
    if not isinstance(digest, str) or len(digest) != 64 or any(char not in string.hexdigits for char in digest):
        raise DistributionError(f"invalid sha256 for {rel}")


def _load_manifest(path: Path) -> dict[str, Any]:
    manifest = _read_manifest(path)
    _validate_manifest_header(manifest)
    files = manifest.get("files")
    if not isinstance(files, list):
        raise DistributionError("manifest files must be an array")
    seen: set[str] = set()
    blockers: set[str] = set()
    for entry in files:
        _validate_manifest_entry(entry, seen, blockers)
    return manifest


def _actual_payload_paths(root: Path, manifest_rel: str) -> set[str]:
    actual: set[str] = set()
    for path in sorted(root.rglob("*"), key=lambda item: item.relative_to(root).as_posix()):
        rel = _rel_posix(path, root)
        if rel != manifest_rel:
            actual.add(rel)
    return actual


def _verify_manifest_entry(root: Path, rel: str, entry: dict[str, Any]) -> None:
    path = root / rel
    kind = entry["type"]
    if kind == "directory":
        if path.is_symlink() or not path.is_dir():
            raise DistributionError(f"expected real directory missing: {rel}")
        _verify_recorded_mode(path, entry, rel)
    if kind == "symlink":
        if not path.is_symlink():
            raise DistributionError(f"expected symlink missing: {rel}")
        target = os.readlink(path)
        if target != entry["target"]:
            raise DistributionError(f"symlink target mismatch: {rel}")
        _validate_symlink_target(target)
        _verify_symlink_target_within_root(path, root, rel)
    if kind == "file":
        if not path.is_file() or path.is_symlink():
            raise DistributionError(f"expected regular file missing: {rel}")
        _verify_recorded_mode(path, entry, rel)
        size = path.stat().st_size
        if size != entry["size"]:
            raise DistributionError(f"file size mismatch: {rel}")
        digest = _sha256(path)
        if digest != entry["sha256"]:
            raise DistributionError(f"sha256 mismatch: {rel}")


def verify_root(root: Path, manifest_path: Path) -> dict[str, Any]:
    root = root.resolve()
    if not root.is_dir():
        raise DistributionError(f"install root does not exist: {root}")
    manifest = _load_manifest(manifest_path)
    manifest_rel = str(manifest.get("manifest_path", MANIFEST_NAME))
    expected = {entry["path"]: entry for entry in manifest["files"]}
    actual = _actual_payload_paths(root, manifest_rel)
    missing = sorted(set(expected).difference(actual))
    unlisted = sorted(actual.difference(expected))
    if missing:
        raise DistributionError(f"manifest entries missing from root: {missing[:5]}")
    if unlisted:
        raise DistributionError(f"unlisted files found in root: {unlisted[:5]}")
    for rel, entry in expected.items():
        _verify_manifest_entry(root, rel, entry)
    return {"manifest": manifest, "files": len(expected)}


def verify_command(args: argparse.Namespace) -> int:
    try:
        result = verify_root(Path(args.root), Path(args.manifest))
        return _json_result(True, manifest=str(args.manifest), files=result["files"])
    except (DistributionError, OSError) as exc:
        return _fail_exception(exc, json_output=args.json)


def _validate_archive_member(member: tarfile.TarInfo, seen: set[str], blockers: set[str]) -> None:
    rel = _validate_relative_path(member.name, allow_root=True)
    if rel == ".":
        if not member.isdir():
            raise DistributionError("archive root sentinel must be a directory")
        return
    if rel in seen:
        raise DistributionError(f"duplicate archive path: {rel}")
    if not (member.isdir() or member.isfile() or member.issym()):
        raise DistributionError(f"unsupported archive member type: {rel}")
    _member_mode(member, rel)
    for ancestor in _ancestors(rel):
        if ancestor in blockers:
            raise DistributionError(f"archive path descends through file or symlink: {rel}")
    if member.isfile() or member.issym():
        for existing in seen:
            if existing.startswith(rel + "/"):
                raise DistributionError(f"archive file or symlink has descendants: {rel}")
        blockers.add(rel)
    seen.add(rel)
    if member.issym():
        _validate_symlink_target(member.linkname)


def _safe_tar_members(archive: Path) -> list[tarfile.TarInfo]:
    try:
        tar = tarfile.open(archive, "r:*")
    except tarfile.TarError as exc:
        raise DistributionError(f"cannot open archive: {archive}") from exc
    with tar:
        members = tar.getmembers()
        seen: set[str] = set()
        blockers: set[str] = set()
        for member in members:
            _validate_archive_member(member, seen, blockers)
        return members


def _extract_archive(archive: Path, target: Path) -> None:
    members = [member for member in _safe_tar_members(archive) if _validate_relative_path(member.name, allow_root=True) != "."]
    regular_members = [member for member in members if not member.issym()]
    symlink_members = [member for member in members if member.issym()]
    with tarfile.open(archive, "r:*") as tar:
        for member in [*regular_members, *symlink_members]:
            destination = target / _validate_relative_path(member.name)
            destination_parent = destination.parent
            _ensure_no_symlink_parent(destination_parent / destination.name, target)
            if member.isdir():
                destination.mkdir(parents=True, exist_ok=True)
                if destination.is_symlink():
                    raise DistributionError(f"directory path is a symlink: {member.name}")
                destination.chmod(_member_mode(member, member.name))
            elif member.isfile():
                destination_parent.mkdir(parents=True, exist_ok=True)
                _ensure_no_symlink_parent(destination, target)
                source = tar.extractfile(member)
                if source is None:
                    raise DistributionError(f"cannot read archive file member: {member.name}")
                with source, destination.open("wb") as handle:
                    shutil.copyfileobj(source, handle)
                destination.chmod(_member_mode(member, member.name))
            elif member.issym():
                destination_parent.mkdir(parents=True, exist_ok=True)
                _ensure_no_symlink_parent(destination, target)
                os.symlink(member.linkname, destination)
            else:
                raise DistributionError(f"unsupported archive member type: {member.name}")


def install_command(args: argparse.Namespace) -> int:
    reserved_dest = False
    temp_root: Path | None = None
    try:
        manifest_name = _validate_relative_path(args.manifest_name)
        dest = Path(args.dest).expanduser()
        if dest.exists() or dest.is_symlink():
            raise DistributionError(f"destination already exists: {dest}")
        parent = dest.parent
        if not parent.is_dir():
            raise DistributionError(f"destination parent does not exist: {parent}")
        dest.mkdir(mode=0o755)
        reserved_dest = True
        temp_root = dest / f".staging-{uuid.uuid4().hex}"
        if args.archive:
            temp_root.mkdir(mode=0o755)
            _extract_archive(Path(args.archive), temp_root)
            manifest_path = temp_root / manifest_name
        else:
            source = Path(args.source).resolve()
            if not source.is_dir():
                raise DistributionError(f"source root does not exist: {source}")
            shutil.copytree(source, temp_root, symlinks=True)
            manifest_path = temp_root / manifest_name
        verify_root(temp_root, manifest_path)
        unexpected = [item for item in dest.iterdir() if item != temp_root]
        if unexpected:
            raise DistributionError("destination changed during install; refusing to publish")
        for child in sorted(temp_root.iterdir(), key=lambda item: item.name):
            child.rename(dest / child.name)
        temp_root.rmdir()
        return _json_result(True, destination=str(dest), manifest=str(dest / manifest_name))
    except (DistributionError, OSError, tarfile.TarError) as exc:
        if temp_root is not None:
            shutil.rmtree(temp_root, ignore_errors=True)
        if reserved_dest:
            try:
                if not any(dest.iterdir()):
                    dest.rmdir()
            except OSError:
                pass
        return _fail_exception(exc, json_output=args.json)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="hermes-distribution", description="Hermes portable runtime packaging tools")
    sub = parser.add_subparsers(dest="command", required=True)

    manifest = sub.add_parser("manifest", help="write a portable runtime manifest for a staged bundle")
    manifest.add_argument("--root", required=True, help="staged archive root")
    manifest.add_argument("--out", help="manifest output path; defaults to ROOT/hermes-manifest.json")
    manifest.add_argument("--manifest-name", default=MANIFEST_NAME)
    manifest.add_argument("--version", default="1.0.0")
    manifest.add_argument("--platform", default=_host_platform())
    manifest.add_argument("--arch", default=_host_arch())
    manifest.add_argument("--mode", choices=["core-only", "full"], required=True)
    manifest.add_argument("--api-base", default=DEFAULT_API_BASE)
    manifest.add_argument("--force", action="store_true")
    manifest.add_argument("--json", action="store_true", default=True)
    manifest.set_defaults(func=write_manifest)

    verify = sub.add_parser("verify", help="verify a staged or installed root against a manifest")
    verify.add_argument("--root", required=True)
    verify.add_argument("--manifest", required=True)
    verify.add_argument("--json", action="store_true", default=True)
    verify.set_defaults(func=verify_command)

    install = sub.add_parser("install", help="transactionally install an archive or staged root to a new destination")
    source = install.add_mutually_exclusive_group(required=True)
    source.add_argument("--archive", help="portable tar archive")
    source.add_argument("--source", help="staged root directory, mainly for local verification")
    install.add_argument("--dest", required=True, help="new destination path; must not already exist")
    install.add_argument("--manifest-name", default=MANIFEST_NAME)
    install.add_argument("--json", action="store_true", default=True)
    install.set_defaults(func=install_command)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
