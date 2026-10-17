"""Bounded append-only execution output; never rewrites business run versions."""
from __future__ import annotations

import re
import uuid

from sqlalchemy import insert, select, update

from .models import CoreError
from .transactional import digest, now

LINE_LIMIT = 16384
STREAM_LIMIT = 262144
BATCH_LIMIT = 65536
SECRET_ASSIGNMENT = re.compile(r'(?i)((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|client[_-]?secret|private[_-]?key|credential|authorization)[\"\s]*[:=]\s*[\"\x27]?)([^\s\"\x27,;}]+)')


def sanitize_text(value, *, known_secrets=()):
    text = str(value or '')
    text = re.sub(r'-----BEGIN [^-\r\n]*(?:PRIVATE KEY|CERTIFICATE)-----.*?(?:-----END [^-\r\n]+-----|\Z)', '[REDACTED PEM]', text, flags=re.S)
    text = re.sub(r'(?i)(Bearer\s+)[^\s\"\x27,;}]+', r'\1[REDACTED]', text)
    text = re.sub(r'(?i)(https?://)[^\s/@]+:[^\s/@]+@', r'\1[REDACTED]@', text)
    text = re.sub(r'\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|glpat-[A-Za-z0-9_-]{8,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b', '[REDACTED]', text)
    text = SECRET_ASSIGNMENT.sub(lambda match: match[1] + ('Bearer' if match[2].lower() == 'bearer' else '[REDACTED]'), text)
    for secret in known_secrets:
        if secret:
            text = text.replace(str(secret), '[REDACTED]')
    return ''.join(char for char in text if char in '\n\r\t' or ord(char) >= 32)


class OutputSanitizer:
    def __init__(self, *, known_secrets=()):
        self.pending = {'stdout': '', 'stderr': ''}
        self.pem = {'stdout': False, 'stderr': False}
        self.overflow = {'stdout': False, 'stderr': False}
        self.known_secrets = tuple(known_secrets)

    def feed(self, stream, text, *, final=False):
        if stream not in self.pending:
            raise CoreError('invalid_stream', 'Output stream must be stdout or stderr', 422)
        output = []
        # Bounded complete lines prevent split-token redaction and UTF-8 damage.
        for part in str(text).splitlines(keepends=True):
            self.pending[stream] += part
            if len(self.pending[stream].encode('utf-8')) > LINE_LIMIT:
                self.pending[stream] = ''
                self.overflow[stream] = True
            if part.endswith(('\n', '\r')):
                output.extend(self._line(stream))
        if final and (self.pending[stream] or self.overflow[stream]):
            output.extend(self._line(stream))
        return output

    def _line(self, stream):
        line, self.pending[stream] = self.pending[stream], ''
        if self.overflow[stream]:
            self.overflow[stream] = False
            return ['[output line omitted: size limit]\n']
        if '-----BEGIN ' in line and ('PRIVATE KEY-----' in line or 'CERTIFICATE-----' in line):
            self.pem[stream] = True
            return ['[REDACTED PEM]\n']
        if self.pem[stream]:
            if '-----END ' in line:
                self.pem[stream] = False
            return []
        return [sanitize_text(line, known_secrets=self.known_secrets)] if line else []


def _scope(store, principal, workspace, permission='read'):
    if permission not in principal.permissions or (principal.workspace_ids is not None and workspace not in principal.workspace_ids):
        raise CoreError('forbidden', 'Execution workspace permission required', 403)
    store.get(principal, '', 'workspaces', workspace)


def _rows(store, conn, principal, workspace, run_id, node_id, attempt):
    query = select(store.events).where(store._scope(store.events, principal, workspace),
        store.events.c.entity_id == run_id, store.events.c.action == 'node.output')
    return [dict(row) for row in conn.execute(query.order_by(store.events.c.seq)).mappings()
            if row['data'].get('node_id') == node_id and row['data'].get('attempt') == attempt]


def _output_state_id(principal, workspace, run_id, node_id, attempt, owner):
    return digest(['execution.output.cursor', principal.tenant, principal.business, workspace, run_id, node_id, attempt, owner])


def output_source_seq(store, conn, principal, workspace, run_id, node_id, attempt, owner):
    state_id = _output_state_id(principal, workspace, run_id, node_id, attempt, owner)
    row = conn.execute(select(store.receipts.c.result).where(store.receipts.c.id == state_id)).first()
    if row:
        return row[0]['last_source_seq']
    return max((row['data']['source_seq'] for row in _rows(store, conn, principal, workspace, run_id, node_id, attempt)
                if row['data'].get('owner') == owner), default=0)


