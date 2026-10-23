"""Offline upgrade definitions; unrun until the human restores validation."""
import json

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from sop_manager.schema_upgrade import apply_schema_upgrade, require_current_schema, verify_schema


def old_database(tmp_path):
    engine = create_engine("sqlite:///" + (tmp_path / "sources.sqlite").as_posix())
    with engine.begin() as db:
        db.execute(text("CREATE TABLE tasks (id TEXT PRIMARY KEY, acceptance_criteria JSON NOT NULL DEFAULT '[]', owner_id TEXT NOT NULL DEFAULT '')"))
        db.execute(text("CREATE TABLE ops_issue_sources (id VARCHAR(64) PRIMARY KEY, tenant_id VARCHAR(64) NOT NULL, project_id VARCHAR(64) NOT NULL, source_id VARCHAR(128) NOT NULL, source_digest VARCHAR(64) NOT NULL, issue_id VARCHAR(64) NOT NULL, snapshot JSON NOT NULL, created_by VARCHAR(64) NOT NULL, created_at DATETIME NOT NULL, CONSTRAINT uq_ops_issue_source_scope UNIQUE (tenant_id, project_id, source_id))"))
        db.execute(text("CREATE INDEX ix_ops_issue_source_issue ON ops_issue_sources (tenant_id, project_id, issue_id)"))
        db.execute(text("INSERT INTO ops_issue_sources VALUES ('original', 'team', 'project', 'same-id', :digest, 'ISSUE-original', :snapshot, 'writer', '2026-10-23 00:00:00')"), {"digest": "a" * 64, "snapshot": json.dumps({"id": "same-id", "action": "Original"})})
    return engine


def test_startup_requires_explicit_upgrade_and_leaves_original_source_untouched(tmp_path):
    engine = old_database(tmp_path)
    assert verify_schema(engine)["status"] == "upgrade_required"
    with pytest.raises(RuntimeError, match="schema apply"):
        require_current_schema(engine)
    assert "source_type" not in {column["name"] for column in inspect(engine).get_columns("ops_issue_sources")}
    with engine.connect() as db:
        assert db.execute(text("SELECT issue_id,source_digest FROM ops_issue_sources")).one() == ("ISSUE-original", "a" * 64)
    engine.dispose()


def test_explicit_upgrade_preserves_fixed_identity_and_allows_same_id_in_distinct_types(tmp_path):
    engine = old_database(tmp_path)
    assert apply_schema_upgrade(engine)["status"] == "upgraded"
    with engine.begin() as db:
        row = db.execute(text("SELECT * FROM ops_issue_sources")).mappings().one()
        assert row["source_type"] == "self_heal" and row["id"] == "original" and row["issue_id"] == "ISSUE-original"
        assert row["source_digest"] == "a" * 64 and json.loads(row["snapshot"])["action"] == "Original"
        db.execute(text("INSERT INTO ops_issue_sources SELECT 'rca', tenant_id,project_id,source_id,'rca',source_digest,'ISSUE-rca',snapshot,created_by,created_at FROM ops_issue_sources"))
    with pytest.raises(IntegrityError), engine.begin() as db:
        db.execute(text("INSERT INTO ops_issue_sources SELECT 'duplicate',tenant_id,project_id,source_id,source_type,source_digest,issue_id,snapshot,created_by,created_at FROM ops_issue_sources WHERE id='rca'"))
    assert apply_schema_upgrade(engine)["status"] == "current"
    assert {tuple(item["column_names"]) for item in inspect(engine).get_unique_constraints("ops_issue_sources")} == {("tenant_id", "project_id", "source_type", "source_id")}
    engine.dispose()


def test_upgrade_refuses_an_existing_intermediate_table_without_discarding_sources(tmp_path):
    engine = old_database(tmp_path)
    with engine.begin() as db:
        db.execute(text("CREATE TABLE ops_issue_sources_next (unique_content TEXT)"))
        db.execute(text("INSERT INTO ops_issue_sources_next VALUES ('preserve this')"))
    with pytest.raises(RuntimeError, match="Incomplete operational source schema"):
        apply_schema_upgrade(engine)
    with engine.connect() as db:
        assert db.execute(text("SELECT issue_id FROM ops_issue_sources")).scalar() == "ISSUE-original"
        assert db.execute(text("SELECT unique_content FROM ops_issue_sources_next")).scalar() == "preserve this"
    engine.dispose()


@pytest.mark.parametrize("defect", ["missing_snapshot", "missing_id", "missing_primary_key", "missing_issue_index", "nullable_digest", "short_identity", "wrong_digest_type", "cascading_issue_fk"])
def test_partial_typed_source_schema_requires_repair_without_automatic_ddl(tmp_path, defect):
    engine = old_database(tmp_path)
    definitions = {
        "id": "VARCHAR(64) NOT NULL PRIMARY KEY", "tenant_id": "VARCHAR(64) NOT NULL",
        "project_id": "VARCHAR(64) NOT NULL", "source_id": "VARCHAR(128) NOT NULL", "source_type": "VARCHAR(16) NOT NULL",
        "source_digest": "VARCHAR(64) NOT NULL", "issue_id": "VARCHAR(64) NOT NULL", "snapshot": "JSON NOT NULL",
        "created_by": "VARCHAR(64) NOT NULL", "created_at": "DATETIME NOT NULL",
    }
    if defect == "missing_snapshot": definitions.pop("snapshot")
    if defect == "missing_id": definitions.pop("id")
    if defect == "missing_primary_key": definitions["id"] = "VARCHAR(64) NOT NULL"
    if defect == "nullable_digest": definitions["source_digest"] = "VARCHAR(64)"
    if defect == "short_identity": definitions["source_id"] = "VARCHAR(16) NOT NULL"
    if defect == "wrong_digest_type": definitions["source_digest"] = "INTEGER NOT NULL"
    with engine.begin() as db:
        db.execute(text("DROP TABLE ops_issue_sources"))
        foreign_key = ", FOREIGN KEY(issue_id) REFERENCES issues(id) ON DELETE CASCADE" if defect == "cascading_issue_fk" else ""
        db.execute(text("CREATE TABLE ops_issue_sources (" + ",".join(name + " " + ddl for name, ddl in definitions.items()) + ", CONSTRAINT uq_ops_issue_source_type_scope UNIQUE(tenant_id,project_id,source_type,source_id)" + foreign_key + ")"))
        if defect != "missing_issue_index":
            db.execute(text("CREATE INDEX ix_ops_issue_source_issue ON ops_issue_sources (tenant_id,project_id,issue_id)"))
    before = inspect(engine).get_columns("ops_issue_sources")
    assert verify_schema(engine)["status"] == "upgrade_required"
    with pytest.raises(RuntimeError, match="schema apply"): require_current_schema(engine)
    with pytest.raises(RuntimeError, match="Incomplete operational source schema"): apply_schema_upgrade(engine)
    assert {item["name"] for item in inspect(engine).get_columns("ops_issue_sources")} == {item["name"] for item in before}
    assert "ops_issue_sources_next" not in inspect(engine).get_table_names()
    engine.dispose()
