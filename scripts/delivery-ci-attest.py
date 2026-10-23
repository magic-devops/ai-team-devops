#!/usr/bin/env python3
"""Build a clean checkout and sign its fresh artifact and real JUnit results.

Install sop-manager first. The caller obtains --scope-basis from the Manager's
explicit quality scope before running this producer. No Manager URL or command
is fetched or executed by the web application. Private keys stay in CI files.
"""

# ruff: noqa: S603,S607 - explicit local CI argv and fixed Git metadata commands; no shell or web input.

import argparse
import base64
import hashlib
import json
import os
import stat
import subprocess
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import HTTPException
from pydantic import ValidationError
from sop_manager.routers.delivery_ci import pae, policy_value, strict_json, verify_envelope
from sop_manager.routers.delivery_ci_contract import PAYLOAD_TYPE, PREDICATE_TYPE, STATEMENT_TYPE, CiStatement
from sop_manager.routers.delivery_release_sources_contract import ReleaseSourcePacket
from sop_manager.routers.delivery_release_sources import source_packet_digest
from sop_manager.routers.delivery_ci_source_tree import SourceTreeError, verify_source_tree, require_complete_checkout, _git as _source_git, _batches as _source_batches


class ProducerError(Exception):
    pass


def _git(root, *args):
    try:
        return _source_git(root, *args, limit=8 * 1024 * 1024)
    except SourceTreeError as exc:
        raise ProducerError("Git inspection is unavailable") from exc


def _project_path(root, value, *, directory=False):
    raw = Path(value)
    raw = raw if raw.is_absolute() else root / raw
    # Reject every existing symlink component before resolving; never follow a
    # build output link into another project or a credential destination.
    for candidate in (raw, *raw.parents):
        if candidate.is_symlink() or (hasattr(candidate, "is_junction") and candidate.is_junction()):
            raise ProducerError("Checkout paths cannot contain symbolic links or junctions")
    resolved = raw.resolve()
    if not resolved.is_relative_to(root) or resolved == root / ".git" or (root / ".git") in resolved.parents:
        raise ProducerError("Build working directory and outputs must stay inside the checkout")
    if directory and not resolved.is_dir():
        raise ProducerError("Build working directory does not exist")
    return resolved


def _read_file(path, *, limit=None, private=False):
    if path.is_symlink():
        raise ProducerError("Evidence and signing key files must be regular files")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
    try:
        descriptor = os.open(path, flags)
        with os.fdopen(descriptor, "rb") as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
                raise ProducerError("Evidence and signing key files must be regular unlinked files")
            if private and os.name != "nt" and stat.S_IMODE(before.st_mode) & 0o077:
                raise ProducerError("Signing key file permissions must be 0600 or stricter")
            if limit is not None and before.st_size > limit:
                raise ProducerError("Evidence or signing key file exceeds its size limit")
            value = stream.read() if limit is None else stream.read(limit + 1)
            after = os.fstat(stream.fileno())
            if (before.st_ino, before.st_dev, before.st_size, before.st_mtime_ns) != (
                after.st_ino,
                after.st_dev,
                after.st_size,
                after.st_mtime_ns,
            ):
                raise ProducerError("Evidence changed while being read")
            if limit is not None and len(value) > limit:
                raise ProducerError("Evidence exceeds its size limit")
            return value
    except OSError as exc:
        raise ProducerError("A required evidence or signing key file is unavailable") from exc


def _artifact_digest(path):
    if path.is_symlink():
        raise ProducerError("The artifact must be a new regular file")
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0))
        with os.fdopen(descriptor, "rb") as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
                raise ProducerError("The artifact must be a new regular file")
            digest = hashlib.sha256()
            while block := stream.read(1024 * 1024):
                digest.update(block)
            after = os.fstat(stream.fileno())
            if (before.st_ino, before.st_dev, before.st_size, before.st_mtime_ns) != (
                after.st_ino,
                after.st_dev,
                after.st_size,
                after.st_mtime_ns,
            ):
                raise ProducerError("The artifact changed while being hashed")
            return digest.hexdigest()
    except OSError as exc:
        raise ProducerError("The build did not produce the declared artifact") from exc


