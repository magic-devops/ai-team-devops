// Package httpx 提供 Manager HTTP 客户端（含签名 + 重试）。
package httpx

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/magic-devops/ai-team-devops/apps/agent-runtime/internal/security"
)

type Client struct {
	baseURL    string
	hc         *http.Client
	apiKey     string
	projectID  string
	bearer     string
	maxRetries int
}

func New(baseURL, projectID, bearer, apiKey string, timeout time.Duration, verifySSL bool, maxRetries int) *Client {
	tr := &http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 10,
		IdleConnTimeout:     90 * time.Second,
		TLSClientConfig:     &tls.Config{InsecureSkipVerify: !verifySSL},
	}
	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		hc:         &http.Client{Timeout: timeout, Transport: tr},
		projectID:  projectID,
		bearer:     strings.TrimSpace(bearer),
		apiKey:     strings.TrimSpace(apiKey),
		maxRetries: maxRetries,
	}
}

// Do 发送请求，含签名、重试、Problem 错误解析。
func (c *Client) Do(ctx context.Context, method, path string, in any, out any) error {
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
	parsed, _ := url.Parse(c.baseURL + urlPath)

	var lastErr error
	attempts := c.maxRetries + 1
	if attempts < 1 {
		attempts = 1
	}
	for i := 0; i < attempts; i++ {
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
			security.Sign(c.apiKey, method, urlPath, body, req.Header)
		}

		resp, err := c.hc.Do(req)
		if err != nil {
			lastErr = err
			time.Sleep(backoff(i))
			continue
		}
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("manager %d: %s", resp.StatusCode, truncate(raw, 200))
			time.Sleep(backoff(i))
			continue
		}
		if resp.StatusCode >= 400 {
			return fmt.Errorf("manager %d: %s", resp.StatusCode, truncate(raw, 400))
		}
		if out != nil && len(raw) > 0 {
			if err := json.Unmarshal(raw, out); err != nil {
				return fmt.Errorf("unmarshal response: %w", err)
			}
		}
		return nil
	}
	if lastErr == nil {
		lastErr = errors.New("unknown transport error")
	}
	return lastErr
}

func backoff(attempt int) time.Duration {
	base := time.Duration(1<<attempt) * 500 * time.Millisecond
	jitter := time.Duration(rand.Int63n(int64(500 * time.Millisecond)))
	if base > 30*time.Second {
		base = 30 * time.Second
	}
	return base + jitter
}

func truncate(b []byte, n int) string {
	if len(b) <= n {
		return string(b)
	}
	return string(b[:n]) + "..."
}
