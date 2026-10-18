-- SHARED SCHEMA v1 (agentd proposal frozen for root acceptance, 2026-10-18).
-- One project-local file: <PROJECT_PATH>/.sop-runtime/outbox.sqlite
-- Timestamp *_ms values are UTC Unix milliseconds; remote_stored_at is original server ISO text.
-- PRAGMA user_version=1 is the schema-version authority (not set until migration commits).
CREATE TABLE events (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    event_json TEXT NOT NULL,
    digest TEXT NOT NULL CHECK(length(digest)=64 AND digest NOT GLOB '*[^0-9a-f]*'),
    intended_project_id TEXT NOT NULL CHECK(length(intended_project_id)>0),
    binding_state TEXT NOT NULL CHECK(binding_state IN ('unbound','bound')),
    expected_tenant_id TEXT,
    expected_project_id TEXT,
    expected_producer_id TEXT,
    manager_origin TEXT,
    state TEXT NOT NULL CHECK(state IN ('pending','dead_letter','acked')),
    revision INTEGER NOT NULL CHECK(revision>=1),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
    next_at_ms INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    last_attempt_at_ms INTEGER,
    last_error_code TEXT,
    last_error_message TEXT,
    last_error_retryable INTEGER CHECK(last_error_retryable IN (0,1)),
    dead_at_ms INTEGER,
    receipt_id TEXT,
    receipt_outcome TEXT CHECK(receipt_outcome IN ('stored','duplicate')),
    remote_stored_at TEXT,
    processing_state TEXT CHECK(processing_state IN ('pending','processed','failed')),
    remote_receipt_json TEXT,
    acked_at_ms INTEGER,
    CHECK (
      (binding_state='unbound' AND expected_tenant_id IS NULL AND expected_project_id IS NULL
       AND expected_producer_id IS NULL AND manager_origin IS NULL)
      OR
      (binding_state='bound' AND length(COALESCE(expected_tenant_id,''))>0 AND length(COALESCE(expected_project_id,''))>0
       AND length(COALESCE(expected_producer_id,''))>0 AND length(COALESCE(manager_origin,''))>0
       AND expected_project_id=intended_project_id)
    )
);
CREATE INDEX ix_events_due ON events(state,next_at_ms,created_at_ms,id);
CREATE INDEX ix_events_state_created ON events(state,created_at_ms,id);

-- These support tables contain metadata, never another copy of a sendable event.
CREATE TABLE queue_meta (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    queue_id TEXT NOT NULL CHECK(length(queue_id)=32 AND queue_id NOT GLOB '*[^0-9a-f]*'),
    generation INTEGER NOT NULL CHECK(generation>=0)
);
INSERT INTO queue_meta(singleton,queue_id,generation) VALUES(1,lower(hex(randomblob(16))),0);

-- Scope is the selected SQLite file. Global operation/key uniqueness rejects reuse on another target.
CREATE TABLE queue_receipts (
    operation TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    event_id TEXT NOT NULL REFERENCES events(id),
    request_json TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY(operation,idempotency_key)
);

CREATE TRIGGER events_payload_immutable BEFORE UPDATE ON events
WHEN NEW.id IS NOT OLD.id OR NEW.type IS NOT OLD.type OR NEW.subject IS NOT OLD.subject
  OR NEW.event_json IS NOT OLD.event_json OR NEW.digest IS NOT OLD.digest
  OR NEW.intended_project_id IS NOT OLD.intended_project_id OR NEW.created_at_ms IS NOT OLD.created_at_ms
BEGIN SELECT RAISE(ABORT,'immutable event identity/payload'); END;

CREATE TRIGGER events_binding_immutable BEFORE UPDATE ON events
WHEN OLD.binding_state='bound' AND (
 NEW.binding_state IS NOT OLD.binding_state OR NEW.expected_tenant_id IS NOT OLD.expected_tenant_id
 OR NEW.expected_project_id IS NOT OLD.expected_project_id OR NEW.expected_producer_id IS NOT OLD.expected_producer_id
 OR NEW.manager_origin IS NOT OLD.manager_origin)
BEGIN SELECT RAISE(ABORT,'immutable event binding'); END;

CREATE TRIGGER events_acked_terminal BEFORE UPDATE ON events
WHEN OLD.state='acked' AND NEW.state IS NOT OLD.state
BEGIN SELECT RAISE(ABORT,'acknowledged event is terminal'); END;

CREATE TRIGGER queue_receipts_no_update BEFORE UPDATE ON queue_receipts
BEGIN SELECT RAISE(ABORT,'immutable queue receipt'); END;
CREATE TRIGGER queue_receipts_no_delete BEFORE DELETE ON queue_receipts
BEGIN SELECT RAISE(ABORT,'immutable queue receipt'); END;

CREATE TRIGGER queue_meta_identity_immutable BEFORE UPDATE ON queue_meta
WHEN NEW.singleton IS NOT OLD.singleton OR NEW.queue_id IS NOT OLD.queue_id
BEGIN SELECT RAISE(ABORT,'immutable queue identity'); END;
