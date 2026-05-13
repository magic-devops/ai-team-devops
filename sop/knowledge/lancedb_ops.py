"""
LanceDB 核心操作库 — 语义搜索、知识库管理、规则检索
用法: from lancedb_ops import LanceOps
"""
import os, json
from pathlib import Path
from datetime import datetime
from typing import Optional


def _lancedb_dir() -> Path:
    """与 Web path_config 对齐：LANCE_DB_PATH → .ai-memory/lancedb（可符号链接）→ .sop-runtime/ai-memory/lancedb。"""
    pp = Path(os.getenv("PROJECT_PATH", ".")).expanduser().resolve()
    raw = os.getenv("LANCE_DB_PATH", "").strip()
    if raw:
        p = Path(raw)
        return p.resolve() if p.is_absolute() else (pp / p).resolve()
    leg = pp / ".ai-memory" / "lancedb"
    if leg.exists():
        return leg.resolve()
    return (pp / ".sop-runtime" / "ai-memory" / "lancedb").resolve()


DB_PATH = _lancedb_dir()

class LanceOps:
    def __init__(self, db_path: str = None):
        import lancedb
        self.db = lancedb.connect(str(db_path or DB_PATH))
        self._embed = None

    def _embedder(self):
        if self._embed is None:
            from sentence_transformers import SentenceTransformer
            self._embed = SentenceTransformer("all-MiniLM-L6-v2")
        return self._embed

    def embed(self, text: str) -> list:
        return self._embedder().encode(text).tolist()

    # ── 语义搜索 ──────────────────────────────────────────────────
    def search(self, table: str, query: str, limit: int = 5, where: str = None) -> list:
        """语义搜索任意表"""
        try:
            t = self.db.open_table(table)
            q = t.search(self.embed(query)).limit(limit)
            if where:
                q = q.where(where)
            return q.to_list()
        except Exception:
            return []

    def find_similar_tasks(self, query: str, limit: int = 5) -> list:
        """查找相似历史任务（避免重复工作）"""
        return self.search("tasks", query, limit, where="status = 'completed'")

    def find_similar_issues(self, query: str, limit: int = 3) -> list:
        """查找相似历史问题（快速定位解决方案）"""
        return self.search("incidents", query, limit)

    def find_relevant_rules(self, context: str, limit: int = 5) -> list:
        """检索与当前任务相关的规则"""
        return self.search("rules", context, limit, where="status = 'active'")

    # ── 知识库操作 ────────────────────────────────────────────────
    def index_document(self, path: str, content: str, category: str = "general",
                       metadata: dict = None) -> str:
        """将文档索引到知识库"""
        import pyarrow as pa
        table_name = "knowledge"
        row = {
            "id": f"DOC-{int(datetime.utcnow().timestamp()*1000)}",
            "path": path,
            "content": content[:4000],  # 截断避免过大
            "category": category,
            "metadata": json.dumps(metadata or {}),
            "created_at": datetime.utcnow(),
            "vector": self.embed(content[:512]),
        }
        if table_name not in self.db.table_names():
            import pyarrow as pa
            schema = pa.schema([
                pa.field("id", pa.string()),
                pa.field("path", pa.string()),
                pa.field("content", pa.string()),
                pa.field("category", pa.string()),
                pa.field("metadata", pa.string()),
                pa.field("created_at", pa.timestamp("us")),
                pa.field("vector", pa.list_(pa.float32(), 384)),
            ])
            self.db.create_table(table_name, schema=schema)
        self.db.open_table(table_name).add([row])
        return row["id"]

    def search_knowledge(self, query: str, category: str = None, limit: int = 5) -> list:
        """语义搜索知识库"""
        where = f"category = '{category}'" if category else None
        return self.search("knowledge", query, limit, where)

    # ── 规则操作 ──────────────────────────────────────────────────
    def add_rule(self, rule_text: str, category: str, source: str,
                 confidence: float = 0.70) -> str:
        """添加新规则到规则库"""
        import pyarrow as pa
        table_name = "rules"
        row = {
            "id": f"RULE-{int(datetime.utcnow().timestamp()*1000)}",
            "rule": rule_text,
            "category": category,
            "source": source,
            "confidence": confidence,
            "status": "testing",
            "trigger_count": 0,
            "created_at": datetime.utcnow(),
            "vector": self.embed(rule_text),
        }
        if table_name not in self.db.table_names():
            schema = pa.schema([
                pa.field("id", pa.string()),
                pa.field("rule", pa.string()),
                pa.field("category", pa.string()),
                pa.field("source", pa.string()),
                pa.field("confidence", pa.float32()),
                pa.field("status", pa.string()),
                pa.field("trigger_count", pa.int32()),
                pa.field("created_at", pa.timestamp("us")),
                pa.field("vector", pa.list_(pa.float32(), 384)),
            ])
            self.db.create_table(table_name, schema=schema)
        self.db.open_table(table_name).add([row])
        return row["id"]

    def get_context_for_task(self, task_title: str, task_desc: str = "") -> dict:
        """为任务获取完整上下文（相似任务+相关规则+知识库）"""
        query = f"{task_title} {task_desc}"
        return {
            "similar_tasks": self.find_similar_tasks(query, limit=3),
            "relevant_rules": self.find_relevant_rules(query, limit=5),
            "knowledge": self.search_knowledge(query, limit=3),
        }

    # ── 批量索引 custom/ 目录 ─────────────────────────────────────
    def index_custom_dir(self, custom_path: str = None) -> int:
        """批量索引 custom/ 目录下的文档"""
        base = Path(custom_path or (Path(os.getenv("PROJECT_PATH", ".")) / "sop" / "custom"))
        count = 0
        for f in base.rglob("*.md"):
            try:
                content = f.read_text(errors="replace")
                category = f.parent.name
                self.index_document(str(f), content, category, {"file": f.name})
                count += 1
            except Exception:
                pass
        return count


# ── CLI 入口 ──────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    ops = LanceOps()
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"

    if cmd == "search" and len(sys.argv) > 3:
        results = ops.search(sys.argv[2], " ".join(sys.argv[3:]))
        for r in results:
            print(f"  [{r.get('id','')}] {r.get('title', r.get('rule', ''))[:80]}")
    elif cmd == "index-custom":
        n = ops.index_custom_dir()
        print(f"已索引 {n} 个文档")
    elif cmd == "context" and len(sys.argv) > 2:
        ctx = ops.get_context_for_task(" ".join(sys.argv[2:]))
        print(json.dumps(ctx, ensure_ascii=False, indent=2, default=str))
    else:
        print("用法:")
        print("  python lancedb_ops.py search <table> <query>")
        print("  python lancedb_ops.py index-custom")
        print("  python lancedb_ops.py context <task description>")
