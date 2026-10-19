"""Bounded, exact canonical proof inputs for an explicitly chosen quality scope."""

import json
from collections import defaultdict, deque

from fastapi import HTTPException
from sqlalchemy import LargeBinary, Text, cast, func, or_, select
from sqlalchemy.orm import load_only

from .delivery_query_index import scope
from .delivery_service import initial_state, reconcile
from .delivery_team import TeamContext
from .delivery_verification import VerificationContext
from .sql_models import DeliveryQueryFact, DeliveryTaskReview, DeliveryWorkspace, Issue, Requirement, Task


def _fail(code, message, status=409):
    raise HTTPException(status, {"code": code, "message": message})


def _ids(values):
    values = list(values or [])
    if (
        len(values) > 200
        or any(not isinstance(value, str) or not value.strip() for value in values)
        or len(set(values)) != len(values)
    ):
        _fail(
            "release_scope_invalid", "Choose at most 200 distinct nonempty IDs in each scope category.", 422
        )
    return set(values)


def _paths(db, project, paths):
    """Read only named canonical JSON paths, in small SQL column batches."""
    pairs, result = list(paths.items()), {}
    for start in range(0, len(pairs), 100):
        part = pairs[start : start + 100]
        columns = [DeliveryWorkspace.data[path].label(str(index)) for index, (_, path) in enumerate(part)]
        size = [
            func.length(cast(column, LargeBinary))
            if db.bind.dialect.name == "sqlite"
            else func.octet_length(cast(column, Text))
            for column in columns
        ]
        sizes = db.execute(select(*size).where(*scope(project, DeliveryWorkspace))).first()
        if sizes and any((value or 0) > 1024 * 1024 for value in sizes):
            _fail("quality_scope_too_large", "A complete proof source exceeds its bounded read budget.", 413)
        row = db.execute(select(*columns).where(*scope(project, DeliveryWorkspace))).mappings().first()
        result.update({key: row[str(index)] if row else None for index, (key, _) in enumerate(part)})
    return result


def _types(db, project, paths):
    """Inspect exact source shape without transferring a container body."""
    dialect = db.bind.dialect.name
    pairs, kinds = list(paths.items()), {}
    for start in range(0, len(pairs), 100):
        part, columns = pairs[start : start + 100], []
        for _, path in part:
            if dialect == "sqlite":
                location = "$" + "".join(
                    f"[{key}]" if isinstance(key, int) else "." + json.dumps(key, ensure_ascii=False)
                    for key in path
                )
                column = func.json_type(DeliveryWorkspace.data, location)
            elif dialect == "postgresql":
                column = func.json_typeof(DeliveryWorkspace.data[path] if path else DeliveryWorkspace.data)
            elif dialect in {"mysql", "mariadb"}:
                column = func.json_type(DeliveryWorkspace.data[path] if path else DeliveryWorkspace.data)
            else:
                _fail(
                    "quality_scope_unavailable",
                    "This database cannot verify original JSON source presence.",
                    503,
                )
            columns.append(column)
        row = db.execute(select(*columns).where(*scope(project, DeliveryWorkspace))).first()
        if row:
            kinds.update((key, kind) for (key, _), kind in zip(part, row, strict=True))
    return kinds


def _present(db, project, paths):
    """SQL absence differs from an explicitly stored JSON null precondition."""
    return {key for key, kind in _types(db, project, paths).items() if kind is not None}


def _objects(db, project, paths):
    for key, kind in _types(db, project, paths).items():
        if (kind is not None or not paths[key]) and str(kind).lower() != "object":
            _fail("quality_scope_unavailable", "The original proof source shape cannot be verified.")


