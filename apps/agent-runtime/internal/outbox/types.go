package outbox

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type QueueError struct {
	Code    string
	Message string
}

func (e *QueueError) Error() string   { return e.Code + ": " + e.Message }
func fail(code, message string) error { return &QueueError{code, message} }
func ErrorCode(err error) string {
	if e, ok := err.(*QueueError); ok {
		return e.Code
	}
	return "queue_error"
}

type Event struct {
	SpecVersion     string         `json:"specversion"`
	ID              string         `json:"id"`
	Type            string         `json:"type"`
	Source          string         `json:"source"`
	Subject         string         `json:"subject"`
	Time            string         `json:"time"`
	DataContentType string         `json:"datacontenttype"`
	Data            map[string]any `json:"data"`
}

type Scope struct {
	TenantID      string `json:"expected_tenant_id"`
	ProjectID     string `json:"expected_project_id"`
	ProducerID    string `json:"expected_producer_id"`
	ManagerOrigin string `json:"manager_origin"`
}
type EnqueueInput struct {
	ID                string `json:"id"`
	EventJSON         string `json:"event_json"`
	Digest            string `json:"digest"`
	IntendedProjectID string `json:"intended_project_id"`
	Scope             *Scope `json:"-"`
}
type Record struct {
	ID                 string  `json:"id"`
	Type               string  `json:"type"`
	Subject            string  `json:"subject"`
	EventJSON          string  `json:"event_json"`
	Digest             string  `json:"digest"`
	IntendedProjectID  string  `json:"intended_project_id"`
	BindingState       string  `json:"binding_state"`
	ExpectedTenantID   *string `json:"expected_tenant_id"`
	ExpectedProjectID  *string `json:"expected_project_id"`
	ExpectedProducerID *string `json:"expected_producer_id"`
	ManagerOrigin      *string `json:"manager_origin"`
	State              string  `json:"state"`
	Revision           int64   `json:"revision"`
	Attempts           int64   `json:"attempts"`
	NextAtMS           int64   `json:"next_at_ms"`
	CreatedAtMS        int64   `json:"created_at_ms"`
	UpdatedAtMS        int64   `json:"updated_at_ms"`
	LastAttemptAtMS    *int64  `json:"last_attempt_at_ms"`
	LastErrorCode      *string `json:"last_error_code"`
	LastErrorMessage   *string `json:"last_error_message"`
	LastErrorRetryable *bool   `json:"last_error_retryable"`
	DeadAtMS           *int64  `json:"dead_at_ms"`
	ReceiptID          *string `json:"receipt_id"`
	ReceiptOutcome     *string `json:"receipt_outcome"`
	RemoteStoredAt     *string `json:"remote_stored_at"`
	ProcessingState    *string `json:"processing_state"`
	RemoteReceiptJSON  *string `json:"remote_receipt_json"`
	AckedAtMS          *int64  `json:"acked_at_ms"`
}

func (r Record) Scope() *Scope {
	if r.BindingState != "bound" || r.ExpectedTenantID == nil || r.ExpectedProjectID == nil || r.ExpectedProducerID == nil || r.ManagerOrigin == nil {
		return nil
	}
	return &Scope{*r.ExpectedTenantID, *r.ExpectedProjectID, *r.ExpectedProducerID, *r.ManagerOrigin}
}
func (r Record) Metadata() map[string]any {
	return map[string]any{"id": r.ID, "type": r.Type, "subject": r.Subject, "digest": r.Digest, "intended_project_id": r.IntendedProjectID, "binding_state": r.BindingState, "expected_tenant_id": r.ExpectedTenantID, "expected_project_id": r.ExpectedProjectID, "expected_producer_id": r.ExpectedProducerID, "manager_origin": r.ManagerOrigin, "state": r.State, "revision": r.Revision, "attempts": r.Attempts, "next_at_ms": r.NextAtMS, "created_at_ms": r.CreatedAtMS, "updated_at_ms": r.UpdatedAtMS, "last_attempt_at_ms": r.LastAttemptAtMS, "last_error_code": r.LastErrorCode, "last_error_message": r.LastErrorMessage, "last_error_retryable": r.LastErrorRetryable, "dead_at_ms": r.DeadAtMS, "receipt_id": r.ReceiptID, "receipt_outcome": r.ReceiptOutcome, "remote_stored_at": r.RemoteStoredAt, "processing_state": r.ProcessingState, "acked_at_ms": r.AckedAtMS}
}

type MutationResult struct {
	ID       string `json:"id"`
	Digest   string `json:"digest"`
	State    string `json:"state"`
	Revision int64  `json:"revision"`
	Replayed bool   `json:"replayed"`
}

func result(r Record, replayed bool) MutationResult {
	return MutationResult{r.ID, r.Digest, r.State, r.Revision, replayed}
}

