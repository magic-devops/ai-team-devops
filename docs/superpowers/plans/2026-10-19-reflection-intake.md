# Reflection intake implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver typed reflection collection, traceable immutable originals, and recoverable fixed input selection in the existing Intelligence workspace.

**Architecture:** EventInbox remains the only reflection body. An immutable record points to the real successful attempt; an immutable input stores only selection facts and exact source references. Existing event outbox and Delivery CAS/idempotency/ACK remain the only write protocols.

**Tech Stack:** FastAPI/Pydantic/SQLAlchemy, SQLite, React/TypeScript/Ant Design/TanStack Query, Python SDK/CLI and Go outbox.

**Spec:** `docs/DELIVERY_REFLECTION_INTAKE_DESIGN.md`

**2026-10-28 continuation:** The user authorized review and grouped source commits of all 102 remaining WIP files, with all runtime validation still deferred. Missing consumer behavior is being implemented under that authorization. Runtime steps below remain unchecked; historical RED or unrelated prior results are not current GREEN evidence. Current source ownership, fixes, exclusions and commit receipts are recorded in `docs/REMAINING_SOURCE_REVIEW.md` and `.sop-runtime/delivery-evidence/remaining-source-review/`.

## Global Constraints

- Canonical design only; retire old distill routes/consumers, no aliases or guessed migrations.
- Typed sop.reflection.recorded/schema1, subject empty; title160/observation12000/lesson8000, 8 refs, Task64/execution200 Unicode codepoints.
- Page20/100, cursor4000, fixed selection1..32, source64KiB/total2MiB. No partial success.
- Metadata totals include restricted collection shells; source/title/body/hidden refs are protected by frozen current ACL at every entry.
- Current browser/install/upload prohibition remains; no model/external production claims.
- Scratch only `.cache/reflection-intake`, evidence only `.sop-runtime/delivery-evidence/reflection-intake`. Short Windows test paths. Shared heavy checks require a coordinated window and RAM>=2GiB.
- Root owns docs/memory/OpenAPI/integration/Git. Commit verified phase locally; no push.

## Review Focus

- A restricted reflection cannot leak through generic Events raw/attempt/result or stale UI cache.
- A committed unknown input operation can replay its exact small ACK after sources disappear or runtime is unavailable.
- Execution rebinding never broadens old original visibility; missing plan fails closed even before processing.
- Directory totals, SQL selection limits and exact identities remain correct across a fixed cursor and permission changes.
- ORM/Core inserts cannot manufacture records/inputs; injected success-write failure rolls back the actual collection fact.

### Task 1: Canonical Manager intake and fixed selections

**Files:** create focused reflection_contract/intake/query/commands/reflections modules in `apps/manager/sop_manager/routers/`; modify sql_models, project_write_guard, events_ingest, event_processing, event_query/event_contract, Delivery command registration and main; remove reflection_distill; add permanent Manager tests.

**Interfaces:** Consumes authenticated event envelope and real storage/runtime facts. Produces the four `/api/v1/reflections` read routes, reflection_recorded effect, and `reflection.input.create` with small strict Delivery ACK. Owner publishes exact response contract before parallel consumers implement.

- [ ] Write and execute failing tests for valid typed collection, malformed references, shared raw ACL bypass and atomic Record failure.
- [ ] Implement intake frozen plan, success-only projection and common visibility; extend effect contract without claiming business acceptance.
- [ ] Write and execute failing tests for fixed SQL pages/exact/bytes, source corruption, all-or-none input creation and ACK lost/replayed after source unavailable.
- [ ] Implement immutable support models/guards and selection canonical action; retire old HTTP/module; run covering tests and record actual results/source hashes.
- [ ] Independent review verifies all five Review Focus conditions with actual database/query/transaction behavior; address meaningful findings with permanent regressions.
- [ ] Add RED and common nullable-assessment handling for the new reflection catalog entry: unknown scores excluded from aggregates, explicit assessed/unassessed counts, no zero-derived governance or readiness claim. Consumers show unassessed; no reflection-ID exception or invented percentage.

### Task 2: Existing workspace interaction

**Files:** `Intelligence.tsx` and focused `intelligence/reflections/` components; Web `lib/reflection*`, `i18n/reflections.ts`, styles; navigation/microApps/hub; generic event safe return and effect target; remove old api wrappers.

**Interfaces:** Consumes Task1 exact DTOs. Fixed original uses Delivery action/reflection_input ACK. Uses existing Events as the only raw-original viewer. SDKCLI is the real collection entry this phase.

- [ ] Write and execute actual SSR/controller callback RED for page-off exact, restricted cached original, safe return, adoption before selection and independent unknown recovery.
- [ ] Implement two compact lists, independent detail/source reads, explicit selection/preview and outer durable recovery host. Every query scoped by actual project/session.
- [ ] Replace old route/menu/queries/mutations; no old alias or inert collect button. Add three-language access, pending, failure, prepared and unavailable states with real refresh.
- [ ] Exercise actual late ABA callbacks, StrictMode, storage failure, double click, malformed ACK, source loss and same-original replay. Check TypeScript/build and full Web tests when coordinated.
- [ ] Independent review uses production host callbacks/SSR, reports visual limits explicitly.

### Task 3: Typed producer and consumer clients

**Files:** SDK `reflection_intake.py`, client.py/event effect validation; CLI new reflection command group/registration; Go outbox effect contract and relevant tests.

**Interfaces:** Typed helper freezes explicit original event ID/time and strict fields; no direct bypass POST. CLI reuses EventOutbox/local_intents and Delivery exact original/key/CAS. Read route DTO/filters match Task1.

- [ ] Write and execute RED for malformed typed data, preserved UTF8 original, reflection_recorded ACK and same ID/digest outbox replay.
- [ ] Implement typed SDK/CLI collection, bounded/exact reads and input creation from explicit original; retire three legacy SDK methods.
- [ ] Extend actual Python/Go effect validation and tests; no permissive arbitrary effect fallback.
- [ ] Run focused then affected complete clients/Go checks in bounded resource window; root verifies offline wheel contents and schema bytes.

### Task 4: Integration, evidence and commit

**Files:** shared OpenAPI, design/guide/workbench/progress/current_state; evidence receipts/source snapshots/root ledger.

- [ ] Publish/check actual app OpenAPI; verify new/retired routes, refs and unrelated contract stability.
- [ ] Run source-pinned affected checks, independent reviews and real authenticated socket HTTP: typed SDKCLI event→one record, source ACL denial across generic/new routes, fixed input lost ACK→same-original replay; GET all-table zero writes. No models.
- [ ] Update guide and honest counts/scope, production/visual limits and next gap. Preserve failed attempts as well as final evidence.
- [ ] Inventory/hash/preserve important source/evidence before exact scratch cleanup; verify own recorded process exits and unrelated unique file unchanged.
- [ ] Review/stage all intended phase files, verify bytes, commit `feat(reflections): add canonical intake and fixed inputs [T-reflection-intake]`; verify clean and no push. Full objective remains active.
