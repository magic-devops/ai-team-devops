import type { EventReceiptDetail, EventReceiptPage } from "./eventReceipts";
export function eventDetailFixture(): EventReceiptDetail {
  return {
    project_id: "P",
    as_of: "2026-10-18T00:00:00Z",
    event: {
      id: "R",
      event_id: "original-event",
      digest: "a".repeat(64),
      type: "sop.issue.opened",
      subject: "source-task",
      source: "untrusted sender description",
      producer: { kind: "user", id: "actual-user" },
      stored_at: "2026-10-18T00:00:00Z",
      processing: {
        state: "failed",
        revision: 3,
        handler: "issue",
        operation_id: "R",
        attempts: 1,
        updated_at: "2026-10-18T00:01:00Z",
        processed_at: null,
        reason_code: "temporary_failure",
        retryable: true,
        result: null,
      },
    },
    event_json: '{"id":"original-event","data":{"private":"cached secret"}}',
    attempts: {
      project_id: "P",
      receipt_id: "R",
      as_of: "2026-10-18T00:01:00Z",
      items: [
        {
          id: "A1",
          seq: 1,
          actor: { kind: "user", id: "actual-user" },
          action: "initial",
          created_at: "2026-10-18T00:01:00Z",
          from_state: "pending",
          to_state: "failed",
          error: {
            code: "temporary_failure",
            message: "Processing unavailable",
            retryable: true,
          },
          result: null,
        },
      ],
      total: 24,
      limit: 20,
      has_more: true,
      next_cursor: "attempt/+next",
    },
    permissions: { read: true, configure: true },
    capabilities: { retry: true, retry_reason_code: null },
  };
}
export function eventPageFixture(): EventReceiptPage {
  return {
    project_id: "P",
    as_of: "2026-10-18T00:00:00Z",
    items: [eventDetailFixture().event],
    total: 43,
    limit: 20,
    has_more: true,
    next_cursor: "event/+next",
    permissions: { read: true, configure: true },
  };
}