def _source_snapshot(root, allowed_outputs=()):
    require_complete_checkout(root)
    if Path(os.fsdecode(_git(root, "rev-parse", "--show-toplevel")).strip()).resolve() != root:
        raise ProducerError("Every submodule must have its own initialized complete checkout")
    head = _git(root, "rev-parse", "--verify", "HEAD").decode("ascii").strip()
    # A clean status cannot establish committed input when these flags hide
    # existing edits. Reject them in every checkout, including submodules.
    # Hash working bytes separately so Git's normal CRLF conversion is valid.
    result = {"head": head, "files": {}}
    entries = [entry for entry in _git(root, "ls-files", "-v", "--stage", "-z").split(b"\0") if entry]
    paths = [os.fsdecode(entry.split(b"\t", 1)[1]) for entry in entries]
    for batch in _source_batches(paths):
        # Custom checkout filters can hide changed working bytes behind a clean
        # status. CRLF/text normalization remains supported; opaque transforms do not.
        values = _git(root, "check-attr", "-z", "filter", "working-tree-encoding", "ident", "--", *batch).split(b"\0")
        if values[-1:] != [b""] or (len(values) - 1) % 3:
            raise ProducerError("Source attribute inspection is incomplete")
        if any(value not in {b"unspecified", b"unset"} for value in values[2:-1:3]):
            raise ProducerError("Controlled source cannot use custom checkout filters, encoding or ident transforms")
    for entry in entries:
        if not entry:
            continue
        metadata, encoded_path = entry.split(b"\t", 1)
        tag, mode, object_id, stage = metadata.decode("ascii").split()
        if tag == "S" or tag.islower():
            raise ProducerError("Controlled source cannot use assume-unchanged or skip-worktree index flags")
        if stage != "0":
            raise ProducerError("Resolve source merge conflicts before producing CI evidence")
        relative = os.fsdecode(encoded_path)
        path = _project_path(root, relative)
        if mode == "160000":
            value = _source_snapshot(path)
        elif mode in {"100644", "100755"}:
            value = _artifact_digest(path)
        else:
            raise ProducerError("Controlled source cannot contain symbolic-link entries")
        result["files"][relative] = [mode, object_id, value]
    untracked = [
        root / os.fsdecode(value)
        for value in _git(root, "ls-files", "--others", "--exclude-standard", "-z").split(b"\0")
        if value
    ]
    if any(path not in allowed_outputs for path in untracked):
        raise ProducerError("Untracked source must be committed or removed before producing evidence")
    return result


def _commands(value):
    try:
        argv = strict_json(value)
    except HTTPException as exc:
        raise ProducerError("Build and test commands must be JSON argv arrays") from exc
    if (
        not isinstance(argv, list)
        or not 1 <= len(argv) <= 128
        or any(not isinstance(part, str) or not part or len(part) > 8192 or "\0" in part for part in argv)
    ):
        raise ProducerError("Build and test commands must be nonempty JSON argv arrays")
    return argv


def _run(argv, cwd, timeout):
    try:
        result = subprocess.run(
            argv,
            cwd=cwd,
            shell=False,
            stdout=subprocess.DEVNULL,  # noqa: S603 - explicit local CI argv; never web input
            stderr=subprocess.DEVNULL,
            timeout=timeout,
            check=False,
        )
        return result.returncode
    except subprocess.TimeoutExpired:
        return 124
    except OSError as exc:
        raise ProducerError("A configured build or test executable is unavailable") from exc


class _JUnitTree(ET.TreeBuilder):
    def doctype(self, name, pubid, system):
        raise ProducerError("JUnit reports cannot contain a DTD")


