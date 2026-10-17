"""Shared authorized run operations and physical stop receipts."""
from __future__ import annotations

import time
import uuid
from datetime import datetime

from .agents import validate_bound_profiles
from .execution_targets import validate_execution_target_snapshot
from .models import CoreError
from .transactional import digest, now


def stop_view(run, *, now=None):
    stop = run.get('data', {}).get('stop_request')
    if not stop:
        data = run.get('data', {})
        if run.get('status') in {'completed', 'failed', 'cancelled'} and not data.get('active_node'):
            results = data.get('node_results', {})
            executed = [(node['id'], results[node['id']]) for node in data.get('nodes', [])
                        if node.get('kind', 'command') != 'approval' and node['id'] in results and not results[node['id']].get('skipped')]
            if executed and all(all(result.get(key) is True for key in ('process_tree_stopped', 'wait_completed', 'output_eof')) for _, result in executed):
                node_id, result = executed[-1]
                return dict(id='terminal-node-evidence', state='confirmed', reason='terminal_node_evidence', node_id=node_id,
                            attempt=result.get('attempt', 1), requested_at=None, confirmed_at=run.get('updated_at'),
                            evidence={key: result[key] for key in ('process_tree_stopped', 'wait_completed', 'output_eof', 'exit_code', 'backend') if key in result})
        if run.get('status') in {'cancelled', 'failed', 'completed'} and (data.get('active_node') or data.get('execution_owner')):
            return dict(id='unrecorded', state='unknown', reason='stop_receipt_unrecorded', node_id=data.get('active_node'),
                        attempt=data.get('attempt', 1), requested_at=None, confirmed_at=None, evidence=None)
        return None
    result = {key: stop.get(key) for key in ('id', 'state', 'reason', 'node_id', 'attempt', 'requested_at', 'confirmed_at')}
    from .run_output import sanitize_text
    result['reason'] = sanitize_text(result['reason'])
    if result['state'] == 'requested':
        try:
            current = time.time() if now is None else now
            requested = datetime.fromisoformat(stop['requested_at']).timestamp()
            if current - requested > 30:
                result['state'] = 'unknown'
        except (TypeError, ValueError):
            result['state'] = 'unknown'
    evidence = stop.get('evidence')
    result['evidence'] = {key: evidence[key] for key in ('process_tree_stopped', 'wait_completed', 'output_eof', 'exit_code', 'backend')
                          if key in evidence} if isinstance(evidence, dict) else None
    return result


def pending_stop(run):
    stop = stop_view(run)
    return bool(stop and stop['state'] in {'requested', 'unknown'})


def stop_request_data(run, reason, *, state='unknown'):
    """Freeze an assignment before ownership is cleared, including lease loss."""
    data = run['data']
    existing = data.get('stop_request')
    if existing:
        return existing
    return dict(id=uuid.uuid4().hex, state=state, reason=reason, owner=data.get('execution_owner'),
                node_id=data.get('active_node'), attempt=data.get('attempt', 1), requested_at=now(),
                confirmed_at=None, evidence=None)


def _authorize(store, principal, workspace, permission):
    if permission not in principal.permissions or (principal.workspace_ids is not None and workspace not in principal.workspace_ids):
        raise CoreError('forbidden', 'Execution workspace permission required', 403)
    return store.get(principal, '', 'workspaces', workspace)


def _managed(store, principal, workspace, run, managed):
    if run['data'].get('deployment_source'):
        raise CoreError('managed_deployment', 'Use the managed deployment operation', 409)
    source = run['data'].get('task_source') or {}
    if source.get('task_id'):
        task = store.get(principal, workspace, 'tasks', source['task_id'])
        if task['data'].get('source', {}).get('kind') == 'manager.delivery' and not managed:
            raise CoreError('managed_execution', 'Use the project delivery execution control', 409)