def append_run_events(store, principal, workspace, run_id, *, owner, attempt, node_id, events, idempotency_key, precondition=None):  # noqa: C901 - bounded authenticated cursor transaction
    _scope(store, principal, workspace, 'execute')
    if not isinstance(events, list) or not 1 <= len(events) <= 100:
        raise CoreError('invalid_output', 'A batch requires 1 to 100 events', 422)
    request = dict(owner=owner, attempt=attempt, node_id=node_id, events=events)
    if len(str(request).encode('utf-8')) > BATCH_LIMIT:
        raise CoreError('output_limit', 'Output batch is too large', 413)
    with store.transaction() as conn:
        if precondition:
            precondition(conn)
        run = store._get(conn, principal, workspace, 'runs', run_id)
        receipt_id, cached = store._receipt(conn, principal, workspace, 'run.output:' + run_id, idempotency_key, request)
        if cached is not None:
            return cached
        stop = run['data'].get('stop_request') or {}
        assignment = (run['status'] == 'running' and run['data'].get('execution_owner') == owner
                      and run['data'].get('active_node') == node_id and run['data'].get('attempt', 1) == attempt)
        stopped_assignment = (stop.get('owner') == owner and stop.get('attempt') == attempt
                              and stop.get('node_id') == node_id and stop.get('state') in {'requested', 'unknown'})
        # Current authorization is checked before an idempotent receipt is disclosed.
        if not assignment and not stopped_assignment:
            raise CoreError('lease_lost', 'Output does not belong to the current execution assignment', 409)
        rows = _rows(store, conn, principal, workspace, run_id, node_id, attempt)
        owned = [row for row in rows if row['data'].get('owner') == owner]
        state_id = _output_state_id(principal, workspace, run_id, node_id, attempt, owner)
        stored_state = conn.execute(select(store.receipts.c.result).where(store.receipts.c.id == state_id)).first()
        state = stored_state[0] if stored_state else {}
        if state.get('accepted_count', len(owned)) + len(events) > 4096:
            raise CoreError('output_limit', 'Assignment event budget exceeded', 413)
        last = state.get('last_source_seq', max((row['data']['source_seq'] for row in owned), default=0))
        sizes = state.get('sizes', {stream: sum(len(row['data'].get('text', '').encode('utf-8')) for row in owned
                              if row['data'].get('stream') == stream) for stream in ('stdout', 'stderr')})
        exhausted = state.get('exhausted', {stream: any(row['data'].get('capture_exhausted') for row in owned
                              if row['data'].get('stream') == stream) for stream in ('stdout', 'stderr')})
        sanitizer = OutputSanitizer()
        sanitizer.pem.update(state.get('pem', {}))
        cursor = state.get('cursor', rows[-1]['seq'] if rows else 0)
        for event in events:
            seq, stream = event.get('source_seq'), event.get('stream')
            text = event.get('text')
            if type(seq) is not int or seq != last + 1 or stream not in sizes or not isinstance(text, str):
                raise CoreError('output_sequence', 'Output batch must have contiguous source sequence and valid streams', 409)
            if len(text.encode('utf-8')) > LINE_LIMIT or ('\n' not in text and not event.get('final') and not event.get('truncated')):
                raise CoreError('invalid_output', 'Output events must contain bounded complete lines', 422)
            safe = ''.join(sanitizer.feed(stream, text, final=True))
            last = seq
            if exhausted[stream]:
                continue
            capture_exhausted = sizes[stream] + len(safe.encode('utf-8')) > STREAM_LIMIT
            truncated = bool(event.get('truncated')) or capture_exhausted
            if capture_exhausted:
                safe = '[output omitted: stream size limit]\n'
                exhausted[stream] = True
            sizes[stream] += len(safe.encode('utf-8'))
            data = dict(node_id=node_id, attempt=attempt, owner=owner, source_seq=seq, stream=stream,
                        text=safe, observed_at=str(event.get('observed_at') or now())[:80],
                        truncated=truncated, capture_exhausted=capture_exhausted, sanitized=bool(event.get('sanitized')) or safe != text, pem_open=sanitizer.pem[stream])
            result = conn.execute(insert(store.events).values(entity_id=run_id, tenant=principal.tenant, business=principal.business,
                workspace=workspace, action='node.output', actor=principal.actor, trace_id=uuid.uuid4().hex,
                version=run['version'], data=data, created_at=now()))
            cursor = result.inserted_primary_key[0]
            last = seq
        state = dict(last_source_seq=last, cursor=cursor, sizes=sizes, exhausted=exhausted,
                     pem=sanitizer.pem, accepted_count=state.get('accepted_count', len(owned)) + len(events))
        if stored_state:
            conn.execute(update(store.receipts).where(store.receipts.c.id == state_id).values(result=state))
        else:
            conn.execute(insert(store.receipts).values(id=state_id, request_hash=digest([run_id, node_id, attempt, owner]),
                                                       result=state, created_at=now()))
        ack = {'last_source_seq': last, 'cursor': cursor, 'count': len(events)}
        conn.execute(insert(store.receipts).values(id=receipt_id, request_hash=digest(request), result=ack, created_at=now()))
        return ack


