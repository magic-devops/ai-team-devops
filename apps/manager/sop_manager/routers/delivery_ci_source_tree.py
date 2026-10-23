"""Bounded local Git tree checks for a fixed source packet; no fetch or shell."""
import hashlib
import json
import os
import subprocess
import threading
import time


class SourceTreeError(ValueError):
    pass


def _git(root, *args, limit=4 * 1024 * 1024, accepted_codes=(0,), deadline=None):
    remaining = 30 if deadline is None else min(30, deadline - time.monotonic())
    if remaining <= 0:
        raise SourceTreeError("Source inspection exceeded its total time budget")
    env = {key: value for key, value in os.environ.items() if not key.upper().startswith("GIT_")}
    env["GIT_GRAFT_FILE"] = os.devnull
    env["GIT_NO_LAZY_FETCH"] = "1"
    env["GIT_TERMINAL_PROMPT"] = "0"
    try:
        with subprocess.Popen(["git", "--no-optional-locks", "--no-replace-objects", "--literal-pathspecs",
                "-c", "core.hooksPath=" + os.devnull, "-c", "core.fsmonitor=false", *args],
                cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as child:
            def stop():
                try:
                    if child.poll() is None:
                        child.kill()
                except ProcessLookupError:
                    pass
            timer = threading.Timer(remaining, stop)
            timer.daemon = True
            timer.start()
            try:
                raw = child.stdout.read(limit + 1)
                if len(raw) > limit:
                    raise SourceTreeError("Source inspection exceeds its metadata budget")
                if child.wait(timeout=5) not in accepted_codes:
                    raise SourceTreeError("Use complete local commit history with the accepted changes included")
                return raw
            finally:
                timer.cancel()
                stop()
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise SourceTreeError("Local Git source inspection is unavailable") from exc


def _batches(paths):
    batch, size = [], 0
    for path in paths:
        length = len(path.encode("utf-8"))
        if batch and size + length > 16000:
            yield batch
            batch, size = [], 0
        batch.append(path)
        size += length + 1
    if batch:
        yield batch


def _entries(root, commit, paths, *, deadline=None):
    entries = {}
    for batch in _batches(paths):
        raw = _git(root, "ls-tree", "-z", "--full-tree", commit, "--", *batch, deadline=deadline)
        for item in raw.split(b"\0"):
            if not item:
                continue
            try:
                metadata, name = item.split(b"\t", 1)
                mode, kind, object_id = metadata.decode("ascii").split(" ")
                path = name.decode("utf-8")
            except (ValueError, UnicodeError) as exc:
                raise SourceTreeError("Unsupported Git tree metadata") from exc
            if path not in batch or path in entries:
                raise SourceTreeError("Git did not return exact source paths")
            if (mode, kind) not in {("100644", "blob"), ("100755", "blob"), ("040000", "tree")}:
                raise SourceTreeError("Source ranges containing links or submodule changes are unsupported")
            entries[path] = [mode, kind, object_id]
    return entries


def require_complete_checkout(root, *, deadline=None):
    if _git(root, "rev-parse", "--is-shallow-repository", limit=64, deadline=deadline).strip() != b"false":
        raise SourceTreeError("A complete checkout is required for source verification")
    partial = _git(root, "config", "--name-only", "--get-regexp",
        r"^(extensions\.partialclone|remote\..*\.promisor)$", limit=65536, accepted_codes=(0, 1), deadline=deadline)
    if partial.strip():
        raise SourceTreeError("Partial clones are unsupported; source checks never fetch missing objects")


def verify_source_tree(root, packet, head):
    """Ancestry plus exact accepted tree entries detects later changes/reverts."""
    deadline = time.monotonic() + 120
    require_complete_checkout(root, deadline=deadline)
    if _git(root, "rev-parse", "HEAD", limit=128, deadline=deadline).decode("ascii").strip() != head:
        raise SourceTreeError("Build HEAD changed before source verification")
    trees, count, ranges = [], 0, {}
    for binding in packet["bindings"]:
        if binding["kind"] == "no_code_change":
            trees.append({"task_id": binding["task_id"], "kind": "no_code_change"})
            continue
        base, accepted = binding["base_commit"], binding["accepted_commit"]
        if (base, accepted) in ranges:
            paths = ranges[(base, accepted)]
            count += len(paths)
            if count > 10000:
                raise SourceTreeError("Source associations exceed 10000 inspected paths")
            trees.append({"task_id": binding["task_id"], "base_commit": base, "accepted_commit": accepted, "paths": paths})
            continue
        for commit in (base, accepted):
            if _git(root, "cat-file", "-t", commit, limit=64, deadline=deadline).strip() != b"commit":
                raise SourceTreeError("Source associations require full commit objects")
        _git(root, "merge-base", "--is-ancestor", base, accepted, limit=64, deadline=deadline)
        _git(root, "merge-base", "--is-ancestor", accepted, head, limit=64, deadline=deadline)
        raw = _git(root, "diff", "--no-ext-diff", "--no-textconv", "--ignore-submodules=none", "--no-renames", "--name-only", "-z", base, accepted, "--", deadline=deadline)
        try:
            if not raw.endswith(b"\0"):
                raise SourceTreeError("A code range must contain actual net changes")
            paths = sorted({value.decode("utf-8") for value in raw[:-1].split(b"\0")})
        except UnicodeError as exc:
            raise SourceTreeError("Source paths must be UTF-8") from exc
        if not paths or any(not path or len(path.encode("utf-8")) > 4000 for path in paths):
            raise SourceTreeError("Code ranges require bounded nonempty paths")
        count += len(paths)
        if count > 10000:
            raise SourceTreeError("Source associations exceed 10000 inspected paths")
        # Deleting/replacing a link or gitlink is unsupported too; do not inspect
        # only the accepted side and silently omit its original dependency.
        _entries(root, base, paths, deadline=deadline)
        expected, actual = _entries(root, accepted, paths, deadline=deadline), _entries(root, head, paths, deadline=deadline)
        if expected != actual:
            raise SourceTreeError("Accepted code was modified or removed after acceptance; explicitly review a new association")
        ranges[(base, accepted)] = [[path, expected.get(path)] for path in paths]
        trees.append({"task_id": binding["task_id"], "base_commit": base, "accepted_commit": accepted,
            "paths": ranges[(base, accepted)]})
    digest = hashlib.sha256(json.dumps(trees, ensure_ascii=False, sort_keys=True,
        separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()
    return {"verified_bindings": len(packet["bindings"]), "checked_paths": count, "tree_digest": digest}
