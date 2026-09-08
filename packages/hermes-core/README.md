# Hermes Core

Install the workspace package, then run `hermes-core --data-dir PATH --token-file PATH --port 0 --agentd PATH`.
The process binds loopback only and emits a JSON connection descriptor containing URL, token file path and PID.
The token itself is never printed. Native clients transfer it to the operating system credential store.

`GET /api/hermes/v1/health` is unauthenticated. Other endpoints require a Bearer token.
Workspace-scoped resources additionally require `X-Workspace-Id`; workspace enumeration and system endpoints do not.
Mutations require idempotency keys. Updates/actions require resource versions; run actions default to dry-run.

SQLite WAL stores entities, audit events and idempotency receipts transactionally. LangGraph checkpoints use
a separate SQLite database. Team deployments can configure `HERMES_DATABASE_URL` with PostgreSQL and install
the `team` extra. Historical pre-1.0 data is neither migrated nor removed.

Command execution requires a real `sop-agentd` binary. Approval nodes interrupt execution; successful nodes
are not rerun after checkpoint recovery. An expired execution lease fails closed and requires approval permission
before an explicit retry. Exactly-once external side effects are not promised; inspect uncertain effects first.
The local command runner is not an operating-system sandbox. Only trusted workspace owners should be granted
execute permission on a host that has access to their files and credentials.

Run `HERMES_TEST_AGENTD=/absolute/path/to/sop-agentd python -m pytest packages/hermes-core/tests -q`
from the repository root to include real TDD/approval/retry process integration tests.
