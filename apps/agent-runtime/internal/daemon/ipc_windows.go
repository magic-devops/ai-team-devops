//go:build windows

package daemon

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"unicode"
	"unsafe"

	"github.com/Microsoft/go-winio"
	"golang.org/x/sys/windows"
)

func listenIPC(path string) (net.Listener, error) {
	sddl, err := currentUserSystemAdminPipeSDDL()
	if err != nil {
		return nil, err
	}
	endpoint, err := pipeName(path)
	if err != nil {
		return nil, err
	}
	if override := os.Getenv("SOP_AGENTD_PIPE"); override != "" {
		if err := validateLocalPipe(override); err != nil {
			return nil, err
		}
		endpoint = override
	}
	return winio.ListenPipe(endpoint, &winio.PipeConfig{
		SecurityDescriptor: sddl,
		MessageMode:        false,
		InputBufferSize:    64 * 1024,
		OutputBufferSize:   64 * 1024,
	})
}

func pipeName(path string) (string, error) {
	canonical, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	source, err := windows.UTF16FromString(canonical)
	if err != nil {
		return "", err
	}
	locale, _ := windows.UTF16FromString("")
	proc := windows.NewLazySystemDLL("kernel32.dll").NewProc("LCMapStringEx")
	size, _, callErr := proc.Call(uintptr(unsafe.Pointer(&locale[0])), 0x100,
		uintptr(unsafe.Pointer(&source[0])), uintptr(len(source)-1), 0, 0, 0, 0, 0)
	if size == 0 {
		return "", fmt.Errorf("invariant pipe namespace: %w", callErr)
	}
	mapped := make([]uint16, size)
	written, _, callErr := proc.Call(uintptr(unsafe.Pointer(&locale[0])), 0x100,
		uintptr(unsafe.Pointer(&source[0])), uintptr(len(source)-1), uintptr(unsafe.Pointer(&mapped[0])), size, 0, 0, 0)
	if written == 0 {
		return "", fmt.Errorf("invariant pipe namespace: %w", callErr)
	}
	hash := sha1.Sum([]byte(windows.UTF16ToString(mapped[:written])))
	return `\\.\pipe\sop-agentd-` + hex.EncodeToString(hash[:8]), nil
}

func validateLocalPipe(value string) error {
	const prefix = `\\.\pipe\`
	if len(value) <= len(prefix) || !strings.EqualFold(value[:len(prefix)], prefix) ||
		strings.ContainsAny(value[len(prefix):], `\/`) || strings.ContainsFunc(value, unicode.IsControl) {
		return fmt.Errorf("use a local named pipe of the form %sname", prefix)
	}
	return nil
}

func currentUserSystemAdminPipeSDDL() (string, error) {
	token, err := windows.OpenCurrentProcessToken()
	if err != nil {
		return "", fmt.Errorf("open current process token: %w", err)
	}
	defer token.Close()
	user, err := token.GetTokenUser()
	if err != nil {
		return "", fmt.Errorf("read current user token: %w", err)
	}
	return fmt.Sprintf("D:P(A;;GA;;;%s)(A;;GA;;;SY)(A;;GA;;;BA)", user.User.Sid.String()), nil
}
