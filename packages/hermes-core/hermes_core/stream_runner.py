"""Agentd JSONL controller shared by native and paired workers."""
from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
import time

from .models import CoreError
from .run_output import OutputSanitizer, sanitize_text


def run_stream(agentd, root, argv, timeout_seconds, *, on_output, control, known_secrets=()):  # noqa: C901 - bounded execution protocol state machine
    environment = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    secrets = tuple(known_secrets) + tuple(value for key, value in environment.items()
        if any(part in key.lower() for part in ('token', 'secret', 'password', 'api_key')) and len(value) >= 4)
    sanitizer = OutputSanitizer(known_secrets=secrets)
    messages = queue.Queue(maxsize=128)
    stderr_tail = []
    proc = subprocess.Popen(  # noqa: S603 - trusted configured agentd, authorized argv passed on stdin
        [agentd, 'run-tool', '--events', '--root', str(root)],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env=environment, start_new_session=os.name != 'nt')

    def read_events():
        try:
            while True:
                line = proc.stdout.readline(1048577)
                if not line:
                    break
                if len(line) > 1048576:
                    messages.put(('error', 'Agentd event exceeds the protocol limit'))
                    return
                messages.put(('line', line))
        finally:
            messages.put(('eof', None))

    def read_errors():
        while True:
            raw = proc.stderr.read(4096)
            if not raw:
                return
            stderr_tail.append(raw)
            if len(stderr_tail) > 16:
                stderr_tail.pop(0)

    reader = threading.Thread(target=read_events, daemon=True)
    errors = threading.Thread(target=read_errors, daemon=True)
    reader.start()
    errors.start()
    proc.stdin.write((json.dumps({'argv': argv, 'timeout_seconds': timeout_seconds}) + '\n').encode())
    proc.stdin.flush()
    started = time.monotonic()
    cancelled_at = None
    completed = None
    source_seq = 0
    tails = {'stdout': '', 'stderr': ''}
    control_error = None
    try:
        while True:
            request_id = None
            try:
                request_id = control()
            except Exception as exc:
                control_error = exc
                request_id = 'controller-unavailable'
            if time.monotonic() - started > timeout_seconds + 10:
                request_id = request_id or 'controller-timeout'
            if request_id and cancelled_at is None:
                proc.stdin.write((json.dumps({'op': 'cancel', 'request_id': request_id}) + '\n').encode())
                proc.stdin.flush()
                cancelled_at = time.monotonic()
            if cancelled_at is not None and time.monotonic() - cancelled_at > 8:
                raise CoreError('stop_unknown', 'Executor did not confirm process tree stop', 409)
            try:
                kind, value = messages.get(timeout=.1)
            except queue.Empty:
                continue
            if kind == 'error':
                raise CoreError('executor_protocol', value, 502)
            if kind == 'eof':
                if completed is None:
                    raise CoreError('stop_unknown', 'Executor exited without terminal process evidence', 502)
                break
            try:
                event = json.loads(value)
            except (ValueError, UnicodeError) as exc:
                raise CoreError('executor_protocol', 'Executor returned invalid JSONL', 502) from exc
            if event.get('event') == 'tool.output':
                if event.get('source_seq') != source_seq + 1 or event.get('stream') not in tails or not isinstance(event.get('text'), str):
                    raise CoreError('executor_protocol', 'Invalid executor output sequence', 502)
                source_seq += 1
                stream = event['stream']
                safe = ''.join(sanitizer.feed(stream, event['text'], final=bool(event.get('final'))))
                tails[stream] = (tails[stream] + safe)[-262144:]
                output = {key: event[key] for key in ('source_seq', 'stream', 'observed_at', 'truncated', 'final') if key in event}
                output.update(text=safe, final=True, sanitized=safe != event['text'])
                on_output(output)
            elif event.get('event') == 'tool.completed':
                completed = event.get('result')
                if not isinstance(completed, dict) or type(completed.get('exit_code')) is not int:
                    raise CoreError('executor_protocol', 'Missing executor exit evidence', 502)
            elif event.get('event') != 'tool.started':
                raise CoreError('executor_protocol', 'Unknown executor event', 502)
        proc.wait(timeout=3)
        result = dict(completed)
        for stream in tails:
            result[stream] = sanitize_text(tails[stream] or result.get(stream, ''), known_secrets=secrets)
        result['error'] = sanitize_text(result.get('error', ''), known_secrets=secrets)
        result['_last_source_seq'] = source_seq
        result['_controller_cancelled'] = cancelled_at is not None
        if control_error:
            result['_control_error'] = type(control_error).__name__
        return result
    finally:
        if proc.poll() is None:
            # A parent kill is a last resort and supplies no physical-stop proof.
            proc.kill()
            proc.wait(timeout=3)
        if proc.stdin:
            proc.stdin.close()
        reader.join(timeout=1)
        errors.join(timeout=1)
        proc.stdout.close()
        proc.stderr.close()
