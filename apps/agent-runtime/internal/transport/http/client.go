// Package httpx 提供 Manager HTTP 客户端（含签名 + 重试）。
package httpx

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/security"
)

type Client struct {
	authMu     sync.RWMutex
	baseURL    string
	hc         *http.Client
	apiKey     string
	projectID  string
	bearer     string
	maxRetries int
}

// SetAuth 热更新鉴权（sop login 后无需重启 agentd）。
func (c *Client) SetAuth(projectID, bearer, apiKey string) {
	c.authMu.Lock()
	defer c.authMu.Unlock()
	c.projectID = strings.TrimSpace(projectID)
	c.bearer = strings.TrimSpace(bearer)
	c.apiKey = strings.TrimSpace(apiKey)
}

func New(baseURL, projectID, bearer, apiKey string, timeout time.Duration, verifySSL bool, maxRetries int) *Client {
	tr := &http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 10,
		IdleConnTimeout:     90 * time.Second,
		TLSClientConfig:     &tls.Config{InsecureSkipVerify: !verifySSL},
	}
	return &Client{
		baseURL:    strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		hc:         &http.Client{Timeout: timeout, Transport: tr, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
		projectID:  projectID,
		bearer:     strings.TrimSpace(bearer),
		apiKey:     strings.TrimSpace(apiKey),
		maxRetries: maxRetries,
	}
}

// Snapshot pins the identity/project across an identity lookup, retries and event POST.
func (c *Client) Snapshot() *Client {
	c.authMu.RLock()
	defer c.authMu.RUnlock()
	return &Client{baseURL: c.baseURL, hc: c.hc, apiKey: c.apiKey, projectID: c.projectID, bearer: c.bearer, maxRetries: c.maxRetries}
}
func (c *Client) BaseURL() string   { c.authMu.RLock(); defer c.authMu.RUnlock(); return c.baseURL }
func (c *Client) ProjectID() string { c.authMu.RLock(); defer c.authMu.RUnlock(); return c.projectID }

// Do 发送请求，含签名、重试、Problem 错误解析。
func (c *Client) Do(ctx context.Context, method, path string, in any, out any) error {
	c = c.Snapshot()
	if _, err := NormalizeOrigin(c.baseURL); err != nil {
		return err
	}
	var body []byte
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = b
	}

	urlPath := path
	if !strings.HasPrefix(urlPath, "/") {
		urlPath = "/" + urlPath
	}
	parsed, err := url.Parse(c.baseURL + urlPath)
	if err != nil {
		return err
	}

	for i := 0; ; i++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		req, err := http.NewRequestWithContext(ctx, method, parsed.String(), bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("User-Agent", "sop-agentd")
		if len(body) > 0 {
			req.Header.Set("Content-Type", "application/json")
		}
		if c.projectID != "" {
			req.Header.Set("X-Project-Id", c.projectID)
		}
		switch {
		case c.bearer != "":
			req.Header.Set("Authorization", "Bearer "+c.bearer)
		case c.apiKey != "":
			security.Sign(c.apiKey, method, parsed.Path, body, req.Header)
		}

		resp, err := c.hc.Do(req)
		lastErr := err
		if err == nil {
			raw, readErr := io.ReadAll(resp.Body)
			resp.Body.Close()
			if err := ctx.Err(); err != nil {
				return err
			}
			if readErr != nil {
				return fmt.Errorf("read response: %w", readErr)
			}
			if resp.StatusCode < 500 {
				if resp.StatusCode >= 300 {
					return fmt.Errorf("manager %d: %s", resp.StatusCode, truncate(raw, 400))
				}
				if out != nil && len(raw) > 0 {
					if err := json.Unmarshal(raw, out); err != nil {
						return fmt.Errorf("unmarshal response: %w", err)
					}
				}
				return nil
			}
			lastErr = fmt.Errorf("manager %d: %s", resp.StatusCode, truncate(raw, 200))
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if i >= c.maxRetries {
			return lastErr
		}
		if err := waitBackoff(ctx, i); err != nil {
			return err
		}
	}
}

func waitBackoff(ctx context.Context, attempt int) error {
	timer := time.NewTimer(backoff(attempt))
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func backoff(attempt int) time.Duration {
	base := 30 * time.Second
	if attempt <= 0 {
		base = 500 * time.Millisecond
	} else if attempt < 6 {
		base = time.Duration(1<<attempt) * 500 * time.Millisecond
	}
	jitter := time.Duration(rand.Int63n(int64(500 * time.Millisecond)))
	return base + jitter
}

func truncate(b []byte, n int) string {
	if len(b) <= n {
		return string(b)
	}
	return string(b[:n]) + "..."
}

func (c *Client) AuthConfigured() (bool, bool) {
	c.authMu.RLock()
	defer c.authMu.RUnlock()
	return c.bearer != "", c.apiKey != ""
}
func NormalizeOrigin(value string) (string, error) {
	value = strings.TrimRight(strings.TrimSpace(value), "/")
	u, err := url.Parse(value)
	if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("invalid Manager base URL")
	}
	return value, nil
}

// SetConfiguration atomically refreshes the endpoint together with its identity/project.
func (c *Client) SetConfiguration(baseURL, projectID, bearer, apiKey string) {
	c.authMu.Lock()
	defer c.authMu.Unlock()
	c.baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	c.projectID = strings.TrimSpace(projectID)
	c.bearer = strings.TrimSpace(bearer)
	c.apiKey = strings.TrimSpace(apiKey)
}
