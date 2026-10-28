"""Actual SDK/SQLite bridge for the reflection effect contract tests."""

import json
import sys

from sop_sdk.event_envelope import EventIdentity, FrozenEvent, matching_receipts
from sop_sdk.event_outbox import EventOutbox
from sop_sdk.reflection_intake import freeze_reflection

operation, path, *arguments = sys.argv[1:]
with EventOutbox(path) as box:
    if operation == "enqueue":
        event = freeze_reflection(
            {"schema_version": 1, "category": "testing", "title": "原题 é", "observation": "原字节 < & >"},
            event_id="reflection-from-python",
            time="2026-10-19T00:00:00Z",
        )
        result = {"input": event.item(), "queued": box.enqueue(event, "P")}
    elif operation == "inspect":
        result = {"record": box.inspect(arguments[0])}
    elif operation == "ack":
        row = box.inspect(arguments[0])
        event = FrozenEvent.from_json(row["event_json"], digest=row["digest"])
        identity = EventIdentity("T", "P", "U", "http://manager")
        receipt = json.loads(arguments[1])
        response = {
            "tenant_id": "T", "project_id": "P", "producer": {"kind": "user", "id": "U"},
            "as_of": "2026-10-19T00:00:00Z", "results": [receipt],
        }
        verified = matching_receipts([event], response, identity)[event.id]
        box.ack(event.id, row["revision"], verified)
        result = {"record": box.inspect(event.id)}
    else:
        raise AssertionError(operation)
print(json.dumps(result, ensure_ascii=False))