def _junit(path):
    raw = _read_file(path, limit=8 * 1024 * 1024)
    if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise ProducerError("JUnit XML declarations cannot contain DTDs or entities")
    try:
        document = ET.fromstring(raw, parser=ET.XMLParser(target=_JUnitTree()))  # noqa: S314 - bounded input and parser-level DTD rejection in every encoding
        if document.tag not in {"testsuite", "testsuites"}:
            raise ValueError("Not a JUnit document")

        def count(node):
            counts = {"total": 0, "failed": 0, "errors": 0, "skipped": 0}
            for case in node.iter("testcase"):
                counts["total"] += 1
                outcomes = [
                    key
                    for tag, key in (("failure", "failed"), ("error", "errors"), ("skipped", "skipped"))
                    if case.find(tag) is not None
                ]
                if len(outcomes) > 1:
                    raise ValueError("A test case has incompatible outcomes")
                if outcomes:
                    counts[outcomes[0]] += 1
            return counts

        for suite in document.iter():
            if suite.tag not in {"testsuite", "testsuites"}:
                continue
            counts = count(suite)
            for attribute, key in (
                ("tests", "total"),
                ("failures", "failed"),
                ("errors", "errors"),
                ("skipped", "skipped"),
            ):
                if attribute in suite.attrib and (
                    not suite.attrib[attribute].isdigit() or int(suite.attrib[attribute]) != counts[key]
                ):
                    raise ValueError("JUnit aggregate does not match its actual cases")
        return count(document)
    except (ET.ParseError, ValueError, OverflowError, RecursionError) as exc:
        raise ProducerError("JUnit report must contain actual consistent test cases") from exc


