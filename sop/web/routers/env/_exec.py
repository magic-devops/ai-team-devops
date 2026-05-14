"""通用 exec / allowlist 工具，供未来切薄复用。

复制自 routers.docker_env，保证拆分时函数签名不变。
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import List, Set

# 复用主文件中的实现：保持单一来源，避免重复维护
from routers.docker_env import (  # noqa: F401
    _DEFAULT_EXEC_ALLOW,
    _exec_allowlist,
    _path_exec_allow_extra,
    _run,
    _safe_path_under_project,
    _validate_argv,
)
