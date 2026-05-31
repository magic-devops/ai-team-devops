from contextlib import contextmanager

from sop_manager.path_config import reset_request_scope, set_request_scope
from sop_manager.routers import knowledge_graph, memory_api
from sop_manager import memory_store


@contextmanager
def _scope(tmp_path, project_id: str = "proj-kg"):
    tokens = set_request_scope(
        "tenant-a",
        project_id,
        tmp_path,
        tenant_code="tenant-a",
        business_code="biz-a",
        project_code=project_id,
    )
    try:
        yield
    finally:
        reset_request_scope(tokens)


def test_graph_build_filters_denied_sources_and_returns_evidence_links(tmp_path):
    with _scope(tmp_path):
        out = knowledge_graph.build(
            knowledge_graph.BuildIn(
                entity_types=["knowledge", "task", "code_file"],
                allowed_sources=["trusted.docs"],
                documents=[
                    {
                        "id": "DOC-public",
                        "type": "knowledge",
                        "title": "公开知识",
                        "content": "Graph RAG 依赖 TASK-public 和 apps/manager/sop_manager/routers/knowledge_graph.py",
                        "source": "trusted.docs",
                        "path": "docs/public.md",
                    },
                    {
                        "id": "DOC-secret",
                        "type": "knowledge",
                        "title": "受限知识",
                        "content": "secret-token TASK-secret",
                        "source": "restricted.docs",
                        "allowed_project_ids": ["another-project"],
                    },
                ],
            )
        )

        ids = {item["id"] for item in out["graph"]["entities"]}
        assert "knowledge:DOC-public" in ids
        assert "knowledge:DOC-secret" not in ids
        assert out["permission"]["denied_documents"] >= 1
        assert any(item["id"] == "DOC-secret" for item in out["permission"]["denied"])

        query = knowledge_graph.query(knowledge_graph.QueryIn(query="Graph RAG", top_k=5))
        assert query["results"]
        first = query["results"][0]
        assert first["evidence"]
        assert first["evidence"][0]["source"] == "trusted.docs"
        assert "secret-token" not in str(query)


def test_memory_lifecycle_hides_archived_items_from_default_search(tmp_path):
    memory_store._store_singleton = None
    with _scope(tmp_path, "proj-memory"):
        created = memory_api.memory_create(
            memory_api.MemoryCreate(
                content="Graph RAG 需要保留证据链",
                kind="long",
                metadata={"entity_id": "knowledge:DOC-public"},
            )
        )
        memory_id = created["item"]["id"]

        updated = memory_api.memory_lifecycle(
            memory_id,
            memory_api.MemoryLifecycleUpdate(state="archived", reason="merged into profile"),
        )
        assert updated["updated"] == 1

        hidden = memory_api.memory_search("Graph RAG", limit=10)
        assert hidden["items"] == []

        visible = memory_api.memory_search("Graph RAG", limit=10, lifecycle_state="archived")
        assert visible["items"][0]["id"] == memory_id
        assert visible["items"][0]["metadata"]["lifecycle_state"] == "archived"


def test_entity_profile_merge_combines_graph_neighbors_and_memory(tmp_path):
    memory_store._store_singleton = None
    with _scope(tmp_path, "proj-profile"):
        knowledge_graph.build(
            knowledge_graph.BuildIn(
                entity_types=["knowledge", "task"],
                documents=[
                    {
                        "id": "DOC-public",
                        "type": "knowledge",
                        "title": "Graph RAG 画像",
                        "content": "依赖 TASK-profile 输出画像合并证据",
                        "source": "trusted.docs",
                    },
                    {
                        "id": "TASK-profile",
                        "type": "task",
                        "title": "画像合并任务",
                        "content": "Depends on DOC-public",
                        "source": "trusted.docs",
                    },
                ],
            )
        )
        memory_api.memory_create(
            memory_api.MemoryCreate(
                content="画像合并需要把运行证据、记忆和图谱邻居放在一起",
                kind="episodic",
                metadata={"entity_id": "knowledge:DOC-public", "lifecycle_state": "active"},
            )
        )

        profile = knowledge_graph.merge_entity_profile(
            knowledge_graph.EntityProfileMergeIn(entity_id="knowledge:DOC-public", memory_query="画像合并")
        )

        assert profile["profile"]["entity"]["id"] == "knowledge:DOC-public"
        assert profile["profile"]["memory_items"]
        assert profile["profile"]["neighbors"]
        assert profile["profile"]["evidence_links"]
        assert profile["profile"]["profile_state"] == "merged"