def attest(args):
    root = Path(args.repo).resolve()
    top = Path(os.fsdecode(_git(root, "rev-parse", "--show-toplevel")).strip()).resolve()
    if top != root:
        raise ProducerError("Select the checkout root explicitly")
    require_complete_checkout(root)
    cwd = _project_path(root, args.cwd, directory=True)
    paths = [_project_path(root, value) for value in (args.artifact, args.junit, args.out)]
    if len(set(paths)) != len(paths) or any(path.exists() or path.is_symlink() for path in paths):
        raise ProducerError("Artifact, JUnit report and output must be distinct new paths")
    artifact, report, output = paths
    build_command, test_command = _commands(args.build_command), _commands(args.test_command)
    before = _source_snapshot(root)
    if _git(root, "status", "--porcelain=v1", "--untracked-files=normal", "--ignore-submodules=none").strip():
        raise ProducerError("The checkout must have clean controlled source")
    packet_path = Path(args.source_packet)
    packet_raw = _read_file(packet_path, limit=1048576)
    packet = ReleaseSourcePacket.model_validate(strict_json(packet_raw.decode("utf-8"))).model_dump(mode="json")
    for key, expected in (("tenant_id", args.tenant_id), ("project_id", args.project_id),
            ("repository", args.repository), ("workflow", args.workflow),
            ("policy_generation", args.policy_generation), ("scope_basis", args.scope_basis)):
        if packet[key] != expected:
            raise ProducerError("The fixed source packet does not match this CI scope and policy")
    source_trace = {"packet_digest": source_packet_digest(packet), **verify_source_tree(root, packet, before["head"])}
    key_bytes = _read_file(Path(args.private_key), limit=16384, private=True)
    try:
        key = (
            Ed25519PrivateKey.from_private_bytes(key_bytes)
            if len(key_bytes) == 32
            else serialization.load_pem_private_key(key_bytes, password=None)
        )
        if not isinstance(key, Ed25519PrivateKey):
            raise ValueError("Wrong algorithm")
    except (ValueError, TypeError) as exc:
        raise ProducerError("Signing key file must contain an unencrypted Ed25519 key") from exc
    public = base64.b64encode(key.public_key().public_bytes_raw()).decode("ascii")
    policy = policy_value(
        {"repository": args.repository, "workflow": args.workflow, "public_keys": [public]},
        args.policy_generation,
    )
    build_exit = _run(build_command, cwd, args.timeout_seconds)
    test_exit = _run(test_command, cwd, args.timeout_seconds)
    # Recheck paths after the subprocesses: newly created symlinks cannot change
    # the meaning of any evidence path that was fixed before execution.
    for value in (args.artifact, args.junit, args.out):
        _project_path(root, value)
    tests = _junit(report)
    artifact_sha256 = _artifact_digest(artifact)
    if before != _source_snapshot(root, allowed_outputs=paths):
        raise ProducerError("HEAD, index or controlled source changed during build or tests")
    if packet_raw != _read_file(packet_path, limit=1048576):
        raise ProducerError("The fixed source packet changed during build or tests")
    statement = {
        "_type": STATEMENT_TYPE,
        "subject": [{"name": args.subject_name or artifact.name, "digest": {"sha256": artifact_sha256}}],
        "predicateType": PREDICATE_TYPE,
        "predicate": {
            "tenant_id": args.tenant_id,
            "project_id": args.project_id,
            "policy_generation": args.policy_generation,
            "repository": args.repository,
            "workflow": args.workflow,
            "commit_sha": before["head"],
            "run_uri": args.run_uri,
            "run_number": args.run_number,
            "run_attempt": args.run_attempt,
            "scope_basis": args.scope_basis,
            "source_trace": source_trace,
            "build_result": "passed" if build_exit == test_exit == 0 else "failed",
            "tests": tests,
            "finished_at": datetime.now(timezone.utc).isoformat(),
        },
    }
    statement = CiStatement.model_validate(statement).model_dump(by_alias=True)
    payload = json.dumps(statement, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    envelope = {
        "payloadType": PAYLOAD_TYPE,
        "payload": base64.b64encode(payload).decode("ascii"),
        "signatures": [
            {
                "keyid": policy["keys"][0]["key_id"],
                "sig": base64.b64encode(key.sign(pae(PAYLOAD_TYPE, payload))).decode("ascii"),
            }
        ],
    }
    text = json.dumps(envelope, separators=(",", ":"))
    verified = verify_envelope(
        text, policy, tenant_id=args.tenant_id, project_id=args.project_id, scope_basis=args.scope_basis
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    receipt = {"envelope": text, "source_packet": packet,
        "requirement_ids": packet["requirement_ids"], "task_ids": packet["task_ids"]}
    with output.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(receipt, ensure_ascii=False, separators=(",", ":")) + "\n")
    return verified["passed"]


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--repo", required=True)
    result.add_argument("--cwd", required=True)
    result.add_argument(
        "--private-key", required=True, help="Ed25519 PEM or 32-byte seed FILE; never key text"
    )
    for name in (
        "artifact",
        "junit",
        "out",
        "repository",
        "workflow",
        "tenant-id",
        "project-id",
        "run-uri",
        "scope-basis",
        "source-packet",
        "build-command",
        "test-command",
    ):
        result.add_argument("--" + name, required=True)
    for name in ("policy-generation", "run-number", "run-attempt"):
        result.add_argument("--" + name, required=True, type=int)
    result.add_argument("--subject-name", default="")
    result.add_argument("--timeout-seconds", type=int, default=900)
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    if not 1 <= args.timeout_seconds <= 7200:
        print("CI evidence error: timeout must be between 1 and 7200 seconds", file=sys.stderr)
        return 2
    try:
        passed = attest(args)
    except (ProducerError, SourceTreeError) as exc:
        # These producer-owned messages contain no user paths, child output,
        # command text or key material; they explain the actionable refusal.
        print("CI evidence error: " + str(exc), file=sys.stderr)
        return 2
    except (HTTPException, ValidationError, OSError, UnicodeError, ValueError):
        # Do not print command text, captured child output, private material or
        # crypto/parser diagnostics. The producer's inputs remain local to CI.
        print(
            "CI evidence error: controlled source, commands, signing key or fresh evidence validation failed",
            file=sys.stderr,
        )
        return 2
    print("Signed CI evidence written; checks " + ("passed" if passed else "did not pass"))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
