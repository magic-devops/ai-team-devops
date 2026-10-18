package httpx

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func retryFailureServer(t *testing.T, mode string) (*httptest.Server, <-chan struct{}, *atomic.Int32) {
	t.Helper()
	requested := make(chan struct{})
	var once sync.Once
	requests := &atomic.Int32{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		defer once.Do(func() { close(requested) })
		if mode == "connection-error" {
			conn, _, err := w.(http.Hijacker).Hijack()
			if err == nil {
				_ = conn.Close()
			}
			return
		}
		http.Error(w, "temporary manager failure", http.StatusInternalServerError)
	}))
	t.Cleanup(server.Close)
	return server, requested, requests
}

func TestRetryBackoffExitsPromptlyWhenContextIsCancelled(t *testing.T) {
	for _, mode := range []string{"http-500", "connection-error"} {
		t.Run(mode, func(t *testing.T) {
			server, requested, requests := retryFailureServer(t, mode)
			client := New(server.URL, "", "", "", time.Second, true, 99)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1)
			go func() { done <- client.Do(ctx, http.MethodGet, "/", nil, nil) }()
			select {
			case <-requested:
			case <-time.After(time.Second):
				t.Fatal("real HTTP request did not reach the server")
			}
			// Allow the failed response to enter its retry backoff.
			time.Sleep(30 * time.Millisecond)
			started := time.Now()
			cancel()
			select {
			case err := <-done:
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("cancel returned %v", err)
				}
			case <-time.After(200 * time.Millisecond):
				t.Fatal("HTTP retry backoff ignored context cancellation")
			}
			if elapsed := time.Since(started); elapsed >= 200*time.Millisecond {
				t.Fatalf("cancel took %v", elapsed)
			}
			if got := requests.Load(); got != 1 {
				t.Fatalf("unexpected requests after cancel: %d", got)
			}
		})
	}
}

func TestFinalFailedHTTPAttemptDoesNotSleep(t *testing.T) {
	for _, mode := range []string{"http-500", "connection-error"} {
		t.Run(mode, func(t *testing.T) {
			server, _, requests := retryFailureServer(t, mode)
			client := New(server.URL, "", "", "", time.Second, true, 0)
			started := time.Now()
			if err := client.Do(context.Background(), http.MethodGet, "/", nil, nil); err == nil {
				t.Fatal("real failing HTTP attempt unexpectedly succeeded")
			}
			if elapsed := time.Since(started); elapsed >= 300*time.Millisecond {
				t.Fatalf("final attempt slept for %v", elapsed)
			}
			if got := requests.Load(); got != 1 {
				t.Fatalf("zero retries made %d requests", got)
			}
		})
	}
}

func TestCancelledContextDoesNotStartHTTPRequestOrRetry(t *testing.T) {
	server, _, requests := retryFailureServer(t, "http-500")
	client := New(server.URL, "", "", "", time.Second, true, 99)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	done := make(chan error, 1)
	go func() { done <- client.Do(ctx, http.MethodGet, "/", nil, nil) }()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancel returned %v", err)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("pre-cancelled HTTP request entered retry backoff")
	}
	if got := requests.Load(); got != 0 {
		t.Fatalf("pre-cancelled context sent %d requests", got)
	}
}

func TestBackoffCapsBeforeExponentialOverflow(t *testing.T) {
	for _, attempt := range []int{6, 62, 63, 99, math.MaxInt} {
		delay := backoff(attempt)
		if delay < 30*time.Second || delay >= 30500*time.Millisecond {
			t.Errorf("attempt %d has invalid capped backoff %v", attempt, delay)
		}
	}
}

func TestHTTPRetryStillRecoversAndDoesNotRetryClientErrors(t *testing.T) {
	for _, status := range []int{http.StatusInternalServerError, http.StatusBadRequest} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if requests.Add(1) == 1 {
					http.Error(w, "initial failure", status)
					return
				}
				_, _ = w.Write([]byte(`{"recovered": true}`))
			}))
			defer server.Close()
			client := New(server.URL, "", "", "", time.Second, true, 1)
			var result struct {
				Recovered bool `json:"recovered"`
			}
			err := client.Do(context.Background(), http.MethodGet, "/", nil, &result)
			if status == http.StatusBadRequest {
				if err == nil || requests.Load() != 1 {
					t.Fatalf("client error retried: %v requests=%d", err, requests.Load())
				}
			} else if err != nil || !result.Recovered || requests.Load() != 2 {
				t.Fatalf("retry did not recover: %v result=%#v requests=%d", err, result, requests.Load())
			}
		})
	}
}

func TestHTTPRetryKeepsOneCoherentAuthScope(t *testing.T) {
	var client *Client
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		if r.Header.Get("Authorization") != "Bearer original" || r.Header.Get("X-Project-Id") != "P-original" {
			t.Errorf("retry changed original identity/project: %q %q", r.Header.Get("Authorization"), r.Header.Get("X-Project-Id"))
		}
		if n == 1 {
			client.SetAuth("P-new", "replacement", "")
			http.Error(w, "retry", 500)
			return
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()
	client = New(server.URL, "P-original", "original", "", time.Second, true, 1)
	if err := client.Do(context.Background(), http.MethodGet, "/", nil, nil); err != nil {
		t.Fatal(err)
	}
}
func TestHMACSignsActualBasePathWithoutQuery(t *testing.T) {
	secret := "owned-test-secret"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		sum := sha256.Sum256(body)
		canonical := r.Method + "\n" + r.URL.Path + "\n" + r.Header.Get("X-Sop-Timestamp") + "\n" + r.Header.Get("X-Sop-Nonce") + "\n" + hex.EncodeToString(sum[:])
		mac := hmac.New(sha256.New, []byte(secret))
		_, _ = mac.Write([]byte(canonical))
		if want := "sha256=" + hex.EncodeToString(mac.Sum(nil)); r.Header.Get("X-Sop-Signature") != want {
			t.Error("signature did not cover the real request base path")
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()
	client := New(server.URL+"/prefix/", "P", "", secret, time.Second, true, 0)
	if err := client.Do(context.Background(), http.MethodGet, "/api/v1/events:identity?read=1", nil, nil); err != nil {
		t.Fatal(err)
	}
}
func TestTruncatedHTTPBodyCannotReturnSuccessfulReceipt(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Close()
		_, _ = fmt.Fprintf(conn, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100\r\nConnection: close\r\n\r\n%s", `{"receipt_id":"looks-valid"}`)
	}))
	defer server.Close()
	client := New(server.URL, "P", "", "", time.Second, true, 0)
	var out map[string]any
	if err := client.Do(context.Background(), http.MethodGet, "/", nil, &out); err == nil || !strings.Contains(err.Error(), "EOF") {
		t.Fatalf("truncated framing accepted: %#v %v", out, err)
	}
}

func TestRedirectCannotMoveFrozenIdentityToAnotherOrigin(t *testing.T) {
	var foreignCalls atomic.Int32
	foreign := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { foreignCalls.Add(1); w.Write([]byte(`{"ok":true}`)) }))
	defer foreign.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, foreign.URL+"/api/v1/events:ingest", http.StatusTemporaryRedirect)
	}))
	defer origin.Close()
	client := New(origin.URL, "original-project", "", "key:secret", time.Second, true, 0)
	err := client.Do(context.Background(), "POST", "/api/v1/events:ingest", map[string]any{"event_json": "original-private-bytes"}, nil)
	if err == nil || foreignCalls.Load() != 0 {
		t.Fatalf("redirect changed verified origin: err=%v foreign requests=%d", err, foreignCalls.Load())
	}
}
