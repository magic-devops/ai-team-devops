from sop_manager.routers.knowledge_graph_core import (
    build_graph_from_documents,
    lineage_for_entity,
    query_graph,
)


def test_build_graph_extracts_entities_and_relationships():
    graph = build_graph_from_documents(
        [
            {
                "id": "REQ-auth",
                "type": "requirement",
                "title": "登录认证需求",
                "content": "实现用户登录，关联 TASK-auth 和 apps/manager-web/src/pages/Login.tsx。",
                "tags": ["auth", "login"],
            },
            {
                "id": "TASK-auth",
                "type": "task",
                "title": "完成登录页面与鉴权接口联调",
                "content": "Depends on REQ-auth，修改 apps/manager-web/src/pages/Login.tsx 并补充验收证据。",
            },
        ],
        entity_types=["requirement", "task", "code_file", "tag"],
    )

    entity_ids = {item["id"] for item in graph["entities"]}
    edge_keys = {(item["source"], item["target"], item["type"]) for item in graph["edges"]}

    assert "requirement:REQ-auth" in entity_ids
    assert "task:TASK-auth" in entity_ids
    assert "code_file:apps/manager-web/src/pages/Login.tsx" in entity_ids
    assert ("task:TASK-auth", "requirement:REQ-auth", "depends_on") in edge_keys
    assert any(edge[2] == "mentions" for edge in edge_keys)
    assert graph["summary"]["nodes"] >= 4
    assert graph["summary"]["edges"] >= 3


def test_query_graph_returns_ranked_entity_neighborhood():
    graph = build_graph_from_documents(
        [
            {
                "id": "REQ-data",
                "type": "requirement",
                "title": "数据质量看板",
                "content": "需要展示质量规则、告警和 Data Quality Agent 执行证据。",
                "tags": ["data-quality"],
            },
            {
                "id": "TASK-data-quality",
                "type": "task",
                "title": "实现数据质量告警治理任务化",
                "content": "Depends on REQ-data，输出告警治理任务和通知。",
            },
        ]
    )

    out = query_graph(graph, "数据质量 告警", top_k=3)

    assert out["results"]
    assert out["results"][0]["entity"]["id"] in {"requirement:REQ-data", "task:TASK-data-quality"}
    assert out["results"][0]["score"] > 0
    assert out["results"][0]["neighbors"]


def test_lineage_for_entity_walks_connected_nodes_by_depth():
    graph = build_graph_from_documents(
        [
            {
                "id": "REQ-kg",
                "type": "requirement",
                "title": "知识图谱",
                "content": "关联 TASK-kg 和 docs/architecture/HERMES_PLATFORM_LATEST_ARCHITECTURE.md。",
            },
            {
                "id": "TASK-kg",
                "type": "task",
                "title": "实现 Graph RAG",
                "content": "Depends on REQ-kg，修改 apps/manager/sop_manager/routers/knowledge_graph.py。",
            },
        ]
    )

    out = lineage_for_entity(graph, "task:TASK-kg", depth=2)
    node_ids = {item["id"] for item in out["nodes"]}

    assert "task:TASK-kg" in node_ids
    assert "requirement:REQ-kg" in node_ids
    assert out["edges"]
    assert out["summary"]["nodes"] == len(out["nodes"])
