// Package security 提供 HMAC + ts + nonce 签名（与 sop_sdk.security.HmacAuth 一致）。
package security

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Sign 就地填充 X-Api-Key / X-Sop-Timestamp / X-Sop-Nonce / X-Sop-Signature。
// 签名串: METHOD\nPATH\nTS\nNONCE\nSHA256(body)
func Sign(apiKey, method, path string, body []byte, h http.Header) {
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	nonce := newNonce(16)
	bodySum := sha256.Sum256(body)
	canonical := strings.ToUpper(method) + "\n" + path + "\n" + ts + "\n" + nonce + "\n" + hex.EncodeToString(bodySum[:])
	mac := hmac.New(sha256.New, []byte(apiKey))
	mac.Write([]byte(canonical))
	sig := hex.EncodeToString(mac.Sum(nil))

	h.Set("X-Api-Key", apiKey)
	h.Set("X-Sop-Timestamp", ts)
	h.Set("X-Sop-Nonce", nonce)
	h.Set("X-Sop-Signature", "sha256="+sig)
}

func newNonce(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return strings.TrimRight(base64.URLEncoding.EncodeToString(b), "=")
}
