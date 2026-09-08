//go:build windows

package daemon

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"net"
	"strings"

	"github.com/Microsoft/go-winio"
	"golang.org/x/sys/windows"
)

func listenIPC(path string) (net.Listener, error) {
	sddl, err := currentUserSystemAdminPipeSDDL()
	if err != nil {
		return nil, err
	}
	return winio.ListenPipe(pipeName(path), &winio.PipeConfig{
		SecurityDescriptor: sddl,
		MessageMode:        false,
		InputBufferSize:    64 * 1024,
		OutputBufferSize:   64 * 1024,
	})
}

func pipeName(path string) string {
	hash := sha1.Sum([]byte(strings.ToLower(path)))
	return `\\.\pipe\sop-agentd-` + hex.EncodeToString(hash[:8])
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
