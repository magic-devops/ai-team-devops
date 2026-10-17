import importlib.util
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from hermes_core.execution import Execution
from hermes_core.models import CoreError, Principal, RunAction
from hermes_core.transactional import Store


def runtime_module(name):
    assert importlib.util.find_spec('hermes_core.' + name), f'{name} runtime service is missing'
    return __import__('hermes_core.' + name, fromlist=[name])


@pytest.fixture
def runtime(tmp_path):
    store = Store('sqlite:///' + str(tmp_path / 'runtime.sqlite'))
    principal = Principal('owner')
    workspace = store.create(principal, '', 'workspaces', {'root': str(tmp_path)}, 'workspace', 't')
    execution = Execution(store, tmp_path)
    execution.available = lambda: True
    run = store.create(principal, workspace['id'], 'runs', {
        'nodes': [{'id': 'test', 'argv': ['test']}], 'workspace_version': 1,
        'workspace_root': str(tmp_path), 'execution_owner': 'assignment-owner-1',
        'lease_expires_at': time.time() + 120, 'active_node': 'test', 'attempt': 1,
    }, 'run', 't', status='running')
    return store, execution, principal, workspace['id'], run


def test_output_is_durable_without_advancing_run_version(runtime):
    module = runtime_module('run_output')
    store, _, principal, workspace, run = runtime
    event = {'source_seq': 1, 'stream': 'stdout', 'text': 'hello\n', 'observed_at': 'now'}
    args = dict(owner='assignment-owner-1', attempt=1, node_id='test', events=[event], idempotency_key='batch')
    ack = module.append_run_events(store, principal, workspace, run['id'], **args)
    assert module.append_run_events(store, principal, workspace, run['id'], **args) == ack
    assert store.get(principal, workspace, 'runs', run['id'])['version'] == run['version']
    output = module.read_node_output(store, principal, workspace, run['id'], 'test', 1)
    assert [chunk['text'] for chunk in output['chunks']] == ['hello\n']
    assert output['source'] == 'live_capture'
    with pytest.raises(CoreError):
        module.append_run_events(store, principal, workspace, run['id'], **{**args, 'events': [{**event, 'text': 'different'}]})
    with pytest.raises(CoreError):
        module.read_node_output(store, principal, workspace, run['id'], 'missing', 1)


def test_stream_budget_has_one_marker_and_keeps_compact_ack_cursor(runtime, monkeypatch):
    module = runtime_module('run_output')
    monkeypatch.setattr(module, 'STREAM_LIMIT', 10)
    store, _, principal, workspace, run = runtime
    for seq in range(1, 6):
        ack = module.append_run_events(store, principal, workspace, run['id'], owner='assignment-owner-1', attempt=1,
            node_id='test', events=[{'source_seq': seq, 'stream': 'stdout', 'text': 'aaaa\n'}], idempotency_key=str(seq))
    output = module.read_node_output(store, principal, workspace, run['id'], 'test', 1)
    assert len(output['chunks']) == 3
    assert sum(chunk['truncated'] for chunk in output['chunks']) == 1
    assert ack['last_source_seq'] == 5


def test_running_cancel_requires_physical_stop_receipt(runtime):
    module = runtime_module('run_controls')
    store, execution, principal, workspace, run = runtime
    body = RunAction(expected_version=1, idempotency_key='cancel', dry_run=False)
    cancelled = module.apply_run_action(store, execution, principal, workspace, run['id'], 'cancel', body)
    assert cancelled['status'] == 'cancelled'
    assert module.pending_stop(cancelled)
    stop = cancelled['data']['stop_request']
    assert stop['owner'] == 'assignment-owner-1'
    assert module.stop_view(cancelled)['state'] == 'requested'
    assert 'owner' not in module.stop_view(cancelled)
    with pytest.raises(CoreError):
        module.acknowledge_stop(store, principal, workspace, run['id'], request_id=stop['id'], owner='wrong', attempt=1,
            node_id='test', evidence={'process_tree_stopped': True}, final_source_seq=0, idempotency_key='bad')
    stopped = module.acknowledge_stop(store, principal, workspace, run['id'], request_id=stop['id'], owner=stop['owner'], attempt=1,
        node_id='test', evidence={'process_tree_stopped': True, 'wait_completed': True, 'output_eof': True},
        final_source_seq=0, idempotency_key='ack')
    assert module.stop_view(stopped)['state'] == 'confirmed'
    assert not module.pending_stop(stopped)


def test_log_sanitizer_handles_chunk_split_and_pem(runtime):
    module = runtime_module('run_output')
    sanitizer = module.OutputSanitizer()
    assert sanitizer.feed('stdout', 'Authorization: Bea') == []
    assert sanitizer.feed('stdout', 'rer abc-secret\n') == ['Authorization: Bearer [REDACTED]\n']
    assert sanitizer.feed('stdout', '-----BEGIN PRIVATE KEY-----\n') == ['[REDACTED PEM]\n']
    assert sanitizer.feed('stdout', 'private-body\n') == []
    assert sanitizer.feed('stdout', '-----END PRIVATE KEY-----\nafter\n') == ['after\n']
    assert 'secret' not in module.sanitize_text('password=secret https://user:secret@host/path')


