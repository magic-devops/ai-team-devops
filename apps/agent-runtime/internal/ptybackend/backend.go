package ptybackend

import (
	"context"
	"io"
)

type StartRequest struct {
	Root           string
	Argv           []string
	Cols           int
	Rows           int
	TimeoutSeconds int
}

type Session interface {
	io.Reader
	io.Writer
	Close() error
	Resize(cols, rows int) error
	Wait(context.Context) (int, error)
	PID() int
	Backend() string
}
