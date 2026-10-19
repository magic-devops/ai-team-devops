"""SQL byte prechecks shared by complete canonical proofs."""

from fastapi import HTTPException
from sqlalchemy import LargeBinary, cast, func, select

from . import sql_models as m
from .delivery_query_index import scope


class CanonicalInputBudget:
    """Measure every decoded input before transfer, including repeated reads."""

    def __init__(self, budget, *, code, max_bytes=16777216, max_item_bytes=1048576):
        self.budget, self.code = budget, code
        self.max_bytes, self.max_item_bytes = max_bytes, max_item_bytes

    def consume(self, total, largest):
        self.budget["bytes_used"] = (self.budget["bytes_used"] or 0) + (total or 0)
        if (largest or 0) > self.max_item_bytes or self.budget["bytes_used"] > self.max_bytes:
            raise HTTPException(
                413,
                {
                    "code": self.code,
                    "message": "The complete canonical proof exceeds its explicit source-input budget",
                },
            )

    def rows(self, db, query, columns):
        pairs = [part for column in columns for part in (column.key, column)]
        size = func.length(cast(func.json_object(*pairs), LargeBinary)).label("input_bytes")
        measured = (
            query.with_only_columns(size, maintain_column_froms=True)
            .order_by(None)
            .subquery("measured_canonical_inputs")
        )
        total, largest = db.execute(
            select(
                func.coalesce(func.sum(measured.c.input_bytes), 0),
                func.coalesce(func.max(measured.c.input_bytes), 0),
            )
        ).one()
        self.consume(total, largest)

    def paths(self, db, project, paths):
        values = list(paths.values())
        for start in range(0, len(values), 100):
            batch = values[start : start + 100]
            sizes = db.execute(
                select(
                    *[func.length(cast(m.DeliveryWorkspace.data[tuple(path)], LargeBinary)) for path in batch]
                ).where(*scope(project, m.DeliveryWorkspace))
            ).first()
            if sizes:
                self.consume(sum(value or 0 for value in sizes), max(value or 0 for value in sizes))
