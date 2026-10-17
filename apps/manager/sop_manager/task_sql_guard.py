"""Task acceptance validation at typed SQL bind and Session execution boundaries."""

from collections.abc import Mapping

from sqlalchemy import JSON, event
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import BindParameter, ClauseElement
from sqlalchemy.types import TypeDecorator
from sqlalchemy.util import immutabledict

from .task_acceptance import normalize_task_acceptance

_CRITERIA = "acceptance_criteria"


class TaskAcceptanceJSON(TypeDecorator):
    impl = JSON
    cache_ok = True
    should_evaluate_none = True

    def process_bind_param(self, value, dialect):
        return normalize_task_acceptance(value)

    def coerce_compared_value(self, op, value):
        return self.impl.coerce_compared_value(op, value)


def _name(key):
    return key if isinstance(key, str) else getattr(key, "key", None)


class _CheckedWrite:
    """Validate complete parameter batches before progress hooks or SQL execute."""

    def __init__(self, state):
        self.state = state
        parameters = state.parameters
        self.rows = [dict(row) for row in parameters] if isinstance(parameters, (list, tuple)) else [dict(parameters)] if parameters is not None else []
        for row in self.rows:
            for key in row:
                if _name(key) == _CRITERIA:
                    row[key] = normalize_task_acceptance(row[key])

    def value(self, value):
        if isinstance(value, BindParameter):
            return self.bound(value)
        if isinstance(value, ClauseElement):
            raise ValueError("acceptance_criteria SQL expression cannot be validated; provide text criteria")
        return normalize_task_acceptance(value)

    def bound(self, value):
        if value.callable is not None or value.expanding:
            raise ValueError("acceptance_criteria dynamic parameter expression cannot be validated")
        # ORM bulk INSERT is not yet compilable at this hook. Explicit names
        # already identify external parameters; anonymous values bind to the column.
        key = _CRITERIA if value.unique else value.key
        needs_default = not self.rows
        for row in self.rows:
            parameter_key = key if key in row else value.key
            if parameter_key in row:
                row[parameter_key] = normalize_task_acceptance(row[parameter_key])
            else:
                needs_default = True
        if not needs_default:
            return value
        if value.required:
            raise ValueError("acceptance_criteria bound parameter is required")
        return value._with_value(normalize_task_acceptance(value.value), maintain_key=True)

    def values(self, values):
        return {key: self.value(value) if _name(key) == _CRITERIA else value for key, value in values.items()}

    def statement(self):
        original = self.state.statement
        statement = original._generate()
        if _CRITERIA in (getattr(original, "_select_names", None) or []):
            raise ValueError("acceptance_criteria INSERT SELECT expression cannot be validated")
        if getattr(original, "_values", None):
            statement._values = immutabledict(self.values(original._values))
        if getattr(original, "_ordered_values", None):
            statement._ordered_values = [(key, self.value(value) if _name(key) == _CRITERIA else value)
                                         for key, value in original._ordered_values]
        if getattr(original, "_multi_values", None):
            groups = []
            for group in original._multi_values:
                if any(not isinstance(row, Mapping) for row in group):
                    raise ValueError("acceptance_criteria multirow inserts require named column values")
                groups.append([self.values(row) for row in group])
            statement._multi_values = tuple(groups)
        post = getattr(original, "_post_values_clause", None)
        if post is not None:
            statement._post_values_clause = post = post._clone()
            if hasattr(post, "update_values_to_set"):
                current = post.update_values_to_set
                checked = self.values(dict(current))
                post.update_values_to_set = checked if isinstance(current, Mapping) else list(checked.items())
            elif hasattr(post, "update"):
                post.update = self.values(post.update)
        return statement


def _validate_task_write(state):
    if not (state.is_update or state.is_insert):
        return
    table = getattr(state.statement, "table", None)
    if table is None or table.name != "tasks" or _CRITERIA not in table.c:
        return
    checked = _CheckedWrite(state)
    statement = checked.statement()
    # Assign only after the full batch has passed. Caller-owned values stay intact.
    state.statement = statement
    if state.parameters is not None:
        state.parameters = checked.rows if isinstance(state.parameters, (list, tuple)) else checked.rows[0]


def install_task_sql_guard():
    if not event.contains(Session, "do_orm_execute", _validate_task_write):
        event.listen(Session, "do_orm_execute", _validate_task_write)
