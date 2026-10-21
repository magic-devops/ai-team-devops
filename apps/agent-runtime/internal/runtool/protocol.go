package runtool

import (
	"context"
	"encoding/json"
	"io"
)

// ServeEvents is the explicit JSONL execution protocol. Closing the controller
// pipe cancels the command rather than leaving an unowned child running.
func ServeEvents(ctx context.Context, root string, input io.Reader, output io.Writer) error {
	decoder := json.NewDecoder(io.LimitReader(input, 4*1024*1024))
	var request Request
	if err := decoder.Decode(&request); err != nil {
		return err
	}
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		for {
			var control struct {
				Op        string `json:"op"`
				RequestID string `json:"request_id"`
			}
			if err := decoder.Decode(&control); err != nil {
				cancel()
				return
			}
			if control.Op == "cancel" && control.RequestID != "" {
				cancel()
				return
			}
		}
	}()
	encoder := json.NewEncoder(output)
	RunEvents(runCtx, root, request, func(event ToolEvent) {
		if err := encoder.Encode(event); err != nil {
			cancel()
		}
	})
	return nil
}
