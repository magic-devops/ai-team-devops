package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/outbox"
	httpx "github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/transport/http"
	"go.uber.org/zap"
)

type frozenWire struct {
	ID        string `json:"id"`
	EventJSON string `json:"event_json"`
	Digest    string `json:"digest"`
}
type ingestRequest struct {
	ExpectedTenantID   string       `json:"expected_tenant_id"`
	ExpectedProjectID  string       `json:"expected_project_id"`
	ExpectedProducerID string       `json:"expected_producer_id"`
	Events             []frozenWire `json:"events"`
}
type ingestResponse struct {
	TenantID  string `json:"tenant_id"`
	ProjectID string `json:"project_id"`
	Producer  struct {
		Kind string `json:"kind"`
		ID   string `json:"id"`
	} `json:"producer"`
	AsOf    string                 `json:"as_of"`
	Results []outbox.RemoteReceipt `json:"results"`
}
type remoteIdentity struct {
	TenantID   string `json:"tenant_id"`
	ProjectID  string `json:"project_id"`
	ProducerID string `json:"producer_id"`
}

func (d *Daemon) retryEvent(ctx context.Context, r outbox.Record, f outbox.Failure) {
	if ctx.Err() != nil {
		return
	}
	mutation, err := d.outbox.Retry(ctx, r.ID, r.Revision, d.cfg.Reliability.MaxRetries, f)
	if err != nil {
		d.log.Error("event retry update", zap.String("id", r.ID), zap.Error(err))
		return
	}
	d.log.Warn("event handoff deferred", zap.String("id", r.ID), zap.String("state", mutation.State), zap.String("reason", f.Code))
}
func (d *Daemon) flushOutboxOnce(ctx context.Context) {
	d.flushMutex.Lock()
	defer d.flushMutex.Unlock()
	if ctx.Err() != nil {
		return
	}
	limit := d.cfg.Reliability.BatchSize
	if limit == 0 {
		limit = 50
	}
	batch, err := d.outbox.PendingBatch(ctx, limit)
	if err != nil {
		d.log.Warn("outbox pending", zap.Error(err))
		return
	}
	if len(batch) == 0 {
		return
	}
	if d.http == nil {
		return
	}
	session := d.http.Snapshot()
	var raw json.RawMessage
	err = session.Do(ctx, "GET", "/api/v1/events:identity", nil, &raw)
	identity := remoteIdentity{}
	if err == nil {
		err = outbox.DecodeStrict(raw, &identity)
	}
	origin, originErr := httpx.NormalizeOrigin(session.BaseURL())
	if err == nil {
		err = originErr
	}
	scope := outbox.Scope{TenantID: identity.TenantID, ProjectID: identity.ProjectID, ProducerID: identity.ProducerID, ManagerOrigin: origin}
	if err == nil {
		err = scope.Validate()
	}
	if err == nil && identity.ProjectID != session.ProjectID() {
		err = fmt.Errorf("verified identity project differs from configured project")
	}
	if err != nil {
		for _, r := range batch {
			d.retryEvent(ctx, r, outbox.Failure{Code: "identity_unavailable", Message: err.Error(), Retryable: true})
		}
		return
	}
	ready := []outbox.Record{}
	for _, r := range batch {
		if ctx.Err() != nil {
			return
		}
		if r.IntendedProjectID != scope.ProjectID || (r.Scope() != nil && *r.Scope() != scope) {
			d.retryEvent(ctx, r, outbox.Failure{Code: "scope_mismatch", Message: "Current authenticated identity/origin differs from original event", Retryable: true})
			continue
		}
		if _, e := outbox.ValidateFrozen(outbox.EnqueueInput{ID: r.ID, EventJSON: r.EventJSON, Digest: r.Digest, IntendedProjectID: r.IntendedProjectID}); e != nil {
			d.retryEvent(ctx, r, outbox.Failure{Code: "payload_invalid", Message: e.Error(), Retryable: false})
			continue
		}
		if r.Scope() == nil {
			bound, e := d.outbox.Bind(ctx, r.ID, r.Revision, scope)
			if e != nil {
				d.log.Error("event binding", zap.String("id", r.ID), zap.Error(e))
				continue
			}
			r.Revision = bound.Revision
		}
		ready = append(ready, r)
	}
	for len(ready) > 0 {
		size := 0
		n := 0
		for n < len(ready) && n < 50 {
			bytes := len([]byte(ready[n].EventJSON))
			if n > 0 && size+bytes > 1048576 {
				break
			}
			size += bytes
			n++
		}
		d.sendEventBatch(ctx, session, scope, ready[:n])
		ready = ready[n:]
		if ctx.Err() != nil {
			return
		}
	}
}
func parseEventReceipts(raw []byte, scope outbox.Scope, records []outbox.Record) (map[string]outbox.RemoteReceipt, error) {
	var response ingestResponse
	if err := outbox.DecodeStrict(raw, &response); err != nil {
		return nil, err
	}
	if response.TenantID != scope.TenantID || response.ProjectID != scope.ProjectID || response.Producer.Kind != "user" || response.Producer.ID != scope.ProducerID {
		return nil, fmt.Errorf("receipt response scope mismatch")
	}
	if _, err := time.Parse(time.RFC3339Nano, response.AsOf); err != nil {
		return nil, fmt.Errorf("invalid receipt response timestamp")
	}
	expected := map[string]string{}
	for _, r := range records {
		expected[r.ID] = r.Digest
	}
	out := map[string]outbox.RemoteReceipt{}
	for _, receipt := range response.Results {
		digest, known := expected[receipt.ID]
		if !known {
			return nil, fmt.Errorf("unknown receipt ID")
		}
		if _, duplicate := out[receipt.ID]; duplicate {
			return nil, fmt.Errorf("duplicate receipt ID")
		}
		if receipt.Digest != digest {
			return nil, fmt.Errorf("receipt digest mismatch")
		}
		if receipt.Outcome == "rejected" {
			if receipt.ReceiptID != nil || receipt.StoredAt != nil || receipt.Processing != nil || receipt.Error == nil || receipt.Error.Code == "" {
				return nil, fmt.Errorf("invalid rejected receipt")
			}
		} else if err := receipt.Validate(receipt.ID, digest); err != nil {
			return nil, err
		}
		out[receipt.ID] = receipt
	}
	return out, nil
}
func (d *Daemon) sendEventBatch(ctx context.Context, session *httpx.Client, scope outbox.Scope, records []outbox.Record) {
	request := ingestRequest{ExpectedTenantID: scope.TenantID, ExpectedProjectID: scope.ProjectID, ExpectedProducerID: scope.ProducerID, Events: []frozenWire{}}
	for _, r := range records {
		request.Events = append(request.Events, frozenWire{r.ID, r.EventJSON, r.Digest})
	}
	var raw json.RawMessage
	err := session.Do(ctx, "POST", "/api/v1/events:ingest", request, &raw)
	var receipts map[string]outbox.RemoteReceipt
	if err == nil {
		receipts, err = parseEventReceipts(raw, scope, records)
	}
	if err != nil {
		for _, r := range records {
			d.retryEvent(ctx, r, outbox.Failure{Code: "handoff_unconfirmed", Message: err.Error(), Retryable: true})
		}
		return
	}
	for _, r := range records {
		if ctx.Err() != nil {
			return
		}
		receipt, found := receipts[r.ID]
		if !found {
			d.retryEvent(ctx, r, outbox.Failure{Code: "receipt_missing", Message: "Manager did not return this original event receipt", Retryable: true})
			continue
		}
		if receipt.Outcome == "rejected" {
			d.retryEvent(ctx, r, outbox.Failure{Code: receipt.Error.Code, Message: receipt.Error.Message, Retryable: receipt.Error.Retryable})
			continue
		}
		if _, err = d.outbox.Ack(ctx, r.ID, r.Revision, receipt); err != nil {
			d.log.Error("durable event receipt local ACK failed", zap.String("id", r.ID), zap.Error(err))
			continue
		}
		d.log.Debug("event durably handed off", zap.String("id", r.ID), zap.String("receipt_id", *receipt.ReceiptID), zap.String("processing_state", receipt.Processing.State))
	}
}
