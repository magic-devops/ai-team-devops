# sop-agentd 构建

BINARY := bin/sop-agentd
GOFLAGS ?= -trimpath
VERSION ?= 1.0.0
LDFLAGS ?= -s -w -X 'main.Version=$(VERSION)'

.PHONY: build cross test lint clean install

build:
	mkdir -p bin
	go build $(GOFLAGS) -ldflags="$(LDFLAGS)" -o $(BINARY) ./cmd/sop-agentd
	@echo "✓ $(BINARY)"

cross:
	mkdir -p bin
	GOOS=darwin  GOARCH=arm64 go build $(GOFLAGS) -ldflags="$(LDFLAGS)" -o bin/sop-agentd-darwin-arm64  ./cmd/sop-agentd
	GOOS=darwin  GOARCH=amd64 go build $(GOFLAGS) -ldflags="$(LDFLAGS)" -o bin/sop-agentd-darwin-amd64  ./cmd/sop-agentd
	GOOS=linux   GOARCH=arm64 go build $(GOFLAGS) -ldflags="$(LDFLAGS)" -o bin/sop-agentd-linux-arm64   ./cmd/sop-agentd
	GOOS=linux   GOARCH=amd64 go build $(GOFLAGS) -ldflags="$(LDFLAGS)" -o bin/sop-agentd-linux-amd64   ./cmd/sop-agentd
	GOOS=windows GOARCH=amd64 go build $(GOFLAGS) -ldflags="$(LDFLAGS)" -o bin/sop-agentd-windows-amd64.exe ./cmd/sop-agentd

test:
	go test -race -cover ./...

lint:
	test -x "$$(go env GOPATH)/bin/golangci-lint" || (echo "需要安装: go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest" && exit 1)
	golangci-lint run ./...

clean:
	rm -rf bin

install: build
	install -m 0755 $(BINARY) /usr/local/bin/sop-agentd
