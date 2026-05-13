#!/usr/bin/env bash
# snapshot.sh - 导出 LanceDB 记忆快照（JSON，可 git 追踪）
set -euo pipefail

DATE=$(date +%Y-%m-%d)
OUT="memory/snapshots/${DATE}.json"
mkdir -p memory/snapshots
export PROJECT_PATH="${PROJECT_PATH:-.}"

python3 << PYEOF
import json, os
from pathlib import Path
from datetime import datetime

def lancedb_path():
    pp = Path(os.environ.get("PROJECT_PATH", ".")).resolve()
    raw = os.environ.get("LANCE_DB_PATH", "").strip()
    if raw:
        p = Path(raw)
        return p.resolve() if p.is_absolute() else (pp / p).resolve()
    leg = pp / ".ai-memory" / "lancedb"
    if leg.exists():
        return leg.resolve()
    return (pp / ".sop-runtime" / "ai-memory" / "lancedb").resolve()

snapshot = {"date": "$DATE", "tables": {}}

try:
    import lancedb
    db = lancedb.connect(str(lancedb_path()))
    for name in db.table_names():
        try:
            rows = db.open_table(name).to_pandas().to_dict("records")
            # 转换 datetime 为字符串
            for row in rows:
                for k, v in row.items():
                    if hasattr(v, 'isoformat'):
                        row[k] = v.isoformat()
            snapshot["tables"][name] = rows
        except Exception as e:
            snapshot["tables"][name] = {"error": str(e)}
except ImportError:
    snapshot["error"] = "lancedb not installed"

with open("$OUT", "w") as f:
    json.dump(snapshot, f, ensure_ascii=False, indent=2)

print(f"快照已保存: $OUT ({len(snapshot['tables'])} 个表)")
PYEOF
