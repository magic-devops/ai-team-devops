from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

from .models import CoreError, Node
from .transactional import digest, now


class Repository:
    def __init__(self, execution):
        self.execution = execution

    def inspect(self, root: str, workspace: str) -> dict:
        path = Path(root).resolve()
        self.execution.validate_root(path)
        top = self._read(root, ["rev-parse", "--show-toplevel"]).strip()
        if Path(top).resolve() != path:
            raise CoreError("repository_root_required", "Workspace must be the Git repository root", 422)
        head = self._read(root, ["rev-parse", "--verify", "HEAD"]).strip()
        if not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", head):
            raise CoreError("invalid_commit", "Repository has no valid HEAD commit", 422)
        return {
            "id": workspace,
            "root": str(path),
            "head_commit": head,
            "branch": self._read(root, ["rev-parse", "--abbrev-ref", "HEAD"]).strip(),
            "dirty": bool(self._read(root, ["status", "--porcelain=v1", "-z", "--untracked-files=normal"])),
        }

    @staticmethod
    def argv(args: list[str]) -> list[str]:
        return [
            "git",
            "--no-optional-locks",
            "-c",
            f"core.hooksPath={os.devnull}",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.quotePath=false",
            *args,
        ]

    def _read(self, root: str, args: list[str]) -> str:
        if not self.execution.available():
            raise CoreError("executor_unavailable", "Git inspection requires the local executor", 503)
        env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
        try:
            proc = subprocess.run(  # noqa: S603 - configured executor, fixed Git metadata argv, no shell
                [self.execution.agentd, "run-tool", "--root", root],
                input=json.dumps({"argv": self.argv(args), "timeout_seconds": 20}),
                text=True,
                capture_output=True,
                timeout=25,
                env=env,
            )
            result = json.loads(proc.stdout)
        except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
            raise CoreError("repository_unavailable", "Git inspection failed or timed out", 503) from exc
        if result.get("exit_code") != 0 or result.get("error"):
            raise CoreError(
                "repository_unavailable",
                str(result.get("stderr") or result.get("error") or "Git repository unavailable")[:1000],
                422,
            )
        output = str(result.get("stdout", ""))
        if output.endswith("\n[truncated]"):
            raise CoreError("repository_too_large", "Git metadata exceeds the inspection limit", 422)
        return output

    def validate_base(self, root: str, commit: str):
        if not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", commit):
            raise CoreError("base_commit_required", "Select an explicit Git commit before dispatch", 422)
        self.inspect(root, "")
        if self._read(root, ["rev-parse", "--verify", commit + "^{commit}"]).strip() != commit:
            raise CoreError("invalid_commit", "The selected commit is unavailable", 422)

    def _tool(self, principal, workspace, run_id, root, owner, args, *, allow_truncated=False):
        result = self.execution.atomic_tool(
            principal,
            workspace,
            run_id,
            Node(id="git_evidence", argv=self.argv(args), timeout_seconds=60),
            root,
            owner,
        )
        if not result.get("succeeded"):
            raise CoreError(
                "git_operation_failed",
                str(result.get("stderr") or result.get("error") or "Git operation failed")[:1000],
                409,
            )
        output = str(result.get("stdout", ""))
        if not allow_truncated and output.endswith("\n[truncated]"):
            raise CoreError("repository_too_large", "Git metadata exceeds the evidence limit", 409)
        return output

    def prepare(self, principal, workspace, run, owner) -> str:
        source = run["data"]["workspace_root"]
        self.execution.validate_root(Path(source).resolve())
        scope = digest([principal.tenant, principal.business, workspace])[:32]
        parent = self.execution.data_dir.resolve() / "worktrees" / scope
        target = parent / run["id"]
        if parent.resolve() != parent or target.is_symlink():
            raise CoreError("worktree_path_invalid", "Worktree path cannot contain symbolic links", 409)
        if target.is_relative_to(Path(source).resolve()):
            raise CoreError(
                "worktree_path_invalid",
                "Core data must be outside the source repository for isolated execution",
                409,
            )
        base = run["data"]["base_commit"]
        if run["data"].get("code_workspace") and not target.exists():
            raise CoreError(
                "worktree_missing", "Recorded worktree is missing; restore it before retrying", 409
            )
        if target.exists() and not run["data"].get("code_workspace"):
            raise CoreError(
                "worktree_unclaimed",
                "Unclaimed execution directory requires operator inspection; it will not be reused",
                409,
            )
        if not target.exists():
            parent.mkdir(parents=True, exist_ok=True)
            self._tool(
                principal,
                workspace,
                run["id"],
                source,
                owner,
                [
                    "worktree",
                    "add",
                    "--detach",
                    "--lock",
                    "--reason",
                    "Hermes run " + run["id"],
                    str(target),
                    base,
                ],
            )

        def git(root, args):
            return self._tool(principal, workspace, run["id"], root, owner, args).strip()

        if Path(git(str(target), ["rev-parse", "--show-toplevel"])).resolve() != target:
            raise CoreError(
                "worktree_path_invalid", "Execution directory is not the registered worktree", 409
            )
        original = git(source, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
        actual = git(str(target), ["rev-parse", "--path-format=absolute", "--git-common-dir"])
        if Path(original).resolve() != Path(actual).resolve():
            raise CoreError(
                "worktree_repository_changed", "Execution directory belongs to another repository", 409
            )
        if not run["data"].get("code_workspace") and git(str(target), ["rev-parse", "HEAD"]) != base:
            raise CoreError(
                "worktree_base_changed", "Unclaimed worktree no longer matches the selected commit", 409
            )
        self.execution.patch(
            principal,
            workspace,
            run["id"],
            "run.worktree_ready",
            lambda item: {
                "data": {
                    **item["data"],
                    "code_workspace": {"mode": "git_worktree", "root": str(target), "base_commit": base},
                }
            },
            owner,
        )
        return str(target)

    def capture(self, principal, workspace, run_id, root, owner):
        run = self.execution.store.get(principal, workspace, "runs", run_id)
        base = run["data"]["base_commit"]

        def git(args, **kwargs):
            return self._tool(principal, workspace, run_id, root, owner, args, **kwargs)

        names = git(
            ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-status", "-z", base, "--"]
        ).split("\0")
        files = [{"status": names[index], "path": names[index + 1]} for index in range(0, len(names) - 1, 2)]
        untracked = [
            path for path in git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0") if path
        ]
        patch = git(
            ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--binary", base, "--"],
            allow_truncated=True,
        )
        status = git(["status", "--porcelain=v2", "--ignore-submodules=none", "-z"])
        submodule_dirty = any(
            record.startswith(("1 ", "2 ")) and record.split(" ", 3)[2] not in {"N...", "S..."}
            for record in status.split("\0")
        )
        evidence = {
            "base_commit": base,
            "head_commit": git(["rev-parse", "HEAD"]).strip(),
            "files": files,
            "untracked": untracked,
            "patch": patch,
            "truncated": patch.endswith("\n[truncated]"),
            "captured_at": now(),
            "status_porcelain": status,
            "complete": not (submodule_dirty or untracked or patch.endswith("\n[truncated]")),
        }
        evidence["sha256"] = digest(evidence)
        self.execution.patch(
            principal,
            workspace,
            run_id,
            "run.code_evidence",
            lambda item: {"data": {**item["data"], "code_evidence": evidence}},
            owner,
            audit_data={"code_evidence": evidence},
        )
