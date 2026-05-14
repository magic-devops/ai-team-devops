// Package logging 提供结构化日志（zap）；agentd 全程共享一个 logger。
package logging

import (
	"os"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// New 根据 SOP_LOG_FORMAT (json|console) 与 SOP_LOG_LEVEL 构建 logger。
func New() *zap.Logger {
	level := zapcore.InfoLevel
	if v := os.Getenv("SOP_LOG_LEVEL"); v != "" {
		_ = level.UnmarshalText([]byte(v))
	}

	enc := zap.NewProductionEncoderConfig()
	enc.TimeKey = "ts"
	enc.EncodeTime = zapcore.TimeEncoderOfLayout(time.RFC3339)
	enc.EncodeLevel = zapcore.LowercaseLevelEncoder

	var core zapcore.Core
	if os.Getenv("SOP_LOG_FORMAT") == "json" {
		core = zapcore.NewCore(zapcore.NewJSONEncoder(enc), zapcore.AddSync(os.Stdout), level)
	} else {
		enc.EncodeLevel = zapcore.CapitalColorLevelEncoder
		core = zapcore.NewCore(zapcore.NewConsoleEncoder(enc), zapcore.AddSync(os.Stdout), level)
	}
	return zap.New(core, zap.AddCaller(), zap.AddStacktrace(zapcore.ErrorLevel))
}
