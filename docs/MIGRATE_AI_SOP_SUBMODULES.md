# 本仓 `ai-sop-ops` Submodule 与规约迁移说明

> **当前状态（monorepo）**：根目录仅保留 **`ai-sop/`**（规约 Markdown，`magic-devops/ai-sop`）与 **`ai-sop-ops/`**（可执行运维）两个 Git submodule；**`path_config.sop_dir()` 只解析 `ai-sop/`**（或 `SOP_SPEC_ROOT` / `SOP_SOP_DIR`）。内嵌 **`sop/` 目录已删除**，Python 工具（`knowledge/lancedb_ops`、MCP 等）在 **`ai-sop-ops/`**。克隆后务必 **`git submodule update --init --recursive`**。**`SOP_OPS_ROOT`** 可覆盖运维根。

> **说明**：下列「用 submodule 替换内嵌 `sop/`」步骤仅适用于**仍保留旧内嵌 `sop/` 树**的历史 fork；本 upstream 已完成迁移，新克隆无需执行 §2 的 `git rm -rf sop` + `submodule add sop`。

## 1. 备份当前 `sop/`（可选）

```bash
cd /path/to/ai-team-dev-spec
cp -R sop /tmp/sop-backup-$(date +%Y%m%d)
```

## 2. 用 submodule 替换 `sop/`

```bash
git rm -rf sop
git submodule add git@github.com:magic-devops/ai-sop.git sop
git submodule update --init --recursive
```

## 3. 增加 `ai-sop-ops`（与 `ai-sop` 并列于仓库根）

```bash
git submodule add git@github.com:magic-devops/ai-sop-ops.git ai-sop-ops
git submodule update --init --recursive
```

## 4. 全仓替换脚本路径（提交前请 `git diff` 审阅）

将文档与 CI 中 **`sop/tools/`** 改为 **`ai-sop-ops/`**（或 `bash ai-sop-ops/start-manager.sh`），例如：

```bash
rg -l 'sop/tools' --glob '!**/.git/**' .
# 按需批量替换；典型映射：
#   bash sop/tools/start-manager.sh   →  bash ai-sop-ops/start-manager.sh
#   bash sop/tools/sop-ctl.sh         →  bash ai-sop-ops/sop-ctl.sh
```

根目录 **README**、**docs/USER_MANUAL.md**、**AGENTS.md**、**CLAUDE.md**、**sop/QUICK_REF.md**（在 submodule 内则改 **ai-sop** 仓）等需同步更新。

## 5. 克隆本仓的人

```bash
git clone --recurse-submodules <本仓 URL>
# 或克隆后：
git submodule update --init --recursive
```

## 6. 本地开发布局（推荐）

```
~/work/
  ai-team-dev-spec/     # 本 monorepo（含 submodule）
  ai-sop/               # 单独克隆规约仓时，可与 submodule 二选一
  ai-sop-ops/
```

未使用 submodule 时，将 **`ai-sop-ops`** 与 **`ai-team-dev-spec`** 放在同一父目录，脚本可通过 `include/sop-platform-root.sh` 自动找到平台仓；否则设置 **`SOP_PLATFORM_ROOT`**。

---

详见 [architecture/PLATFORM_REPOS_AND_MANAGER_SPLIT.md](architecture/PLATFORM_REPOS_AND_MANAGER_SPLIT.md)。