def apply_run_action(store, execution, principal, workspace, run_id, action, body, *, managed=False, receipt_request=None):  # noqa: C901 - shared authorization and transactional state machine
    _authorize(store, principal, workspace, 'execute')
    run = store.get(principal, workspace, 'runs', run_id)
    _managed(store, principal, workspace, run, managed)
    if action not in {'start', 'retry', 'cancel'}:
        raise CoreError('unknown_action', 'Unsupported run control', 404)
    request = body.model_dump() if receipt_request is None else receipt_request
    if not body.dry_run:
        cached = store.receipt(principal, workspace, f'run.{action}:{run_id}', body.idempotency_key, request)
        if cached is not None:
            return cached
    if run['version'] != body.expected_version:
        raise CoreError('version_conflict', 'Run changed; reload before applying this action', 409)
    if action in {'start', 'retry'} and run['data'].get('task_source'):
        task = store.get(principal, workspace, 'tasks', run['data']['task_source']['task_id'])
        link = task['data'].get('delivery', {})
        if link.get('run_id') != run_id or link.get('phase') != 'executing':
            raise CoreError('delivery_closed', 'Dispatch a new plan from the task before executing', 409)
    allowed = {'start': {'planned'}, 'retry': {'failed'}, 'cancel': {'planned', 'queued', 'running', 'interrupted', 'retrying'}}
    if managed:
        allowed['start'].add('queued')
    if run['status'] not in allowed[action]:
        raise CoreError('invalid_transition', f"Cannot {action} a {run['status']} run", 409)
    if action == 'retry' and run['data'].get('recovery_requires_review') and 'approve' not in principal.permissions:
        raise CoreError('forbidden', 'Review external side effects before retrying', 403)

    def guard(conn):
        current = store._get(conn, principal, workspace, 'runs', run_id)
        if action == 'cancel':
            return
        if pending_stop(current):
            raise CoreError('stop_unconfirmed', 'Physical execution stop is not confirmed', 409)
        workspace_row = store._get(conn, principal, '', 'workspaces', workspace)
        if workspace_row['status'] != 'active' or current['data'].get('workspace_version') != workspace_row['version']:
            raise CoreError('workspace_changed', 'Workspace configuration changed; prepare a newly reviewed run', 409)
        source = current['data'].get('task_source')
        if source:
            task = store._get(conn, principal, workspace, 'tasks', source['task_id'])
            link = task['data'].get('delivery', {})
            if link.get('run_id') != run_id or link.get('phase') != 'executing':
                raise CoreError('delivery_closed', 'Dispatch a new plan from the task before executing', 409)
        validate_bound_profiles(store, conn, principal, workspace, current['data'].get('agent_bindings', {}))
        if current['data'].get('target_snapshot'):
            for node in current['data'].get('nodes', []):
                provider = current['data'].get('agent_bindings', {}).get(node['id'], {}).get('profile', {}).get('provider', '')
                validate_execution_target_snapshot(store, execution, principal, workspace, current['data']['target_snapshot'], provider=provider, conn=conn)

    def transition(item):
        if item['status'] not in allowed[action]:
            raise CoreError('invalid_transition', f"Cannot {action} a {item['status']} run", 409)
        if action in {'start', 'retry'}:
            if not item['data'].get('target_device_id') and not execution.available():
                raise CoreError('executor_unavailable', 'Configure the local execution agent first', 503)
            data = {**item['data']}
            if action == 'retry':
                data.update(attempt=data.get('attempt', 1) + 1, stop_request=None)
            return {'status': 'queued' if action == 'start' else 'retrying', 'data': data}
        data = item['data']
        owner = data.get('execution_owner')
        requested = item['status'] == 'running' and bool(owner)
        stop = dict(id=uuid.uuid4().hex, state='requested' if requested else 'not_started',
                    reason=str(request.get('payload', {}).get('reason') or request.get('reason') or 'user_cancel')[:2000], owner=owner,
                    node_id=data.get('active_node'), attempt=data.get('attempt', 1), requested_at=now(),
                    confirmed_at=None, evidence=None)
        return {'status': 'cancelled', 'data': {**data, 'execution_owner': None, 'lease_expires_at': None, 'stop_request': stop}}

    if body.dry_run:
        with store.engine.connect() as conn:
            guard(conn)
        return run
    return store.mutate(principal, workspace, 'runs', run_id, operation='run.' + action,
        key=body.idempotency_key, request=request, trace=uuid.uuid4().hex, expected=body.expected_version,
        transform=transition, precondition=guard)


def acknowledge_stop(store, principal, workspace, run_id, *, request_id, owner, attempt, node_id, evidence, final_source_seq, idempotency_key, precondition=None):
    _authorize(store, principal, workspace, 'execute')
    if type(final_source_seq) is not int or final_source_seq < 0 or not isinstance(evidence, dict):
        raise CoreError('invalid_stop_receipt', 'Invalid stop receipt', 422)
    request = dict(request_id=request_id, owner=owner, attempt=attempt, node_id=node_id,
                   evidence=evidence, final_source_seq=final_source_seq)

    def record(item):
        stop = item['data'].get('stop_request') or {}
        if (stop.get('id'), stop.get('owner'), stop.get('attempt'), stop.get('node_id')) != (request_id, owner, attempt, node_id):
            raise CoreError('stop_assignment', 'Stop receipt belongs to a different assignment', 409)
        if stop.get('state') not in {'requested', 'unknown', 'confirmed'}:
            raise CoreError('stop_closed', 'Stop does not require a process receipt', 409)
        if not all(evidence.get(key) is True for key in ('process_tree_stopped', 'wait_completed', 'output_eof')):
            raise CoreError('stop_unconfirmed', 'Process tree, wait and output EOF must all be confirmed', 409)
        safe = {key: evidence[key] for key in ('process_tree_stopped', 'wait_completed', 'output_eof', 'exit_code', 'backend') if key in evidence}
        if 'exit_code' in safe and type(safe['exit_code']) is not int:
            raise CoreError('invalid_stop_receipt', 'Stop exit code must be an integer', 422)
        if safe.get('backend') not in {'windows_job', 'posix_process_group'}:
            safe.pop('backend', None)
        return {'data': {**item['data'], 'stop_request': {**stop, 'state': 'confirmed', 'confirmed_at': now(), 'evidence': safe}}}

    def guard(conn):
        if precondition:
            precondition(conn)
        from .run_output import output_source_seq
        last = output_source_seq(store, conn, principal, workspace, run_id, node_id, attempt, owner)
        if last != final_source_seq:
            raise CoreError('output_pending', 'Output must be acknowledged before the stop receipt', 409)

    return store.mutate(principal, workspace, 'runs', run_id, operation='run.stop_ack', key=idempotency_key,
        request=request, trace=uuid.uuid4().hex, expected=None, transform=record, precondition=guard)


