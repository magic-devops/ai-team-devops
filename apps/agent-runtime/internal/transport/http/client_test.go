package httpx

import (
	"context"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
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
