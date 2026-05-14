# Submodule 与本地布局（当前架构）

平台 monorepo 以两个 Git submodule 为规约与运维真源：

| 路径 | 仓库 | 内容 |
|------|------|------|
| **`ai-sop/`** | `magic-devops/ai-sop` | 规约 Markdown（`specs/`、`agents/`、`workflow/` 等） |
| **`ai-sop-ops/`** | `magic-devops/ai-sop-ops` | Shell/Python：`sop-ctl.sh`、`start-manager.sh`、`install-integrations.sh`、`sop_ai_hook.py`、`knowledge/`、MCP 等 |

**`path_config.sop_dir()`** 只解析 **`ai-sop/`**（或环境变量 **`SOP_SPEC_ROOT` / `SOP_SOP_DIR`**，须含 `specs/`）。**`path_config.sop_ops_dir()`** 只解析 **`ai-sop-ops/`**（或 **`SOP_OPS_ROOT`**）。

## 克隆

```bash
git clone --recurse-submodules <本仓 URL>
# 或克隆后：
git submodule update --init --recursive
```

## 环境变量（可选）

| 变量 | 说明 |
|------|------|
| **`SOP_PLATFORM_ROOT`** | 含 `apps/manager/sop_manager` 的平台 monorepo 根；未设置时由 `ai-sop-ops/include/sop-platform-root.sh` 尝试探测 |
| **`SOP_SPEC_ROOT`** | 规约根（默认 `$SOP_PLATFORM_ROOT/ai-sop`，须存在 `specs/`） |
| **`SOP_OPS_ROOT`** | 运维仓根（默认 `$SOP_PLATFORM_ROOT/ai-sop-ops`） |

## 推荐目录布局（本地多仓并列时）

```
~/work/
  ai-team-dev-spec/     # 本 monorepo（含上述 submodule）
```

脚本通过 **`source ai-sop-ops/include/sop-platform-root.sh`** 解析 `SOP_PLATFORM_ROOT`；无法探测时请 **显式 `export SOP_PLATFORM_ROOT`**。

---

详见 [architecture/PLATFORM_REPOS_AND_MANAGER_SPLIT.md](architecture/PLATFORM_REPOS_AND_MANAGER_SPLIT.md)。