def decide_approval(store, execution, principal, workspace, approval_id, body, *, managed=False, receipt_request=None):  # noqa: C901 - approval validation and crash recovery
    _authorize(store, principal, workspace, 'approve')
    if body.decision == 'approve':
        _authorize(store, principal, workspace, 'execute')
    approval = store.get(principal, workspace, 'approvals', approval_id)
    run_id = approval['data']['run_id']
    run = store.get(principal, workspace, 'runs', run_id)
    _managed(store, principal, workspace, run, managed)
    request = body.model_dump() if receipt_request is None else receipt_request

    def guard(conn):
        current = store._get(conn, principal, workspace, 'runs', run_id)
        definition = {key: current['data'].get(key) for key in ('nodes', 'workspace_root', 'workspace_version', 'isolation', 'base_commit', 'agent_bindings', 'agent_source')}
        if digest(definition) != approval['data']['definition_hash'] or approval['data'].get('attempt', 1) != current['data'].get('attempt', 1):
            raise CoreError('approval_stale', 'Approval no longer matches the run definition and attempt', 409)
        if current['status'] != 'interrupted' or current['data'].get('active_node') != approval['data'].get('node_id') or pending_stop(current):
            raise CoreError('approval_closed', 'Run is no longer waiting at this approval', 409)
        if body.decision == 'approve':
            workspace_row = store._get(conn, principal, '', 'workspaces', workspace)
            if workspace_row['status'] != 'active' or current['data'].get('workspace_version') != workspace_row['version']:
                raise CoreError('approval_stale', 'Workspace changed after approval was requested', 409)
            validate_bound_profiles(store, conn, principal, workspace, current['data'].get('agent_bindings', {}))
            if current['data'].get('target_snapshot'):
                for node in current['data'].get('nodes', []):
                    provider = current['data'].get('agent_bindings', {}).get(node['id'], {}).get('profile', {}).get('provider', '')
                    validate_execution_target_snapshot(store, execution, principal, workspace, current['data']['target_snapshot'], provider=provider, conn=conn)

    def transform(item):
        if item['status'] != 'pending':
            raise CoreError('approval_closed', 'Approval is no longer pending', 409)
        return {'status': 'approved' if body.decision == 'approve' else 'rejected',
                'data': {**item['data'], 'decision': body.decision, 'decided_by': principal.actor}}

    if body.dry_run:
        with store.engine.connect() as conn:
            guard(conn)
        if approval['version'] != body.expected_version or approval['status'] != 'pending':
            raise CoreError('approval_closed', 'Approval changed', 409)
        return {'approval': approval, 'run': run, 'resume': None}
    result = store.mutate(principal, workspace, 'approvals', approval_id, operation='approval.decision',
        key=body.idempotency_key, request=request, trace=uuid.uuid4().hex,
        expected=body.expected_version, transform=transform, precondition=guard)
    current = store.get(principal, workspace, 'runs', run_id)
    resume = None
    if current['status'] == 'interrupted' and current['data'].get('active_node') == result['data'].get('node_id'):
        if result['status'] == 'approved':
            resume = {'approval_id': approval_id, 'approval_version': result['version']}
        elif result['status'] == 'rejected':
            current = store.mutate(principal, workspace, 'runs', run_id, operation='approval.rejected', key=body.idempotency_key,
                request=request, trace=uuid.uuid4().hex, expected=current['version'], transform=lambda item: {
                    'status': 'failed', 'data': {**item['data'], 'error': 'Execution approval was rejected',
                    'execution_owner': None, 'lease_expires_at': None, 'recovery_requires_review': False,
                    'stop_request': stop_request_data(item, 'approval_rejected', state='not_started')}})
    return {'approval': result, 'run': current, 'resume': resume}