class _Scope:
    def __init__(self, db, project, requirements, tasks, limit):
        self.db, self.project, self.limit = db, project, limit
        self.wanted_requirements, self.wanted_tasks = set(requirements), set(tasks)
        self.tasks, self.requirements, self.entries = {}, {}, {}
        self.data = initial_state()
        self.run_ids, self.latest_loaded = set(), set()

    def budget(self, count):
        if count > self.limit:
            _fail(
                "quality_scope_too_large",
                "The complete quality proof exceeds its bounded read budget; narrow the scope.",
                413,
            )

    def facts(self, kind, ids):
        if not ids:
            return {}
        rows = self.db.execute(
            select(DeliveryQueryFact.entity_id, DeliveryQueryFact.data).where(
                *scope(self.project, DeliveryQueryFact),
                DeliveryQueryFact.kind == kind,
                DeliveryQueryFact.entity_id.in_(ids),
            )
        ).all()
        return dict(rows)

    def tasks_and_parents(self):
        condition = or_(Task.id.in_(self.wanted_tasks), Task.req_id.in_(self.wanted_requirements))
        filters = (*scope(self.project, Task), condition)
        self.budget(self.db.scalar(select(func.count()).select_from(Task).where(*filters)))
        new = self.db.scalars(
            select(Task).where(*filters, Task.id.not_in(self.tasks)).execution_options(populate_existing=True)
        ).all()
        self.tasks.update({row.id: row for row in new})
        if self.wanted_tasks - self.tasks.keys():
            _fail(
                "release_scope_not_found",
                "A selected item or proof dependency is missing or outside this project.",
                404,
            )
        self.wanted_requirements.update(row.req_id for row in new if row.req_id)
        needed = self.wanted_requirements - self.requirements.keys()
        rows = (
            self.db.scalars(
                select(Requirement)
                .where(*scope(self.project, Requirement), Requirement.id.in_(needed))
                .execution_options(populate_existing=True)
            ).all()
            if needed
            else []
        )
        self.requirements.update({row.id: row for row in rows})
        if self.wanted_requirements - self.requirements.keys():
            _fail(
                "release_scope_not_found",
                "A requirement needed by this scope is missing or outside this project.",
                404,
            )
        planning_fields = (
            "depends_on",
            "requirement_criteria_indices",
            "requirement_basis",
            "blocked_reason",
        )
        paths = {row.id: ("task_details", row.id) for row in new}
        values = _paths(self.db, self.project, paths)
        null_plans = _present(
            self.db, self.project, {id: path for id, path in paths.items() if values[id] is None}
        )
        for row in new:
            if row.id in null_plans:
                _fail("quality_scope_unavailable", "The original task plan cannot be verified.")
            original = values[row.id] if values[row.id] is not None else {}
            if not isinstance(original, dict):
                _fail("quality_scope_unavailable", "The original task plan cannot be verified.")
            planning = {key: original[key] for key in planning_fields if key in original}
            dependencies = planning.get("depends_on", [])
            if not isinstance(dependencies, list) or any(
                not isinstance(value, str) or not value for value in dependencies
            ):
                _fail("quality_scope_unavailable", "The original dependency plan cannot be verified.")
            self.wanted_tasks.update(dependencies)
            self.budget(len(self.wanted_tasks))
            self.data["task_details"][row.id] = planning
        self.flows(rows)

    def flows(self, rows):
        fields = ("stage", "revision", "blocked_reason", "definition", "tested_work")
        _objects(self.db, self.project, {row.id: ("flows", row.id) for row in rows})
        values = _paths(
            self.db, self.project, {(row.id, key): ("flows", row.id, key) for row in rows for key in fields}
        )
        facts = self.facts("requirement", {row.id for row in rows})
        nullable = {
            (row.id, key): ("flows", row.id, key)
            for row in rows
            for key in fields
            if values[(row.id, key)] is None
        }
        present = _present(self.db, self.project, nullable)
        sources = {}
        for row in rows:
            if values[(row.id, "stage")] is None:
                continue
            positions = facts.get(row.id, {}).get("quality_positions")
            if not isinstance(positions, dict) or set(positions) != {"test", "acceptance"}:
                _fail(
                    "delivery_query_rebuild_required",
                    "Current acceptance source locations require an explicit rebuild.",
                )
            flow = {
                key: values[(row.id, key)]
                for key in fields
                if values[(row.id, key)] is not None or (row.id, key) in present
            }
            flow.update(artifacts=[], reviews=[])
            self.data["flows"][row.id] = flow
            for kind, position in positions.items():
                if position is None:
                    continue
                if type(position) is not int or position < 0:
                    _fail(
                        "delivery_query_cursor_stale",
                        "An acceptance source location changed; reload the scope.",
                    )
                sources[(row.id, kind)] = (
                    "flows",
                    row.id,
                    "artifacts" if kind == "test" else "reviews",
                    position,
                )
        records = _paths(self.db, self.project, sources)
        for (id, kind), record in records.items():
            flow = self.data["flows"][id]
            if (
                not isinstance(record, dict)
                or record.get("revision") != flow["revision"]
                or (
                    record.get("kind") != "test"
                    if kind == "test"
                    else record.get("stage") != "acceptance" or record.get("decision") != "approved"
                )
            ):
                _fail("delivery_query_cursor_stale", "An acceptance source changed; reload the scope.")
            flow["artifacts" if kind == "test" else "reviews"].append(record)

    def read_entries(self, facts):
        if len(self.entries) + len(facts) > self.limit * 3 + 200:
            self.budget(self.limit + 1)
        values = _paths(
            self.db, self.project, {id: ("executions", row["position"]) for id, row in facts.items()}
        )
        for id, entry in values.items():
            if (
                not isinstance(entry, dict)
                or entry.get("id") != id
                or entry.get("task_id") != facts[id].get("task_id")
            ):
                _fail(
                    "delivery_query_cursor_stale", "An execution source changed; reload this quality scope."
                )
            self.entries[id] = (facts[id]["position"], entry)
            self.wanted_tasks.add(entry["task_id"])
        self.budget(len(self.wanted_tasks))

    def execution_inputs(self):
        needed = self.tasks.keys() - self.latest_loaded
        facts = self.facts("task", needed)
        if needed - facts.keys():
            _fail("delivery_query_rebuild_required", "Current task proof facts require an explicit rebuild.")
        ids = {value.get("execution_id") for value in facts.values()} - {None, ""}
        entries = self.facts("execution", ids)
        if ids - entries.keys():
            _fail(
                "delivery_query_rebuild_required",
                "Current execution proof facts require an explicit rebuild.",
            )
        self.read_entries(entries)
        self.latest_loaded.update(needed)
        runs = {
            item.get("run_id")
            for flow in self.data["flows"].values()
            for item in flow["artifacts"]
            if item.get("source") == "execution-runtime"
        } - {None, ""}
        needed_runs = runs - self.run_ids
        if needed_runs:
            fact = DeliveryQueryFact
            ranked = (
                select(
                    fact.entity_id,
                    fact.data,
                    func.row_number()
                    .over(
                        partition_by=fact.data["run_id"].as_string(),
                        order_by=fact.data["position"].as_integer().desc(),
                    )
                    .label("rank"),
                )
                .where(
                    *scope(self.project, fact),
                    fact.kind == "execution",
                    fact.data["run_id"].as_string().in_(needed_runs),
                )
                .subquery()
            )
            rows = self.db.execute(select(ranked.c.entity_id, ranked.c.data).where(ranked.c.rank == 1)).all()
            self.read_entries(dict(rows))
            self.run_ids.update(needed_runs)

    def team(self):
        entries = [value[1] for value in self.entries.values()]
        owners = {row.owner_id for row in self.tasks.values() if row.owner_id}
        executor_ids = {
            entry["executor_member_id"]
            for entry in entries
            if entry.get("executor_member_id") and not entry.get("run_id")
        }
        resources = {value for value in owners | executor_ids if not value.startswith("user:")}
        facts = self.facts("member", resources)
        positions = {}
        for id, fact in facts.items():
            if "registry_positions" not in fact:
                _fail(
                    "delivery_query_rebuild_required",
                    "Current member proof locations require an explicit rebuild.",
                )
            for position in fact["registry_positions"]:
                if type(position) is not int or position < 0:
                    _fail("delivery_query_cursor_stale", "Member proof locations changed; reload the scope.")
                positions[(id, position)] = ("members", position)
        self.budget(len(positions))
        members = _paths(self.db, self.project, positions)
        for (id, _), value in members.items():
            if not isinstance(value, dict) or value.get("id") != id:
                _fail("delivery_query_cursor_stale", "A member source changed; reload the scope.")
            self.data["members"].append(value)
        bindings = _paths(self.db, self.project, {id: ("member_runtime_bindings", id) for id in executor_ids})
        self.data["member_runtime_bindings"] = {
            id: value for id, value in bindings.items() if value is not None
        }
        return TeamContext(self.db, self.project, self.data, owner_ids=owners)

    def context(self):
        _objects(
            self.db,
            self.project,
            {
                "workspace": (),
                "task_details": ("task_details",),
                "flows": ("flows",),
            },
        )
        while True:
            before = (
                len(self.tasks),
                len(self.requirements),
                len(self.wanted_tasks),
                len(self.wanted_requirements),
            )
            self.tasks_and_parents()
            self.execution_inputs()
            after = (
                len(self.tasks),
                len(self.requirements),
                len(self.wanted_tasks),
                len(self.wanted_requirements),
            )
            if before == after:
                break
        self.validate_depth()
        ids = set(self.tasks)
        issues_query = select(Issue).where(
            *scope(self.project, Issue),
            Issue.task_id.in_(ids),
            Issue.severity.in_(["P0", "P1"]),
            Issue.status.not_in(["resolved", "closed"]),
        )
        self.budget(self.db.scalar(select(func.count()).select_from(issues_query.subquery())))
        issues = self.db.scalars(issues_query.execution_options(populate_existing=True)).all()
        latest = (
            select(func.max(DeliveryTaskReview.seq).label("seq"))
            .where(*scope(self.project, DeliveryTaskReview), DeliveryTaskReview.task_id.in_(ids))
            .group_by(DeliveryTaskReview.task_id)
            .subquery()
        )
        snapshot_bytes = (
            func.length(cast(DeliveryTaskReview.snapshot, LargeBinary))
            if self.db.bind.dialect.name == "sqlite"
            else func.octet_length(cast(DeliveryTaskReview.snapshot, Text))
        )
        sizes = self.db.scalars(
            select(snapshot_bytes).join(latest, DeliveryTaskReview.seq == latest.c.seq)
        ).all()
        if any((size or 0) > 1024 * 1024 for size in sizes):
            _fail("quality_scope_too_large", "A complete proof source exceeds its bounded read budget.", 413)
        reviews = self.db.scalars(
            select(DeliveryTaskReview)
            .join(latest, DeliveryTaskReview.seq == latest.c.seq)
            .options(
                load_only(
                    DeliveryTaskReview.id,
                    DeliveryTaskReview.task_id,
                    DeliveryTaskReview.created_at,
                    DeliveryTaskReview.reviewer_id,
                    DeliveryTaskReview.decision,
                    DeliveryTaskReview.task_basis,
                    DeliveryTaskReview.snapshot,
                    DeliveryTaskReview.invalidated,
                )
            )
            .execution_options(populate_existing=True)
        ).all()
        self.data["executions"] = [
            row for _, row in sorted(self.entries.values(), key=lambda value: value[0])
        ]
        context = VerificationContext(
            self.db,
            self.project,
            self.data,
            tasks=self.tasks.values(),
            requirements=self.requirements.values(),
            issues=issues,
            reviews=reviews,
            team=self.team(),
        )
        reconcile(self.db, self.project, self.data, verification=context)
        return context

    def validate_depth(self):
        """Bound the existing recursive canonical algorithms before calling them."""
        dependents, degree, depth = defaultdict(set), {}, {}
        for id in self.tasks:
            dependencies = set(self.data["task_details"][id].get("depends_on", []))
            degree[id] = len(dependencies)
            for predecessor in dependencies:
                dependents[predecessor].add(id)
        ready = deque(id for id, count in degree.items() if not count)
        while ready:
            id = ready.popleft()
            depth.setdefault(id, 1)
            if depth[id] > 64:
                self.budget(self.limit + 1)
            for next_id in dependents[id]:
                depth[next_id] = max(depth.get(next_id, 1), depth[id] + 1)
                degree[next_id] -= 1
                if not degree[next_id]:
                    ready.append(next_id)
        if any(degree.values()):
            _fail("quality_scope_unavailable", "A cyclic dependency proof cannot be reviewed.")