def test_unlabelled_provider_tokens_and_generic_secret_fields_are_redacted():
    module = runtime_module('run_output')
    secrets = ['sk-proj-abcdefghijklmnop', 'ghp_abcdefghijklmnop', 'github_pat_abcdefghijklm',
               'glpat-abcdefghijklmnop', 'AKIA1234567890123456']
    for secret in secrets:
        assert secret not in module.sanitize_text('debug ' + secret)
    for key in ('token', 'client_secret', 'private_key'):
        assert 'supersecret' not in module.sanitize_text(key + '=supersecret')


def test_managed_generic_write_is_rejected_before_receipt(runtime):
    module = runtime_module('run_controls')
    store, execution, principal, workspace, run = runtime
    task = store.create(principal, workspace, 'tasks', {'source': {'kind': 'manager.delivery'}}, 'task', 't')
    run = store.mutate(principal, workspace, 'runs', run['id'], operation='bind', key='bind', request={}, trace='t', expected=1,
        transform=lambda item: {'data': {**item['data'], 'task_source': {'task_id': task['id']}}})
    with pytest.raises(CoreError) as error:
        module.apply_run_action(store, execution, principal, workspace, run['id'], 'cancel',
            RunAction(expected_version=run['version'], idempotency_key='cancel', dry_run=False))
    assert error.value.code == 'managed_execution'


def test_paired_output_batches_are_independent_durable_and_precede_result(tmp_path):
    from hermes_core.remote_outbox import RemoteOutbox
    credential = {'server': 'http://127.0.0.1:8000', 'device_id': 'device', 'workspace_id': 'workspace', 'credential': 'secret-token'}
    outbox = RemoteOutbox(tmp_path / 'outbox', credential)
    assert hasattr(outbox, 'save_events'), 'paired output needs independent durable batches'
    task = {'run_id': 'run', 'owner': 'assignment-owner', 'workspace_id': 'workspace', 'attempt': 1, 'node': {'id': 'test'}}
    record = outbox.journal_claim(task, claim_idempotency_key='claim')
    event = {'source_seq': 1, 'stream': 'stdout', 'text': 'hello\n'}
    outbox.save_events(record, [event])
    outbox.save_result(record, {'exit_code': 0})
    reopened = RemoteOutbox(tmp_path / 'outbox', credential)
    pending = reopened.pending_records()
    assert [entry.get('kind', 'result') for entry in pending] == ['output', 'result']
    assert 'task' not in pending[0]


def test_actual_native_output_is_readable_during_execution_and_cancel_stops_tree(runtime, tmp_path):
    binary = os.environ.get('HERMES_TEST_AGENTD')
    if not binary or not Path(binary).is_file():
        pytest.skip('HERMES_TEST_AGENTD is required for the real process contract')
    from hermes_core.run_controls import apply_run_action, stop_view
    from hermes_core.run_output import read_node_output
    store, execution, principal, workspace, run = runtime
    execution.agentd = binary
    program = ("import subprocess,sys,time; from pathlib import Path; "
               "p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)']); "
               "Path('grandchild.pid').write_text(str(p.pid)); "
               "print('Authorization: Bearer secret-value',flush=True); "
               "print('error 世界',file=sys.stderr,flush=True); time.sleep(60)")
    run = store.mutate(principal, workspace, 'runs', run['id'], operation='queue', key='queue', request={}, trace='t', expected=1,
        transform=lambda item: {'status': 'queued', 'data': {**item['data'], 'nodes': [{'id': 'test', 'argv': [sys.executable, '-c', program], 'timeout_seconds': 120}]}})
    with ThreadPoolExecutor() as pool:
        future = pool.submit(execution.execute, principal, workspace, run['id'])
        deadline = time.monotonic() + 10
        output = {'chunks': []}
        while time.monotonic() < deadline:
            output = read_node_output(store, principal, workspace, run['id'], 'test', 1)
            if len(output['chunks']) >= 2:
                break
            time.sleep(.03)
        assert len(output['chunks']) >= 2, output
        assert not future.done()
        assert 'secret-value' not in str(output)
        current = store.get(principal, workspace, 'runs', run['id'])
        apply_run_action(store, execution, principal, workspace, run['id'], 'cancel',
            RunAction(expected_version=current['version'], idempotency_key='live-cancel', dry_run=False))
        future.result(timeout=15)
    stopped = store.get(principal, workspace, 'runs', run['id'])
    assert stop_view(stopped)['state'] == 'confirmed', stopped
    pid = int((tmp_path / 'grandchild.pid').read_text())
    if os.name == 'nt':
        import ctypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.restype = ctypes.c_void_p
        handle = kernel.OpenProcess(0x100000, False, pid)
        if handle:
            assert kernel.WaitForSingleObject(ctypes.c_void_p(handle), 0) == 0
            kernel.CloseHandle(ctypes.c_void_p(handle))
    else:
        with pytest.raises(ProcessLookupError):
            os.kill(pid, 0)


