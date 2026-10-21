package outbox_test

import (
	"testing"

	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/outbox"
)

func TestSubmissionReceiptRequiresSavedOriginalProof(t *testing.T) {
	for _, mutation := range []string{"valid", "pending", "wrong_handler", "wrong_target", "unsafe_id", "missing_time", "no_attempt", "wrong_effect"} {
		t.Run(mutation, func(t *testing.T) {
			in := input(t, "E")
			r := receipt(in)
			kind, target, handler := "task_submission", "submission-1", "task.delivery.submit"
			at := "2026-10-21T00:00:00Z"
			r.Processing = &outbox.Processing{State: "processed", Revision: 2, Handler: &handler, Attempts: 1,
				UpdatedAt: at, ProcessedAt: &at, Result: &outbox.EffectResult{Kind: "task_delivery_submitted", TargetKind: &kind, TargetID: &target}}
			switch mutation {
			case "pending":
				r.Processing.State = "pending"
			case "wrong_handler":
				handler = "task.update"
			case "wrong_target":
				kind = "task"
			case "unsafe_id":
				target = "../report"
			case "missing_time":
				r.Processing.ProcessedAt = nil
			case "no_attempt":
				r.Processing.Attempts = 0
			case "wrong_effect":
				r.Processing.Result.Kind = "task_updated"
			}
			err := r.Validate(in.ID, in.Digest)
			if (err == nil) != (mutation == "valid") {
				t.Fatalf("%s receipt validation mismatch: %v", mutation, err)
			}
		})
	}
}
