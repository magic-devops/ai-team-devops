"""A durable terminal result can become physical-stop evidence after cancel."""
from argparse import Namespace

import pytest
from fastapi.testclient import TestClient
from hermes_core import remote_worker
from hermes_core.api import create_app
from hermes_core.models import Principal, RunAction
from hermes_core.remote_outbox import RemoteOutbox
from hermes_core.run_controls import apply_run_action, pending_stop, stop_view


@pytest.fixture
def race(tmp_path, monkeypatch):
    app = create_app(tmp_path / 'data', 'token')
    client = TestClient(app, headers={'Authorization': 'Bearer token'})
    base = '/api/hermes/v1'
    workspace = client.post(base + '/workspaces', json={'data': {'name': 'race', 'root': str(tmp_path)}, 'idempotency_key': 'workspace'}).json()['items'][0]
    client.headers['X-Workspace-Id'] = workspace['id']
    device = client.post(base + '/devices', json={'data': {'title': 'worker'}, 'idempotency_key': 'device'}).json()['items'][0]
    pair = client.post(base + f"/devices/{device['id']}/pairing", json={'expected_version': 1, 'idempotency_key': 'pair', 'dry_run': False}).json()['items'][0]
    paired = client.post(base + '/devices/pair', json={'device_id': device['id'], 'secret': pair['pairing_secret']}).json()['items'][0]
    credential = dict(server='http://127.0.0.1', device_id=device['id'], workspace_id=workspace['id'], credential=paired['credential'])
    headers = {'Authorization': 'Bearer ' + paired['credential'], 'X-Hermes-Device-Id': device['id']}
    store, execution, principal = app.state.hermes_store, app.state.hermes_execution, Principal('owner')
    run = store.create(principal, workspace['id'], 'runs', {'nodes': [{'id': 'test', 'argv': ['test']}],
        'target_device_id': device['id'], 'workspace_version': 1, 'attempt': 1}, 'run', 't', status='queued')
    claim = client.post(base + '/remote/claim', headers=headers, json={'idempotency_key': 'claim'}).json()['items'][0]
    outbox = RemoteOutbox(tmp_path / 'outbox', credential)
    original = outbox.journal_claim(claim, claim_idempotency_key='claim')
    outbox.save_events(original, [{'source_seq': 1, 'stream': 'stdout', 'text': 'done\n'}])
    record = outbox.save_result(original, dict(ok=True, exit_code=0, stdout='done\n', stderr='', duration_ms=1,
        process_tree_stopped=True, wait_completed=True, output_eof=True, backend='windows_job'))
    current = store.get(principal, workspace['id'], 'runs', run['id'])
    apply_run_action(store, execution, principal, workspace['id'], run['id'], 'cancel',
        RunAction(expected_version=current['version'], idempotency_key='cancel', dry_run=False))
    paths, failures = [], {}

    def request(server, path, body, credential=None, timeout=15):
        paths.append(path)
        failure = failures.pop(path, None)
        if failure == 'offline':
            raise remote_worker.RemoteRequestError('connection unavailable')
        response = client.post(path, headers=headers, json=body)
        if failure == 'drop_ack':
            assert response.status_code == 200, response.text
            raise remote_worker.RemoteRequestError('response lost after server committed')
        if response.status_code >= 400:
            raise remote_worker.RemoteRequestError('HTTP ' + str(response.status_code), status_code=response.status_code)
        return response.json()

    monkeypatch.setattr(remote_worker, '_request_json', request)
    return dict(store=store, principal=principal, workspace=workspace['id'], run_id=run['id'],
                credential=credential, outbox=outbox, record=record, paths=paths, failures=failures,
                args=Namespace(server=credential['server']))


def current(race):
    return race['store'].get(race['principal'], race['workspace'], 'runs', race['run_id'])


def test_pending_terminal_after_cancel_recovers_original_stop_with_logs_first(race):
    assert remote_worker.flush_pending(race['args'], race['credential'], race['outbox']) == (2, 0)
    assert race['paths'] == ['/api/hermes/v1/remote/events', '/api/hermes/v1/remote/result',
                             '/api/hermes/v1/remote/heartbeat', '/api/hermes/v1/remote/stop-ack']
    assert current(race)['status'] == 'cancelled'
    assert stop_view(current(race))['state'] == 'confirmed'
    assert not pending_stop(current(race))
    assert not race['outbox'].pending_records()
    assert not race['outbox'].has_quarantined()


@pytest.mark.parametrize('offline_path', ['/api/hermes/v1/remote/events', '/api/hermes/v1/remote/heartbeat'])
def test_offline_recovery_keeps_pending_proof_and_restart_does_not_execute(race, monkeypatch, offline_path):
    race['failures'][offline_path] = 'offline'
    acknowledged, retryable = remote_worker.flush_pending(race['args'], race['credential'], race['outbox'])
    assert retryable == 1
    assert not race['outbox'].has_quarantined()
    if offline_path.endswith('/events'):
        assert race['paths'] == [offline_path]
    reopened = RemoteOutbox(race['outbox'].path, race['credential'])

    def execute_forbidden(*args, **kwargs):
        raise AssertionError('terminal side effects must not run twice')

    monkeypatch.setattr(remote_worker, '_execute_task', execute_forbidden)
    assert remote_worker.run_once(race['args'], race['credential'], {}, 'unused', reopened)
    assert stop_view(current(race))['state'] == 'confirmed'
    assert not reopened.pending_records()
    assert not reopened.has_quarantined()


def test_stop_ack_lost_after_commit_restarts_from_durable_exact_receipt(race):
    race['failures']['/api/hermes/v1/remote/stop-ack'] = 'drop_ack'
    assert remote_worker.flush_pending(race['args'], race['credential'], race['outbox'])[1] == 1
    assert stop_view(current(race))['state'] == 'confirmed'
    reopened = RemoteOutbox(race['outbox'].path, race['credential'])
    assert any(record.get('kind') == 'stop' for record in reopened.pending_records())
    assert remote_worker.flush_pending(race['args'], race['credential'], reopened)[1] == 0
    events = race['store'].stream(race['principal'], race['workspace'], entity_id=race['run_id'])
    assert sum(event['action'] == 'run.stop_ack' for event in events) == 1
    assert not reopened.pending_records()
    assert not reopened.has_quarantined()


@pytest.mark.parametrize('mismatch', ['owner', 'attempt', 'node', 'proof', 'missing_stop'])
def test_recovery_never_acknowledges_another_assignment_or_missing_evidence(race, mismatch):
    record = race['record']
    if mismatch == 'owner':
        record = {**record, 'owner': 'remote:wrong-original-owner'}
    elif mismatch == 'attempt':
        record = {**record, 'task': {**record['task'], 'attempt': 2}}
    elif mismatch == 'node':
        record = {**record, 'node_id': 'wrong-node'}
    elif mismatch == 'proof':
        record = {**record, 'result': {**record['result'], 'process_tree_stopped': False}}
    else:
        run = current(race)
        race['store'].mutate(race['principal'], race['workspace'], 'runs', race['run_id'], operation='test.missing_stop',
            key='missing', request={}, trace='t', expected=run['version'],
            transform=lambda item: {'data': {**item['data'], 'stop_request': None}})
    race['outbox'].save(record)
    with pytest.raises(remote_worker.WorkerError):
        remote_worker.flush_pending(race['args'], race['credential'], race['outbox'])
    assert '/api/hermes/v1/remote/stop-ack' not in race['paths']
    assert race['outbox'].has_quarantined()
