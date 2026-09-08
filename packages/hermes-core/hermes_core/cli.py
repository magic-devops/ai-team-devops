from __future__ import annotations

import argparse
import json
import os
import secrets
import socket
import stat
from pathlib import Path

import uvicorn

from .api import create_app


def ensure_token_file(path: Path) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError("Token file must not be a symbolic link")
    flags = getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, os.O_RDONLY | flags)
    except FileNotFoundError:
        token = secrets.token_urlsafe(48)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | flags, 0o600)
        with os.fdopen(fd, "w") as handle:
            handle.write(token)
        return token
    with os.fdopen(fd, "r") as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > 4096:
            raise ValueError("Token file must be a small regular file")
        if os.name != "nt":
            os.fchmod(handle.fileno(), 0o600)
        token = handle.read().strip()
    if len(token) < 32:
        raise ValueError("Token must contain at least 32 characters")
    return token


def main() -> None:
    parser = argparse.ArgumentParser(prog="hermes-core")
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--token-file", required=True)
    parser.add_argument("--host", default="127.0.0.1", choices=["127.0.0.1"])
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--agentd", default="")
    parser.add_argument("--export-openapi", type=Path)
    args = parser.parse_args()

    data_dir = Path(args.data_dir).expanduser().resolve()
    token_file = Path(args.token_file).expanduser().absolute()
    token = ensure_token_file(token_file)
    app = create_app(data_dir, token, database_url=os.getenv("HERMES_DATABASE_URL", ""), agentd=args.agentd)
    if args.export_openapi:
        args.export_openapi.parent.mkdir(parents=True, exist_ok=True)
        args.export_openapi.write_text(json.dumps(app.openapi(), indent=2) + "\n")
        return
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind((args.host, args.port))
    sock.listen(128)
    port = sock.getsockname()[1]
    print(json.dumps({"url": f"http://{args.host}:{port}", "token_file": str(token_file), "pid": os.getpid()}), flush=True)
    server = uvicorn.Server(uvicorn.Config(app, log_level="warning"))
    server.run(sockets=[sock])


if __name__ == "__main__":
    main()