@pytest.mark.parametrize('expired', [False, True])
def test_remote_original_assignment_can_append_and_ack_after_owner_cleared(tmp_path, expired):
    from fastapi.testclient import TestClient
    from hermes_core.api import create_app
    from hermes_core.run_controls import apply_run_action, pending_stop, stop_view
    app = create_app(tmp_path / 'data', 'token')
    client = TestClient(app, headers={'Authorization': 'Bearer token'})
    base = '/api/hermes/v1'
    workspace = client.post(base + '/workspaces', json={'data': {'name': 'scope', 'root': str(tmp_path)}, 'idempotency_key': 'workspace'}).json()['items'][0]
    client.headers['X-Workspace-Id'] = workspace['id']
    device = client.post(base + '/devices', json={'data': {'title': 'worker'}, 'idempotency_key': 'device'}).json()['items'][0]
    pairing = client.post(base + f"/devices/{device['id']}/pairing", json={'expected_version': 1, 'idempotency_key': 'pair', 'dry_run': False}).json()['items'][0]
    paired = client.post(base + '/devices/pair', json={'device_id': device['id'], 'secret': pairing['pairing_secret']}).json()['items'][0]
    headers = {'Authorization': 'Bearer ' + paired['credential'], 'X-Hermes-Device-Id': device['id']}
    store, execution = app.state.hermes_store, app.state.hermes_execution
    principal = Principal('local')
    run = store.create(principal, workspace['id'], 'runs', {'nodes': [{'id': 'test', 'argv': ['test']}],
        'target_device_id': device['id'], 'workspace_version': 1, 'attempt': 1}, 'run', 't', status='queued')
    claim = client.post(base + '/remote/claim', headers=headers, json={'idempotency_key': 'claim'}).json()['items'][0]
    current = store.get(principal, workspace['id'], 'runs', run['id'])
    if expired:
        store.mutate(principal, workspace['id'], 'runs', run['id'], operation='expire', key='expire', request={}, trace='t', expected=current['version'],
            transform=lambda item: {'data': {**item['data'], 'lease_expires_at': time.time() - 1}})
    else:
        apply_run_action(store, execution, principal, workspace['id'], run['id'], 'cancel',
            RunAction(expected_version=current['version'], idempotency_key='cancel', dry_run=False))
    beat = client.post(base + '/remote/heartbeat', headers=headers, json={'run_id': run['id'], 'owner': claim['owner'], 'idempotency_key': 'beat'})
    assert beat.status_code == 200, beat.text
    stop = beat.json()['items'][0]['stop_request']
    assert stop['state'] == ('unknown' if expired else 'requested')
    body = dict(run_id=run['id'], owner=claim['owner'], node_id='test', attempt=1, idempotency_key='output',
                events=[{'source_seq': 1, 'stream': 'stdout', 'text': 'late output\n'}])
    response = client.post(base + '/remote/events', headers=headers, json=body)
    assert response.status_code == 200, response.text
    ack = dict(run_id=run['id'], owner=claim['owner'], node_id='test', attempt=1, request_id=stop['id'],
               idempotency_key='stop-ack', final_source_seq=0,
               evidence={'process_tree_stopped': True, 'wait_completed': True, 'output_eof': True})
    assert client.post(base + '/remote/stop-ack', headers=headers, json=ack).status_code == 409
    ack['final_source_seq'] = 1
    response = client.post(base + '/remote/stop-ack', headers=headers, json=ack)
    assert response.status_code == 200, response.text
    current = store.get(principal, workspace['id'], 'runs', run['id'])
    assert stop_view(current)['state'] == 'confirmed'
    assert not pending_stop(current)
    assert client.post(base + '/remote/events', headers=headers, json=body).status_code == 200


def test_public_task_source_cannot_forge_or_remove_manager_provenance(tmp_path):
    from fastapi.testclient import TestClient
    from hermes_core.api import create_app
    app = create_app(tmp_path / 'data', 'token')
    client = TestClient(app, headers={'Authorization': 'Bearer token'})
    base = '/api/hermes/v1'
    workspace = client.post(base + '/workspaces', json={'data': {'name': 'scope', 'root': str(tmp_path)}, 'idempotency_key': 'workspace'}).json()['items'][0]
    client.headers['X-Workspace-Id'] = workspace['id']
    forged = client.post(base + '/tasks', json={'data': {'title': 'forged', 'source': {'kind': 'manager.delivery'}}, 'idempotency_key': 'forge'})
    assert forged.status_code == 422
    task = app.state.hermes_store.create(Principal('local-owner'), workspace['id'], 'tasks',
        {'title': 'real envelope', 'source': {'kind': 'manager.delivery'}}, 'real', 't')
    modified = client.patch(base + '/tasks/' + task['id'], json={'data': {'source': {}}, 'expected_version': 1, 'idempotency_key': 'remove'})
    assert modified.status_code == 409
