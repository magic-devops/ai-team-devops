"""
@module: sop_worker.__main__
@purpose: 轻量 HTTP 健康检查 + 可选 Redis Streams 消费（XREADGROUP / XACK）
@ai_safe_edit: 仅扩展消费逻辑；保持单文件 < 500 行
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

_log = logging.getLogger("sop_worker")
_stop = threading.Event()


class _HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path in ("/", "/health", "/healthz", "/api/v1/health"):
            body = json.dumps({"ok": True, "service": "sop-manager-worker"}, separators=(",", ":")).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, *_args: object) -> None:
        return


def _redis_loop() -> None:
    url = (os.environ.get("REDIS_URL") or "").strip()
    if not url:
        _log.info("REDIS_URL unset — stream consumer disabled (health-only mode)")
        return
    try:
        import redis
    except ImportError:
        _log.warning("install redis extra: pip install 'sop-manager-worker[redis]'")
        return
    stream = (os.environ.get("WORKER_TASK_STREAM") or "sop:tasks").strip()
    group = (os.environ.get("WORKER_TASK_GROUP") or "sop-workers").strip()
    consumer = (os.environ.get("WORKER_CONSUMER_NAME") or "worker-1").strip()
    client = redis.from_url(url, decode_responses=True)
    try:
        client.xgroup_create(stream, group, id="0", mkstream=True)
    except redis.ResponseError as e:
        if "BUSYGROUP" not in str(e).upper():
            _log.warning("xgroup_create: %s", e)
    _log.info("listening stream=%s group=%s consumer=%s", stream, group, consumer)
    while not _stop.is_set():
        try:
            resp = client.xreadgroup(group, consumer, streams={stream: ">"}, count=10, block=5000)
        except redis.ResponseError as e:
            _log.warning("xreadgroup: %s", e)
            time.sleep(2)
            continue
        if not resp:
            continue
        for _sname, messages in resp:
            for msg_id, data in messages:
                job_id = str(data.get("job_id") or msg_id)
                job_type = str(data.get("type") or "unknown")
                raw_payload = data.get("payload") or "{}"
                try:
                    payload = json.loads(raw_payload) if isinstance(raw_payload, str) else dict(raw_payload)
                except json.JSONDecodeError:
                    payload = {}
                _log.info("task %s type=%s payload=%s", job_id, job_type, payload)
                try:
                    from sop_worker.handlers import handle_task

                    handle_task(job_id, job_type, payload)
                except Exception as e:
                    _log.warning("handler error job=%s: %s", job_id, e)
                try:
                    client.xack(stream, group, msg_id)
                except redis.ResponseError:
                    pass


def _on_signal(*_args: object) -> None:
    _stop.set()


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    p = argparse.ArgumentParser(prog="sop-worker")
    p.add_argument("--host", default=os.environ.get("WORKER_HEALTH_HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.environ.get("WORKER_HEALTH_PORT", "8790")))
    args = p.parse_args(argv)

    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    threading.Thread(target=_redis_loop, name="redis-consumer", daemon=True).start()

    httpd = HTTPServer((args.host, args.port), _HealthHandler)
    th = threading.Thread(target=httpd.serve_forever, daemon=True)
    th.start()
    _log.info("health http://%s:%s/health", args.host, args.port)
    try:
        while not _stop.is_set():
            time.sleep(0.3)
    finally:
        httpd.shutdown()
        httpd.server_close()
        _log.info("shutdown complete")


if __name__ == "__main__":  # pragma: no cover
    main()
