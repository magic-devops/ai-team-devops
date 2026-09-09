#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import json
import os
import platform
import shutil
import stat
import string
import sys
import tarfile
import tempfile
import uuid
from pathlib import Path, PurePosixPath
from typing import Any

MANIFEST_NAME = "hermes-manifest.json"
SCHEMA_VERSION = 1
DEFAULT_API_BASE = "/api/hermes/v1"
RELEASE_MANIFEST_NAME = "hermes-release.json"
SIGNATURE_ALGORITHM = "ed25519"
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


def _require_crypto() -> Any:
    try:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
    except ImportError as exc:
        raise DistributionError(
            "cryptography is required for signed release manifests; install the repository's existing manager dependency"
        ) from exc
    return {
        "InvalidSignature": InvalidSignature,
        "serialization": serialization,
        "Ed25519PrivateKey": Ed25519PrivateKey,
        "Ed25519PublicKey": Ed25519PublicKey,
    }


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


def _canonical_json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _b64encode(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _b64decode(value: Any, field: str) -> bytes:
    if not isinstance(value, str) or not value:
        raise DistributionError(f"{field} must be a non-empty base64 string")
    try:
        return base64.b64decode(value.encode("ascii"), validate=True)
    except (ValueError, UnicodeEncodeError) as exc:
        raise DistributionError(f"{field} is not valid base64") from exc


def _load_private_key(path: Path) -> Any:
    crypto = _require_crypto()
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise DistributionError(f"cannot read private key: {path}") from exc
    password = os.getenv("HERMES_RELEASE_PRIVATE_KEY_PASSWORD")
    key = crypto["serialization"].load_pem_private_key(
        data,
        password=password.encode("utf-8") if password else None,
    )
    if not isinstance(key, crypto["Ed25519PrivateKey"]):
        raise DistributionError("release private key must be an Ed25519 PEM key")
    return key


def _load_public_key(path: Path) -> Any:
    crypto = _require_crypto()
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise DistributionError(f"cannot read public key: {path}") from exc
    key = crypto["serialization"].load_pem_public_key(data)
    if not isinstance(key, crypto["Ed25519PublicKey"]):
        raise DistributionError("release public key must be an Ed25519 PEM key")
    return key


def public_key_id(public_key: Any) -> str:
    crypto = _require_crypto()
    public_bytes = public_key.public_bytes(
        encoding=crypto["serialization"].Encoding.Raw,
        format=crypto["serialization"].PublicFormat.Raw,
    )
    return hashlib.sha256(public_bytes).hexdigest()


def generate_ed25519_keypair(private_key_path: Path, public_key_path: Path, *, force: bool = False) -> dict[str, str]:
    crypto = _require_crypto()
    if (private_key_path.exists() or public_key_path.exists()) and not force:
        raise DistributionError("key output already exists; pass --force to overwrite")
    private_key = crypto["Ed25519PrivateKey"].generate()
    public_key = private_key.public_key()
    private_key_path.parent.mkdir(parents=True, exist_ok=True)
    public_key_path.parent.mkdir(parents=True, exist_ok=True)
    private_key_path.write_bytes(
        private_key.private_bytes(
            encoding=crypto["serialization"].Encoding.PEM,
            format=crypto["serialization"].PrivateFormat.PKCS8,
            encryption_algorithm=crypto["serialization"].NoEncryption(),
        )
    )
    private_key_path.chmod(0o600)
    public_key_path.write_bytes(
        public_key.public_bytes(
            encoding=crypto["serialization"].Encoding.PEM,
            format=crypto["serialization"].PublicFormat.SubjectPublicKeyInfo,
        )
    )
    return {"private_key": str(private_key_path), "public_key": str(public_key_path), "key_id": public_key_id(public_key)}


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


def _release_payload_from_artifacts(
    *,
    archive: Path,
    bundle_manifest: Path,
    bundle: dict[str, Any],
    publisher: str,
) -> dict[str, Any]:
    archive = archive.resolve()
    bundle_manifest = bundle_manifest.resolve()
    if not archive.is_file():
        raise DistributionError(f"release archive does not exist: {archive}")
    if not bundle_manifest.is_file():
        raise DistributionError(f"bundle manifest does not exist: {bundle_manifest}")
    artifact_name = _validate_relative_path(archive.name)
    manifest_name = _validate_relative_path(bundle_manifest.name)
    manifest_digest = _sha256(bundle_manifest)
    return {
        "schema_version": SCHEMA_VERSION,
        "product": "Hermes",
        "version": bundle["version"],
        "platform": bundle["platform"],
        "arch": bundle["arch"],
        "mode": bundle["mode"],
        "publisher": publisher,
        "created_at": dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "artifact": {
            "name": artifact_name,
            "size": archive.stat().st_size,
            "sha256": _sha256(archive),
        },
        "bundle_manifest": {
            "name": manifest_name,
            "size": bundle_manifest.stat().st_size,
            "sha256": manifest_digest,
        },
    }


def sign_release_manifest(
    *,
    archive: Path,
    bundle_manifest: Path,
    private_key: Path,
    out: Path,
    publisher: str,
    force: bool = False,
) -> dict[str, Any]:
    if out.exists() and not force:
        raise DistributionError(f"release manifest already exists: {out}")
    bundle = _load_manifest(bundle_manifest)
    if bundle.get("provenance", {}).get("signed") is True:
        raise DistributionError("bundle manifest must describe payload files, not an already signed release envelope")
    key = _load_private_key(private_key)
    payload = _release_payload_from_artifacts(
        archive=archive,
        bundle_manifest=bundle_manifest,
        bundle=bundle,
        publisher=publisher,
    )
    payload_bytes = _canonical_json_bytes(payload)
    public_key = key.public_key()
    envelope = {
        "schema_version": SCHEMA_VERSION,
        "product": "Hermes",
        "payload": payload,
        "signature": {
            "alg": SIGNATURE_ALGORITHM,
            "key_id": public_key_id(public_key),
            "signed_payload_sha256": hashlib.sha256(payload_bytes).hexdigest(),
            "value": _b64encode(key.sign(payload_bytes)),
        },
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(envelope, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return envelope


def _load_release_envelope(path: Path) -> dict[str, Any]:
    envelope = _read_manifest(path)
    if envelope.get("schema_version") != SCHEMA_VERSION:
        raise DistributionError("unsupported release manifest schema_version")
    if envelope.get("product") != "Hermes":
        raise DistributionError("release manifest product is not Hermes")
    payload = envelope.get("payload")
    signature = envelope.get("signature")
    if not isinstance(payload, dict) or not isinstance(signature, dict):
        raise DistributionError("release manifest must contain payload and signature objects")
    if signature.get("alg") != SIGNATURE_ALGORITHM:
        raise DistributionError("unsupported release signature algorithm")
    return envelope


def _verify_release_identity(payload: dict[str, Any], platform_name: str | None, arch: str | None, version: str | None) -> None:
    for field in ("version", "platform", "arch", "mode", "publisher"):
        if not isinstance(payload.get(field), str) or not payload[field]:
            raise DistributionError(f"release payload field must be a non-empty string: {field}")
    if platform_name and payload["platform"] != platform_name:
        raise DistributionError(f"release platform mismatch: expected {platform_name}, got {payload['platform']}")
    if arch and payload["arch"] != arch:
        raise DistributionError(f"release architecture mismatch: expected {arch}, got {payload['arch']}")
    if version and payload["version"] != version:
        raise DistributionError(f"release version mismatch: expected {version}, got {payload['version']}")


def _verify_release_signature(payload: dict[str, Any], signature: dict[str, Any], public_key: Path) -> str:
    public = _load_public_key(public_key)
    expected_key_id = public_key_id(public)
    if signature.get("key_id") != expected_key_id:
        raise DistributionError("release signature key_id does not match trusted public key")
    payload_bytes = _canonical_json_bytes(payload)
    payload_digest = hashlib.sha256(payload_bytes).hexdigest()
    if signature.get("signed_payload_sha256") != payload_digest:
        raise DistributionError("release payload digest mismatch")
    crypto = _require_crypto()
    try:
        public.verify(_b64decode(signature.get("value"), "signature.value"), payload_bytes)
    except crypto["InvalidSignature"] as exc:
        raise DistributionError("release signature verification failed") from exc
    return expected_key_id


def _verify_release_artifact(payload: dict[str, Any], archive: Path) -> dict[str, Any]:
    artifact = payload.get("artifact")
    if not isinstance(artifact, dict):
        raise DistributionError("release payload artifact must be an object")
    expected_name = _validate_relative_path(artifact.get("name", ""))
    if archive.name != expected_name:
        raise DistributionError(f"release artifact name mismatch: expected {expected_name}, got {archive.name}")
    if not isinstance(artifact.get("size"), int) or artifact["size"] < 0:
        raise DistributionError("release artifact size must be a non-negative integer")
    if artifact["size"] != archive.stat().st_size:
        raise DistributionError("release artifact size mismatch")
    digest = artifact.get("sha256")
    if not isinstance(digest, str) or len(digest) != 64 or any(char not in string.hexdigits for char in digest):
        raise DistributionError("release artifact sha256 is invalid")
    actual_digest = _sha256(archive)
    if actual_digest != digest:
        raise DistributionError("release artifact sha256 mismatch")
    return {"sha256": actual_digest, "size": archive.stat().st_size}


def _verify_release_bundle_manifest_record(payload: dict[str, Any]) -> dict[str, Any]:
    bundle_manifest = payload.get("bundle_manifest")
    if not isinstance(bundle_manifest, dict):
        raise DistributionError("release payload bundle_manifest must be an object")
    name = _validate_relative_path(bundle_manifest.get("name", ""))
    if not isinstance(bundle_manifest.get("size"), int) or bundle_manifest["size"] < 0:
        raise DistributionError("release bundle manifest size must be a non-negative integer")
    digest = bundle_manifest.get("sha256")
    if not isinstance(digest, str) or len(digest) != 64 or any(char not in string.hexdigits for char in digest):
        raise DistributionError("release bundle manifest sha256 is invalid")
    return {"name": name, "size": bundle_manifest["size"], "sha256": digest}


def verify_release_manifest(
    *,
    release_manifest: Path,
    archive: Path,
    public_key: Path,
    platform_name: str | None = None,
    arch: str | None = None,
    version: str | None = None,
) -> dict[str, Any]:
    envelope = _load_release_envelope(release_manifest)
    payload = envelope["payload"]
    signature = envelope["signature"]
    _verify_release_identity(payload, platform_name, arch, version)
    artifact = _verify_release_artifact(payload, archive)
    bundle_manifest = _verify_release_bundle_manifest_record(payload)
    expected_key_id = _verify_release_signature(payload, signature, public_key)
    return {
        "release": payload,
        "signature": {"key_id": expected_key_id, "alg": SIGNATURE_ALGORITHM},
        "artifact": artifact,
        "bundle_manifest": bundle_manifest,
    }


def verify_command(args: argparse.Namespace) -> int:
    try:
        result = verify_root(Path(args.root), Path(args.manifest))
        return _json_result(True, manifest=str(args.manifest), files=result["files"])
    except (DistributionError, OSError) as exc:
        return _fail_exception(exc, json_output=args.json)


def keygen_command(args: argparse.Namespace) -> int:
    try:
        result = generate_ed25519_keypair(Path(args.private_key), Path(args.public_key), force=args.force)
        return _json_result(True, **result)
    except (DistributionError, OSError) as exc:
        return _fail_exception(exc, json_output=args.json)


def sign_release_command(args: argparse.Namespace) -> int:
    try:
        result = sign_release_manifest(
            archive=Path(args.archive),
            bundle_manifest=Path(args.manifest),
            private_key=Path(args.private_key),
            out=Path(args.out),
            publisher=args.publisher,
            force=args.force,
        )
        return _json_result(
            True,
            release_manifest=str(args.out),
            artifact=result["payload"]["artifact"],
            signature={key: result["signature"][key] for key in ("alg", "key_id", "signed_payload_sha256")},
        )
    except (DistributionError, OSError) as exc:
        return _fail_exception(exc, json_output=args.json)


def verify_release_command(args: argparse.Namespace) -> int:
    try:
        result = verify_release_manifest(
            release_manifest=Path(args.release_manifest),
            archive=Path(args.archive),
            public_key=Path(args.public_key),
            platform_name=args.platform,
            arch=args.arch,
            version=args.version,
        )
        return _json_result(True, **result)
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


def _copy_signed_release_input(source: Path, target_dir: Path, label: str) -> Path:
    source = source.expanduser()
    if source.is_symlink():
        raise DistributionError(f"{label} must not be a symlink: {source}")
    if not source.is_file():
        raise DistributionError(f"{label} does not exist: {source}")
    label_dir = target_dir / label.replace(" ", "-")
    label_dir.mkdir(mode=0o700)
    target = label_dir / _validate_relative_path(source.name)
    shutil.copy2(source, target, follow_symlinks=False)
    if target.is_symlink() or not target.is_file():
        raise DistributionError(f"{label} copy is not a regular file")
    target.chmod(0o400)
    return target


def _prepare_signed_release_inputs(
    *,
    archive: Path,
    release_manifest: Path,
    public_key: Path,
    parent: Path,
) -> tuple[Path, Path, Path, Path]:
    private_root = Path(tempfile.mkdtemp(prefix=".hermes.release-", dir=str(parent)))
    private_root.chmod(0o700)
    try:
        copied_archive = _copy_signed_release_input(archive, private_root, "release archive")
        copied_manifest = _copy_signed_release_input(release_manifest, private_root, "release manifest")
        copied_public_key = _copy_signed_release_input(public_key, private_root, "public key")
    except BaseException:
        shutil.rmtree(private_root, ignore_errors=True)
        raise
    return private_root, copied_archive, copied_manifest, copied_public_key


def _verify_extracted_signed_bundle(
    *,
    root: Path,
    manifest_name: str,
    release: dict[str, Any],
) -> dict[str, Any]:
    manifest_path = root / manifest_name
    bundle_record = _verify_release_bundle_manifest_record(release)
    if manifest_name != bundle_record["name"]:
        raise DistributionError(
            f"release bundle manifest name mismatch: expected {bundle_record['name']}, got {manifest_name}"
        )
    if not manifest_path.is_file() or manifest_path.is_symlink():
        raise DistributionError(f"signed bundle manifest is missing: {manifest_name}")
    if manifest_path.stat().st_size != bundle_record["size"]:
        raise DistributionError("signed bundle manifest size mismatch")
    if _sha256(manifest_path) != bundle_record["sha256"]:
        raise DistributionError("signed bundle manifest sha256 mismatch")
    result = verify_root(root, manifest_path)
    manifest = result["manifest"]
    for field in ("version", "platform", "arch", "mode"):
        if manifest[field] != release[field]:
            raise DistributionError(f"archive bundle manifest {field} does not match signed release manifest")
    return result


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


def _install_to_reserved_dest(
    *,
    archive: Path,
    dest: Path,
    manifest_name: str,
    release: dict[str, Any] | None = None,
) -> dict[str, Any]:
    temp_root = dest / f".staging-{uuid.uuid4().hex}"
    temp_root.mkdir(mode=0o700)
    try:
        _extract_archive(archive, temp_root)
        result = (
            _verify_extracted_signed_bundle(root=temp_root, manifest_name=manifest_name, release=release)
            if release is not None
            else verify_root(temp_root, temp_root / manifest_name)
        )
        unexpected = [item for item in dest.iterdir() if item != temp_root]
        if unexpected:
            raise DistributionError("destination changed during install; refusing to publish")
        for child in sorted(temp_root.iterdir(), key=lambda item: item.name):
            child.rename(dest / child.name)
        temp_root.rmdir()
        return result
    except BaseException:
        shutil.rmtree(temp_root, ignore_errors=True)
        raise


def _parse_semver(value: str) -> tuple[int, int, int]:
    version = value[1:] if value.startswith(("v", "V")) else value
    parts = version.split(".")
    if len(parts) != 3 or any(not part.isdigit() for part in parts):
        raise DistributionError(f"release version is not a supported semantic version: {value}")
    return int(parts[0]), int(parts[1]), int(parts[2])


def _assert_update_version_allowed(current_version: str, next_version: str, *, allow_same_version: bool) -> None:
    current = _parse_semver(current_version)
    next_release = _parse_semver(next_version)
    if next_release < current:
        raise DistributionError(f"release version downgrade is not allowed: {current_version} -> {next_version}")
    if next_release == current and not allow_same_version:
        raise DistributionError("release version is already installed; pass --allow-same-version for repair reinstall")


def _restore_backup_after_failed_promotion(*, backup: Path | None, dest: Path) -> None:
    if backup is None or not backup.exists():
        return
    if not dest.exists() and not dest.is_symlink():
        backup.rename(dest)
        return
    failed = dest.parent / f".{dest.name}.failed-promotion-{uuid.uuid4().hex}"
    dest.rename(failed)
    try:
        backup.rename(dest)
    finally:
        if failed.exists() or failed.is_symlink():
            if failed.is_dir() and not failed.is_symlink():
                shutil.rmtree(failed, ignore_errors=True)
            else:
                failed.unlink(missing_ok=True)


def signed_install_command(args: argparse.Namespace) -> int:
    reserved_dest = False
    private_root: Path | None = None
    try:
        manifest_name = _validate_relative_path(args.manifest_name)
        dest = Path(args.dest).expanduser()
        if dest.exists() or dest.is_symlink():
            raise DistributionError(f"destination already exists: {dest}")
        if not dest.parent.is_dir():
            raise DistributionError(f"destination parent does not exist: {dest.parent}")
        private_root, archive, release_manifest, public_key = _prepare_signed_release_inputs(
            archive=Path(args.archive),
            release_manifest=Path(args.release_manifest),
            public_key=Path(args.public_key),
            parent=dest.parent,
        )
        verified = verify_release_manifest(
            release_manifest=release_manifest,
            archive=archive,
            public_key=public_key,
            platform_name=args.platform,
            arch=args.arch,
            version=args.version,
        )
        dest.mkdir(mode=0o755)
        reserved_dest = True
        installed = _install_to_reserved_dest(
            archive=archive,
            dest=dest,
            manifest_name=manifest_name,
            release=verified["release"],
        )
        installed = verify_root(dest, dest / manifest_name)
        return _json_result(
            True,
            destination=str(dest),
            manifest=str(dest / manifest_name),
            release=verified["release"],
            files=installed["files"],
        )
    except (DistributionError, OSError, tarfile.TarError) as exc:
        if reserved_dest:
            shutil.rmtree(dest, ignore_errors=True)
        return _fail_exception(exc, json_output=args.json)
    finally:
        if private_root is not None:
            shutil.rmtree(private_root, ignore_errors=True)


def signed_update_command(args: argparse.Namespace) -> int:
    backup: Path | None = None
    dest: Path | None = None
    private_root: Path | None = None
    staging: Path | None = None
    try:
        manifest_name = _validate_relative_path(args.manifest_name)
        dest = Path(args.dest).expanduser()
        if dest.is_symlink() or not dest.is_dir():
            raise DistributionError(f"existing install root is required for update: {dest}")
        old_manifest = dest / manifest_name
        if not old_manifest.is_file():
            raise DistributionError(f"existing install manifest is required for update: {old_manifest}")
        current = verify_root(dest, old_manifest)
        parent = dest.parent
        private_root, archive, release_manifest, public_key = _prepare_signed_release_inputs(
            archive=Path(args.archive),
            release_manifest=Path(args.release_manifest),
            public_key=Path(args.public_key),
            parent=parent,
        )
        verified = verify_release_manifest(
            release_manifest=release_manifest,
            archive=archive,
            public_key=public_key,
            platform_name=args.platform,
            arch=args.arch,
            version=args.version,
        )
        _assert_update_version_allowed(
            current["manifest"]["version"],
            verified["release"]["version"],
            allow_same_version=args.allow_same_version,
        )
        staging = parent / f".{dest.name}.staging-{uuid.uuid4().hex}"
        backup = parent / f".{dest.name}.backup-{uuid.uuid4().hex}"
        staging.mkdir(mode=0o700)
        _extract_archive(archive, staging)
        next_root = _verify_extracted_signed_bundle(
            root=staging,
            manifest_name=manifest_name,
            release=verified["release"],
        )
        dest.rename(backup)
        try:
            staging.rename(dest)
        except BaseException:
            backup.rename(dest)
            raise
        verify_root(dest, dest / manifest_name)
        if args.keep_backup:
            backup_result = str(backup)
        else:
            shutil.rmtree(backup)
            backup_result = ""
        return _json_result(
            True,
            destination=str(dest),
            backup=backup_result,
            release=verified["release"],
            files=next_root["files"],
        )
    except (DistributionError, OSError, tarfile.TarError) as exc:
        if staging is not None and staging.exists():
            shutil.rmtree(staging, ignore_errors=True)
        if dest is not None:
            try:
                _restore_backup_after_failed_promotion(backup=backup, dest=dest)
            except OSError:
                pass
        return _fail_exception(exc, json_output=args.json)
    finally:
        if private_root is not None:
            shutil.rmtree(private_root, ignore_errors=True)


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

    keygen = sub.add_parser("keygen", help="generate an Ed25519 keypair for local cryptographic release tests")
    keygen.add_argument("--private-key", required=True)
    keygen.add_argument("--public-key", required=True)
    keygen.add_argument("--force", action="store_true")
    keygen.add_argument("--json", action="store_true", default=True)
    keygen.set_defaults(func=keygen_command)

    verify = sub.add_parser("verify", help="verify a staged or installed root against a manifest")
    verify.add_argument("--root", required=True)
    verify.add_argument("--manifest", required=True)
    verify.add_argument("--json", action="store_true", default=True)
    verify.set_defaults(func=verify_command)

    sign_release = sub.add_parser("sign-release", help="write a signed release manifest for an archive")
    sign_release.add_argument("--archive", required=True)
    sign_release.add_argument("--manifest", required=True, help="bundle hermes-manifest.json")
    sign_release.add_argument("--private-key", required=True, help="Ed25519 PEM private key path")
    sign_release.add_argument("--out", required=True, help="release manifest output path")
    sign_release.add_argument("--publisher", required=True)
    sign_release.add_argument("--force", action="store_true")
    sign_release.add_argument("--json", action="store_true", default=True)
    sign_release.set_defaults(func=sign_release_command)

    verify_release = sub.add_parser("verify-release", help="verify a signed release manifest and archive")
    verify_release.add_argument("--release-manifest", required=True)
    verify_release.add_argument("--archive", required=True)
    verify_release.add_argument("--public-key", required=True, help="trusted Ed25519 PEM public key path")
    verify_release.add_argument("--platform")
    verify_release.add_argument("--arch")
    verify_release.add_argument("--version")
    verify_release.add_argument("--json", action="store_true", default=True)
    verify_release.set_defaults(func=verify_release_command)

    install = sub.add_parser("install", help="transactionally install an archive or staged root to a new destination")
    source = install.add_mutually_exclusive_group(required=True)
    source.add_argument("--archive", help="portable tar archive")
    source.add_argument("--source", help="staged root directory, mainly for local verification")
    install.add_argument("--dest", required=True, help="new destination path; must not already exist")
    install.add_argument("--manifest-name", default=MANIFEST_NAME)
    install.add_argument("--json", action="store_true", default=True)
    install.set_defaults(func=install_command)

    signed_install = sub.add_parser("signed-install", help="verify a signed release and install to a new destination")
    signed_install.add_argument("--archive", required=True)
    signed_install.add_argument("--release-manifest", required=True)
    signed_install.add_argument("--public-key", required=True)
    signed_install.add_argument("--dest", required=True)
    signed_install.add_argument("--manifest-name", default=MANIFEST_NAME)
    signed_install.add_argument("--platform")
    signed_install.add_argument("--arch")
    signed_install.add_argument("--version")
    signed_install.add_argument("--json", action="store_true", default=True)
    signed_install.set_defaults(func=signed_install_command)

    signed_update = sub.add_parser("signed-update", help="verify a signed release and replace an existing install with rollback")
    signed_update.add_argument("--archive", required=True)
    signed_update.add_argument("--release-manifest", required=True)
    signed_update.add_argument("--public-key", required=True)
    signed_update.add_argument("--dest", required=True)
    signed_update.add_argument("--manifest-name", default=MANIFEST_NAME)
    signed_update.add_argument("--platform")
    signed_update.add_argument("--arch")
    signed_update.add_argument("--version")
    signed_update.add_argument("--allow-same-version", action="store_true")
    signed_update.add_argument("--keep-backup", action="store_true")
    signed_update.add_argument("--json", action="store_true", default=True)
    signed_update.set_defaults(func=signed_update_command)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
