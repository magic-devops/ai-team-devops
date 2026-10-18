package outbox

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

// DecodeStrict rejects ambiguous objects and lossy Unicode/numeric inputs before typed decoding.
func DecodeStrict(raw []byte, dst any) error {
	if !utf8.Valid(raw) || !validSurrogates(raw) {
		return fail("payload_invalid", "invalid Unicode")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	if err := walkJSON(d); err != nil {
		return fail("payload_invalid", err.Error())
	}
	if _, err := d.Token(); err != io.EOF {
		return fail("payload_invalid", "extra JSON input")
	}
	d = json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	d.DisallowUnknownFields()
	if err := d.Decode(dst); err != nil {
		return fail("payload_invalid", err.Error())
	}
	return nil
}
func walkJSON(d *json.Decoder) error {
	t, err := d.Token()
	if err != nil {
		return err
	}
	if n, ok := t.(json.Number); ok && strings.ContainsAny(string(n), ".eE") {
		f, e := strconv.ParseFloat(string(n), 64)
		if e != nil || math.IsInf(f, 0) || math.IsNaN(f) {
			return fmt.Errorf("non-finite number")
		}
	}
	if delimiter, ok := t.(json.Delim); ok {
		switch delimiter {
		case '{':
			seen := map[string]bool{}
			for d.More() {
				k, e := d.Token()
				if e != nil {
					return e
				}
				key, ok := k.(string)
				if !ok || seen[key] {
					return fmt.Errorf("duplicate/invalid object key")
				}
				seen[key] = true
				if e := walkJSON(d); e != nil {
					return e
				}
			}
			_, err = d.Token()
			return err
		case '[':
			for d.More() {
				if e := walkJSON(d); e != nil {
					return e
				}
			}
			_, err = d.Token()
			return err
		default:
			return fmt.Errorf("unexpected JSON delimiter")
		}
	}
	return nil
}
func validSurrogates(raw []byte) bool {
	in := false
	for i := 0; i < len(raw); i++ {
		if raw[i] == '"' {
			in = !in
			continue
		}
		if !in || raw[i] != '\\' {
			continue
		}
		i++
		if i >= len(raw) {
			return false
		}
		if raw[i] != 'u' {
			continue
		}
		if i+4 >= len(raw) {
			return false
		}
		n, err := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
		if err != nil {
			return false
		}
		i += 4
		if n >= 0xd800 && n <= 0xdbff {
			if i+6 >= len(raw) || raw[i+1] != '\\' || raw[i+2] != 'u' {
				return false
			}
			low, e := strconv.ParseUint(string(raw[i+3:i+7]), 16, 16)
			if e != nil || low < 0xdc00 || low > 0xdfff {
				return false
			}
			i += 6
		} else if n >= 0xdc00 && n <= 0xdfff {
			return false
		}
	}
	return true
}
func Digest(eventJSON string) string {
	sum := sha256.Sum256([]byte(eventJSON))
	return hex.EncodeToString(sum[:])
}
func ValidateFrozen(in EnqueueInput) (Event, error) {
	var e Event
	if in.EventJSON == "" || len([]byte(in.EventJSON)) > 65536 || strings.HasPrefix(in.EventJSON, "\ufeff") {
		return e, fail("payload_invalid", "event_json must be at most64KiB UTF8 without BOM")
	}
	if len(in.Digest) != 64 || in.Digest != Digest(in.EventJSON) {
		return e, fail("digest_mismatch", "original event bytes/digest mismatch")
	}
	if err := DecodeStrict([]byte(in.EventJSON), &e); err != nil {
		return e, err
	}
	if e.ID == "" || utf8.RuneCountInString(e.ID) > 128 || e.ID != in.ID || e.SpecVersion != "1.0" || e.Type == "" || utf8.RuneCountInString(e.Type) > 160 || utf8.RuneCountInString(e.Source) > 512 || utf8.RuneCountInString(e.Subject) > 256 || e.DataContentType != "application/json" || e.Data == nil || !validTime(e.Time) {
		return e, fail("payload_invalid", "invalid full frozen event envelope")
	}
	// All envelope members must be explicit, including empty source/subject and an empty data object.
	var fields map[string]json.RawMessage
	_ = json.Unmarshal([]byte(in.EventJSON), &fields)
	if len(fields) != 8 {
		return e, fail("payload_invalid", "all8 envelope fields are required")
	}
	for _, key := range []string{"specversion", "id", "type", "source", "subject", "time", "datacontenttype"} {
		raw := bytes.TrimSpace(fields[key])
		if len(raw) == 0 || raw[0] != '"' {
			return e, fail("payload_invalid", "envelope string fields cannot be null")
		}
	}
	if in.IntendedProjectID == "" || utf8.RuneCountInString(in.IntendedProjectID) > 64 {
		return e, fail("scope_mismatch", "explicit intended project required")
	}
	return e, nil
}

// requiredObject rejects missing and null scalar fields that encoding/json otherwise zero-fills.
func requiredObject(raw []byte, fields map[string]bool, dst any) error {
	var object map[string]json.RawMessage
	if err := DecodeStrict(raw, &object); err != nil {
		return err
	}
	if len(object) != len(fields) {
		return fail("receipt_invalid", "receipt fields missing or unknown")
	}
	for key, nullable := range fields {
		value, ok := object[key]
		if !ok || (!nullable && bytes.Equal(bytes.TrimSpace(value), []byte("null"))) {
			return fail("receipt_invalid", "missing/null receipt field: "+key)
		}
	}
	return DecodeStrict(raw, dst)
}
func (r *RemoteReceipt) UnmarshalJSON(raw []byte) error {
	type wire RemoteReceipt
	return requiredObject(raw, map[string]bool{"id": false, "digest": false, "outcome": false, "receipt_id": true, "stored_at": true, "processing": true, "error": true}, (*wire)(r))
}
func (p *Processing) UnmarshalJSON(raw []byte) error {
	type wire Processing
	return requiredObject(raw, map[string]bool{"state": false, "revision": false, "handler": true, "operation_id": true, "attempts": false, "updated_at": false, "processed_at": true, "reason_code": true, "retryable": false, "result": true}, (*wire)(p))
}
func (e *EventError) UnmarshalJSON(raw []byte) error {
	type wire EventError
	return requiredObject(raw, map[string]bool{"code": false, "message": false, "retryable": false}, (*wire)(e))
}
func (e *EffectResult) UnmarshalJSON(raw []byte) error {
	type wire EffectResult
	return requiredObject(raw, map[string]bool{"kind": false, "target_kind": true, "target_id": true}, (*wire)(e))
}