def _selection(requirement_ids, task_ids, task_limit):
    requirements, tasks = _ids(requirement_ids), _ids(task_ids)
    if not requirements and not tasks:
        _fail("release_scope_missing", "Select an explicit requirement or independent task scope.", 422)
    if type(task_limit) is not int or task_limit < 1:
        _fail("quality_scope_limit_invalid", "The quality proof budget must be positive.", 422)
    return requirements, tasks


def load_task_scope(db, project, task_id, *, task_limit=500):
    """A task's complete canonical proof, including linked requirement siblings."""
    requirements, tasks = _selection([], [task_id], task_limit)
    with db.no_autoflush:
        return _Scope(db, project, requirements, tasks, task_limit).context()


def load_quality_scope(db, project, *, requirement_ids, task_ids, task_limit=500):
    """Caller owns authority and query-generation checks; this function never writes."""
    requirements, tasks = _selection(requirement_ids, task_ids, task_limit)
    with db.no_autoflush:
        selected = (
            dict(
                db.execute(
                    select(Task.id, Task.req_id).where(*scope(project, Task), Task.id.in_(tasks))
                ).all()
            )
            if tasks
            else {}
        )
        if tasks - selected.keys():
            _fail("release_scope_not_found", "A selected item is missing or outside this project.", 404)
        if any(selected.values()):
            _fail(
                "release_task_scope_invalid",
                "Select a linked task through its complete requirement scope.",
                422,
            )
        return _Scope(db, project, requirements, tasks, task_limit).context()