type Failure struct {
	Code      string
	Message   string
	Retryable bool
}
type RequeueInput struct {
	ID               string `json:"id"`
	ExpectedRevision int64  `json:"expected_revision"`
	Reason           string `json:"reason"`
	IdempotencyKey   string `json:"idempotency_key"`
}
type ListInput struct {
	State  string `json:"state"`
	Limit  int    `json:"limit"`
	Cursor string `json:"cursor"`
}
type ListResult struct {
	QueueID    string           `json:"queue_id"`
	Generation int64            `json:"generation"`
	Items      []map[string]any `json:"items"`
	Total      int64            `json:"total"`
	Limit      int              `json:"limit"`
	HasMore    bool             `json:"has_more"`
	NextCursor *string          `json:"next_cursor"`
}
type LastError struct {
	ID        string `json:"id"`
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
	AtMS      *int64 `json:"at_ms"`
}
type Stats struct {
	QueueID           string     `json:"queue_id"`
	Generation        int64      `json:"generation"`
	Pending           int64      `json:"pending"`
	Due               int64      `json:"due"`
	DeadLetter        int64      `json:"dead_letter"`
	Acked             int64      `json:"acked"`
	OldestPendingAtMS *int64     `json:"oldest_pending_at_ms"`
	LastAckAtMS       *int64     `json:"last_ack_at_ms"`
	LastError         *LastError `json:"last_error"`
}
type RemoteReceipt struct {
	ID         string      `json:"id"`
	Digest     string      `json:"digest"`
	Outcome    string      `json:"outcome"`
	ReceiptID  *string     `json:"receipt_id"`
	StoredAt   *string     `json:"stored_at"`
	Processing *Processing `json:"processing"`
	Error      *EventError `json:"error"`
}
type Processing struct {
	State       string        `json:"state"`
	Revision    int64         `json:"revision"`
	Handler     *string       `json:"handler"`
	OperationID *string       `json:"operation_id"`
	Attempts    int64         `json:"attempts"`
	UpdatedAt   string        `json:"updated_at"`
	ProcessedAt *string       `json:"processed_at"`
	ReasonCode  *string       `json:"reason_code"`
	Retryable   bool          `json:"retryable"`
	Result      *EffectResult `json:"result"`
}
type EffectResult struct {
	Kind       string  `json:"kind"`
	TargetKind *string `json:"target_kind"`
	TargetID   *string `json:"target_id"`
}
type EventError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}
type MigrationResult struct {
	Migrated   int64 `json:"migrated"`
	DeadLetter int64 `json:"dead_letter"`
}

func (s Scope) Validate() error {
	if s.TenantID == "" || s.ProjectID == "" || s.ProducerID == "" || s.ManagerOrigin == "" {
		return fail("scope_mismatch", "complete verified identity/origin required")
	}
	return nil
}

var rfc3339Syntax = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$`)
var submissionIdentity = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`)

func validTime(value string) bool {
	if !rfc3339Syntax.MatchString(value) || strings.HasPrefix(value, "0000-") {
		return false
	}
	last := value[len(value)-1]
	if last != 'Z' && last != 'z' {
		offset := value[len(value)-6:]
		hours, _ := strconv.Atoi(offset[1:3])
		minutes, _ := strconv.Atoi(offset[4:6])
		if hours >= 24 || minutes >= 60 {
			return false
		}
	}
	_, err := time.Parse(time.RFC3339Nano, strings.ToUpper(value))
	return err == nil
}

func (r RemoteReceipt) Validate(id, digest string) error {
	if r.ID != id || r.Digest != digest || (r.Outcome != "stored" && r.Outcome != "duplicate") || r.ReceiptID == nil || *r.ReceiptID == "" || r.StoredAt == nil || !validTime(*r.StoredAt) || r.Processing == nil || r.Error != nil {
		return fail("receipt_invalid", fmt.Sprintf("invalid durable receipt for %s", id))
	}
	p := r.Processing
	if p.Revision < 1 || p.Attempts < 0 || !validTime(p.UpdatedAt) || (p.ProcessedAt != nil && !validTime(*p.ProcessedAt)) {
		return fail("receipt_invalid", "invalid processing revision/attempts/timestamp")
	}
	if p.Result != nil {
		if p.Result.TargetKind != nil && *p.Result.TargetKind == "task_submission" && p.Result.Kind != "task_delivery_submitted" {
			return fail("receipt_invalid", "submission target requires a submitted report effect")
		}
		if p.Result.TargetKind != nil && *p.Result.TargetKind == "reflection" && p.Result.Kind != "reflection_recorded" {
			return fail("receipt_invalid", "reflection target requires a recorded reflection effect")
		}
		switch p.Result.Kind {
		case "fact_recorded", "task_updated", "issue_created", "record_upserted", "record_deleted", "asset_materialized":
		case "task_delivery_submitted":
			if p.Result.TargetKind == nil || *p.Result.TargetKind != "task_submission" || p.Result.TargetID == nil || !submissionIdentity.MatchString(*p.Result.TargetID) || p.Handler == nil || *p.Handler != "task.delivery.submit" || p.State != "processed" || p.Attempts < 1 || p.ProcessedAt == nil {
				return fail("receipt_invalid", "submission effect must identify an actual saved report")
			}
		case "reflection_recorded":
			if p.Result.TargetKind == nil || *p.Result.TargetKind != "reflection" || p.Result.TargetID == nil || *p.Result.TargetID != *r.ReceiptID || p.Handler == nil || *p.Handler != "reflection.record" || p.State != "processed" || p.Attempts < 1 || p.ProcessedAt == nil {
				return fail("receipt_invalid", "reflection effect must identify the actual collected original")
			}
		default:
			return fail("receipt_invalid", "invalid processing effect kind")
		}
	}
	if r.Processing.State != "pending" && r.Processing.State != "processed" && r.Processing.State != "failed" {
		return fail("receipt_invalid", "invalid processing state")
	}
	return nil
}
