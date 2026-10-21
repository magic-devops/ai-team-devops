"""Real HTTP transport definitions for design originals; execution is deferred."""
from copy import deepcopy
import json

import httpx
import pytest

from sop_sdk.design_original import design_command_body, design_preview_body, load_design_original
from sop_sdk.errors import SopTransportError
from test_delivery_task_submissions import client_for


def original():
    return {"action": "design.revision.save", "expected_version": 7, "idempotency_key": "fixed-design-original",
        "payload": {"document_id": "DES-1", "document_version": 2, "base_revision_id": "REV-1",
            "base_revision_digest": "a" * 64, "title": "Architecture", "content": "完整设计正文" * 3000}}


def proposal():
    return {"base_revision_id": "REV-1", "base_revision_digest": "a" * 64, "mode": "free",
        "instructions": "完善错误恢复", "idempotency_key": "fixed-preview-original"}


def test_reads_keep_exact_ids_scope_one_page_and_source_filter():
    calls = []
    with client_for(lambda request: calls.append(request) or httpx.Response(200, json={"items": [], "next_cursor": "more"})) as client:
        client.design_documents(q="_literal%", include_archived=True, limit=1, cursor="cursor +/=?")
        client.design_document("DES-1")
        client.design_revisions("DES-1", limit=1, cursor="history +/=?")
        client.design_revision("DES-1", "REV-1")
        client.design_compare("DES-1", "REV-1", "REV-2")
        client.delivery_designs("task", "任务 一")
        client.delivery_designs("requirement", "需求 一")
        client.design_preview("DES-1", "G-1")
        client.delivery_issues(source="external", limit=1)
    assert len(calls) == 9 and all(call.headers["X-Project-Id"] == "P" for call in calls)
    assert dict(calls[0].url.params) == {"q": "_literal%", "include_archived": "true", "limit": "1", "cursor": "cursor +/=?"}
    assert calls[3].url.path.endswith("/DES-1/revisions/REV-1")
    assert dict(calls[4].url.params) == {"from": "REV-1", "to": "REV-2"}
    assert calls[5].url.path == "/api/v1/delivery/tasks/任务 一/designs"
    assert dict(calls[8].url.params) == {"source": "external", "limit": "1"}


def test_saved_write_and_ai_replay_do_not_fetch_replace_or_truncate():
    calls = []
    def transport(request):
        calls.append(request)
        if len(calls) == 1:
            raise httpx.ReadError("reply lost", request=request)
        return httpx.Response(200, json={"status": "generating"})
    body = original()
    with client_for(transport) as client:
        with pytest.raises(SopTransportError):
            client.design_command(body)
        client.design_command(deepcopy(body))
        client.design_generate_preview("DES-1", proposal())
        client.design_generate_preview("DES-1", proposal())
    assert calls[0].content == calls[1].content and json.loads(calls[0].content) == body
    assert calls[2].content == calls[3].content and len(calls) == 4
    assert all(call.method == "POST" for call in calls)


def test_adoption_preview_uses_the_real_transport_signature_without_a_business_write():
    calls = []
    body = {"operation": "clear", "slot": "prd", "target_basis": "a" * 64, "design_basis": "b" * 64}
    with client_for(lambda request: calls.append(request) or httpx.Response(200, json={"allowed": False})) as client:
        client.delivery_design_adoption_preview("task", "任务 一", body)
    assert len(calls) == 1 and calls[0].method == "POST"
    assert calls[0].url.path == "/api/v1/delivery/tasks/任务 一/design-adoption-preview"
    assert json.loads(calls[0].content) == body


@pytest.mark.parametrize("value", ["", "../other", "doc/other", "doc\\other", "x" * 65, "doc\x00", "\ud800"])
def test_invalid_exact_source_never_reaches_transport(value):
    with client_for(lambda _request: pytest.fail("invalid input reached HTTP")) as client:
        with pytest.raises(ValueError):
            client.design_revision("DES-1", value)


@pytest.mark.parametrize("mutation", ["key", "version", "action", "extra", "nan", "oversize"])
def test_original_cannot_infer_or_coerce_missing_values(mutation):
    body = original()
    if mutation == "key": del body["idempotency_key"]
    elif mutation == "version": body["expected_version"] = True
    elif mutation == "action": body["action"] = "task.update"
    elif mutation == "extra": body["source_reference"] = {}
    elif mutation == "nan": body["payload"]["number"] = float("nan")
    else: body["payload"]["content"] = "中" * 200000
    with pytest.raises(ValueError):
        design_command_body(body)


def test_file_rejects_duplicate_and_nonfinite_json_and_retains_original(tmp_path):
    file = tmp_path / "original.json"
    for raw in [b'{"action":"design.document.create","action":"design.revision.save"}', b'{"value":NaN}', b'\xff']:
        file.write_bytes(raw)
        with pytest.raises(ValueError): load_design_original(file)
        assert file.read_bytes() == raw
    raw = json.dumps(original(), ensure_ascii=False).encode("utf-8")
    file.write_bytes(raw)
    assert load_design_original(file) == original() and file.read_bytes() == raw


def test_ai_preview_requires_explicit_exact_source_and_free_instructions():
    for field, value in [("base_revision_digest", "bad"), ("idempotency_key", "short"),
            ("mode", []), ("instructions", ""), ("base_revision_id", "../other")]:
        with pytest.raises(ValueError): design_preview_body({**proposal(), field: value})
