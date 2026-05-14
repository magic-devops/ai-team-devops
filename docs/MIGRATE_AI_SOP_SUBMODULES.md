# 将本仓 `sop/` 与 `sop/tools` 迁移为 Git Submodule

> **前置条件**：远程已有  
> - `git@github.com:magic-devops/ai-sop.git`（规约，已推送 `main`）  
> - `git@github.com:magic-devops/ai-sop-ops.git`（运维脚本，已推送 `main`）

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

## 3. 增加 `ai-sop-ops`（与 `sop` 并列）

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