def read_node_output(store, principal, workspace, run_id, node_id, attempt, *, stream='', after=0, limit=50):
    _scope(store, principal, workspace)
    run = store.get(principal, workspace, 'runs', run_id)
    if node_id not in {node['id'] for node in run['data'].get('nodes', [])}:
        raise CoreError('not_found', 'Run node not found', 404)
    if stream not in {'', 'stdout', 'stderr'} or type(attempt) is not int or type(after) is not int or after < 0 or not 1 <= limit <= 100:
        raise CoreError('invalid_output_query', 'Invalid output query', 422)
    with store.engine.connect() as conn:
        all_rows = [dict(row) for row in conn.execute(select(store.events).where(store._scope(store.events, principal, workspace),
            store.events.c.entity_id == run_id, store.events.c.action == 'node.output').order_by(store.events.c.seq)).mappings()
            if row['data'].get('node_id') == node_id]
    with store.engine.connect() as conn:
        evidence_rows = [dict(row) for row in conn.execute(select(store.events).where(store._scope(store.events, principal, workspace),
            store.events.c.entity_id == run_id).order_by(store.events.c.seq)).mappings()]
    historical = [(row, row['data']['result']) for row in evidence_rows
                  if row['data'].get('node_id') == node_id and isinstance(row['data'].get('result'), dict)]
    recorded = run['data'].get('node_results', {}).get(node_id)
    attempts = {run['data'].get('attempt', 1)} | {row['data']['attempt'] for row in all_rows}
    if recorded:
        attempts.add(recorded.get('attempt', 1))
    attempts.update(result.get('attempt', row['data'].get('attempt', 1)) for row, result in historical)
    if attempt not in attempts:
        raise CoreError('not_found', 'Node attempt is unavailable', 404)
    selected = [row for row in all_rows if row['data']['attempt'] == attempt and (not stream or row['data']['stream'] == stream)]
    page = [row for row in selected if row['seq'] > after][:limit + 1]
    more, page = len(page) > limit, page[:limit]
    chunks = [{'seq': row['seq'], **{key: value for key, value in row['data'].items() if key not in {'owner', 'pem_open', 'capture_exhausted'}}} for row in page]
    fallback_pair = next(((row, result) for row, result in reversed(historical)
                          if result.get('attempt', row['data'].get('attempt', 1)) == attempt), None)
    if not fallback_pair and recorded and recorded.get('attempt', 1) == attempt:
        # The latest row version proves the stored result projection; this is a
        # completed-result cursor, explicitly without an output source sequence.
        proof = next((row for row in reversed(evidence_rows) if row['version'] == run['version']), None)
        if proof:
            fallback_pair = (proof, recorded)
    source = 'live_capture' if selected else 'completed_node_result' if fallback_pair else 'unavailable'
    active = run['status'] == 'running' and run['data'].get('active_node') == node_id and attempt == run['data'].get('attempt', 1)
    fallback = None
    if source == 'completed_node_result':
        proof, result = fallback_pair
        fallback = {key: sanitize_text(result.get(key, ''))[-12000:] for key in ('stdout', 'stderr')}
        chunks = [dict(seq=proof['seq'], source_seq=0, node_id=node_id, attempt=attempt, stream=key,
                       text=value, observed_at=proof['created_at'], truncated=len(str(result.get(key, ''))) > 12000,
                       sanitized=value != str(result.get(key, ''))[-12000:]) for key, value in fallback.items()
                  if (not stream or stream == key) and proof['seq'] > after and value]
    complete = not active and run['status'] not in {'planned', 'queued', 'retrying', 'interrupted'}
    from .run_controls import pending_stop
    complete = complete and not pending_stop(run)
    return dict(chunks=chunks, next_seq=chunks[-1]['seq'] if chunks else after, more=more, complete=complete,
        availability='available' if source != 'unavailable' else 'pending' if active else 'unavailable', source=source,
        available_attempts=sorted(attempts), truncated=any(row['data'].get('truncated') for row in selected), sanitized=any(chunk.get('sanitized') for chunk in chunks),
        gaps=[{'after_seq': row['seq'], 'before_seq': None, 'reason': 'capture_limit'} for row in selected if row['data'].get('truncated')],
        fallback=fallback)
