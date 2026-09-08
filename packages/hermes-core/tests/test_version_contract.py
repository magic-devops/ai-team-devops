from __future__ import annotations

import re
import tomllib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
PRODUCT_VERSION = "1.0.0"


def _pyproject_version(path: str) -> str:
    return tomllib.loads((ROOT / path).read_text(encoding="utf-8"))["project"]["version"]


def test_python_product_versions_are_normalized_to_1_0_0():
    for path in (
        "pyproject.toml",
        "packages/hermes-core/pyproject.toml",
        "packages/sop-sdk-python/pyproject.toml",
        "packages/sop-cli/pyproject.toml",
        "apps/manager/pyproject.toml",
        "apps/manager-worker/pyproject.toml",
    ):
        assert _pyproject_version(path) == PRODUCT_VERSION

    for path in (
        "packages/hermes-core/hermes_core/__init__.py",
        "packages/sop-sdk-python/sop_sdk/__init__.py",
        "packages/sop-cli/sop_cli/__init__.py",
        "apps/manager/sop_manager/__init__.py",
        "apps/manager-worker/sop_worker/__init__.py",
    ):
        assert f'__version__ = "{PRODUCT_VERSION}"' in (ROOT / path).read_text(encoding="utf-8")


def test_cross_artifact_version_contracts_match_hermes_1_0_0():
    manager = (ROOT / "apps/manager/pyproject.toml").read_text(encoding="utf-8")
    cli = (ROOT / "packages/sop-cli/pyproject.toml").read_text(encoding="utf-8")
    observability = (ROOT / "apps/manager/sop_manager/routers/observability.py").read_text(encoding="utf-8")
    go_main = (ROOT / "apps/agent-runtime/cmd/sop-agentd/main.go").read_text(encoding="utf-8")
    go_makefile = (ROOT / "apps/agent-runtime/Makefile").read_text(encoding="utf-8")

    assert '"hermes-core>=1.0.0,<2"' in manager
    assert '"sop-sdk>=1.0.0,<2"' in cli
    assert 'os.getenv("SOP_VERSION", "1.0.0")' in observability
    assert re.search(r'Version\s*=\s*"1\.0\.0"', go_main)
    assert re.search(r"VERSION\s*\?=\s*1\.0\.0", go_makefile)
