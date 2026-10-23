"""Actual bounded quality/release projections, cursors and selected originals."""

import importlib
import importlib.util
import json
import re
from copy import deepcopy

import pytest
from fastapi import HTTPException
from sop_manager.routers.delivery_release import apply_release, preview
from sop_manager.routers.delivery_release_contract import ReleaseCandidateCreate, ReleaseCandidateReview
from sop_manager.routers.sql_models import (
    Base,
    DeliveryQueryFact,
    DeliveryQueryState,
    DeliveryWorkspace,
    Project,
    Requirement,
    Task,
    User,
)
from sqlalchemy import select, update
from test_delivery_query import rebuild, statements
from test_delivery_release import candidate_input, import_ci
from test_delivery_release import scope as release_scope
from test_delivery_release import trusted as release_trusted
from test_delivery_workbench import env as delivery_env

env, scope, trusted = delivery_env, release_scope, release_trusted


def query_api():
    name = 'sop_manager.routers.delivery_release_query'
    assert importlib.util.find_spec(name), 'Bounded quality/release query service is missing'
    return importlib.import_module(name)


def test_source_packet_http_uses_complete_scope_and_never_writes(indexed):
    client, sessions, actor, _ = indexed
    current = client.get('/api/v1/delivery/quality', params={'requirement_ids': ['R-release']}).json()
    policy = client.get('/api/v1/delivery/releases').json()['policy']
    body = {**current['selected'], 'scope_basis': current['scope_basis'], 'policy_generation': policy['generation'],
        'mappings': [{'task_id': row['id'], 'kind': 'no_code_change', 'comment': 'Explicit non-code scope'} for row in current['tasks']]}
    before = table_values(sessions)
    response = client.post('/api/v1/delivery/releases/source-packet', json=body)
    assert response.status_code == 200, response.text
    assert {row['task_id'] for row in response.json()['packet']['bindings']} == {'T-release'}
    assert response.json()['query_generation'] == current['query_generation']
    assert before == table_values(sessions)
    stale = client.post('/api/v1/delivery/releases/source-packet', json={**body, 'scope_basis': 'f' * 64})
    assert stale.status_code == 409
    actor['id'] = 'reader'
    denied = client.post('/api/v1/delivery/releases/source-packet', json=body)
    assert denied.status_code == 403
    assert before == table_values(sessions)


@pytest.fixture
def indexed(env, trusted):
    client, sessions, actor = env
    _, data, key = trusted
    with sessions() as db:
        project, user = db.get(Project, 'project'), db.get(User, 'lead')
        ids = []
        for number in range(1, 4):
            ci_id, _ = import_ci(db, project, user, data, key, run=number)
            body = candidate_input(ci_id).model_copy(update={'version': f'1.0.{number}', 'release_notes': 'PRIVATE RELEASE NOTES'})
            proposal = preview(db, project, data, user, body, version=0)
            rid, _, _ = apply_release(db, project, user, data, 'release.candidate.create', ReleaseCandidateCreate(**body.model_dump(), preview_basis=proposal['preview_basis']))
            ids.append((rid, ci_id))
        data['opaque'] = 'UNRELATED WORKSPACE ORIGINAL'
        data['flows']['R-release']['releases'] = [{'version': f'old-{i}', 'summary': 'A short history', 'private': 'PRIVATE LEGACY ORIGINAL'} for i in range(6)]
        data['members'] = [{'id': 'agent:duplicate', 'name': 'One', 'kind': 'agent', 'active': True}, {'id': 'agent:duplicate', 'name': 'Two', 'kind': 'agent', 'active': True}]
        db.add(DeliveryWorkspace(project_id='project', tenant_id='tenant', version=0, data=deepcopy(data)))
        db.add_all([Task(id=f'T-independent-{i}', tenant_id='tenant', project_id='project', title=f'Independent {i}', description='PRIVATE TASK ORIGINAL', acceptance_criteria=['Checked'], owner_id='user:lead') for i in range(5)])
        db.commit()
    rebuild(client)
    return client, sessions, actor, ids


def assert_narrow(sql):
    reads = [q.lower() for q in sql if q.lstrip().lower().startswith('select')]
    assert not any(re.search(r'(?:select|,)\s+delivery_workspaces\.data(?:\s|$)', q) for q in reads)
    assert not any('tasks.description' in q or 'requirements.description' in q for q in reads)


def test_catalogue_is_small_exact_count_and_independent_tasks_only(indexed):
    _, sessions, _, _ = indexed
    api = query_api()
    with sessions() as db, statements(sessions) as sql:
        result = api.quality_catalogue(db, db.get(Project, 'project'), db.get(User, 'lead'), {'kind': 'task', 'q': '', 'readiness': 'attention'}, limit=2)
    assert result['total'] == 5 and len(result['items']) == 2 and result['next_cursor']
    assert result['totals'] == {'requirements': 1, 'independent_tasks': 5}
    assert all(row['kind'] == 'task' and not row['ready'] and row['attention'] for row in result['items'])
    assert not any(key in row for row in result['items'] for key in ['proof', 'acceptance_criteria', 'task_ids'])
    assert 'PRIVATE' not in json.dumps(result)
    assert_narrow(sql)


def test_release_lists_are_independently_paged_without_originals(indexed):
    _, sessions, _, _ = indexed
    api = query_api()
    with sessions() as db, statements(sessions) as sql:
        project, user = db.get(Project, 'project'), db.get(User, 'lead')
        context = api.release_context(db, project, user)
        assert context['totals'] == {'candidate': 3, 'evidence': 3, 'legacy': 6}
        assert not {'evidence', 'candidates', 'legacy_history'} & context.keys()
        for kind, total in [('candidate', 3), ('evidence', 3), ('legacy', 6)]:
            result = api.release_page(db, project, user, kind, limit=1)
            assert result['total'] == total and len(result['items']) == 1 and result['next_cursor']
            assert not {'snapshot', 'reviews', 'review_basis', 'envelope', 'statement', 'record', 'valid', 'current'} & result['items'][0].keys()
            assert 'PRIVATE' not in json.dumps(result)
    assert_narrow(sql)


def test_release_cursor_binds_filter_actor_and_generation(indexed):
    _, sessions, _, _ = indexed
    api = query_api()
    with sessions() as db:
        project, user = db.get(Project, 'project'), db.get(User, 'lead')
        first = api.release_page(db, project, user, 'candidate', limit=1)
        second = api.release_page(db, project, user, 'candidate', limit=1, cursor=first['next_cursor'])
        assert first['items'][0]['id'] != second['items'][0]['id']
        for options in [{'q': 'other'}, {'kind': 'evidence'}, {'user': db.get(User, 'reader')}]:
            params = {'kind': 'candidate', 'limit': 1, 'cursor': first['next_cursor'], **options}
            reader = params.pop('user', user)
            with pytest.raises(HTTPException) as rejected:
                api.release_page(db, project, reader, **params)
            assert rejected.value.status_code == 422
        task = db.get(Task, 'T-independent-0')
        task.priority = 'P0'
        db.commit()
        with pytest.raises(HTTPException) as stale:
            api.release_page(db, project, user, 'candidate', limit=1, cursor=first['next_cursor'])
        assert stale.value.status_code == 409


def test_member_projection_keeps_every_duplicate_registry_position(indexed):
    _, sessions, _, _ = indexed
    with sessions() as db:
        row = db.scalar(select(DeliveryQueryFact).where(DeliveryQueryFact.project_id == 'project', DeliveryQueryFact.kind == 'member', DeliveryQueryFact.entity_id == 'agent:duplicate'))
        assert row is not None, 'Every ambiguous registered identity still needs an exact source locator'
        assert row.data.get('registry_positions') == [0, 1]
        assert not row.data['available']


def test_exact_candidate_and_evidence_read_only_selected_original(indexed):
    _, sessions, _, ids = indexed
    api = query_api()
    with sessions() as db, statements(sessions) as sql:
        project, user = db.get(Project, 'project'), db.get(User, 'lead')
        candidate = api.candidate_detail(db, project, user, ids[-1][0])
        evidence = api.evidence_detail(db, project, user, ids[-1][1])
        assert candidate['candidate']['id'] == ids[-1][0]
        assert candidate['candidate']['snapshot']['release_notes'] == 'PRIVATE RELEASE NOTES'
        assert evidence['evidence']['id'] == ids[-1][1] and evidence['envelope']
        assert candidate['query_generation'] == evidence['query_generation']
        assert 'UNRELATED WORKSPACE ORIGINAL' not in json.dumps(candidate)
        with pytest.raises(HTTPException) as unknown:
            api.candidate_detail(db, project, user, 'missing')
        assert unknown.value.status_code == 404
    assert any('JSON_EXTRACT' in q for q in sql)
    assert not any(re.search(r'(?:SELECT|,)\s+delivery_workspaces\.data(?:\s|$)', q) for q in sql)


def table_values(sessions):
    with sessions() as db:
        return {table.name: sorted([repr(tuple(row)) for row in db.execute(select(table))]) for table in Base.metadata.sorted_tables}


def test_http_contracts_and_gets_do_not_write_or_return_other_scope(indexed):
    client, sessions, _, ids = indexed
    before = table_values(sessions)
    responses = []
    with statements(sessions) as sql:
        for path, params in [('/quality/catalogue', {'limit': 1}), ('/quality', {'task_ids': 'T-independent-4'}),
            ('/releases', {}), ('/release-pages', {'kind': 'candidate', 'limit': 1}), ('/release-pages', {'kind': 'evidence', 'limit': 1}),
            ('/release-pages', {'kind': 'legacy', 'limit': 1}), ('/releases/' + ids[-1][0], {}), ('/release-evidence/' + ids[-1][1], {})]:
            response = client.get('/api/v1/delivery' + path, params=params)
            assert response.status_code == 200, response.text
            responses.append(response.json())
    assert len({(row['version'], row['query_generation']) for row in responses}) == 1
    chosen = responses[1]
    assert chosen['requirements'] == [] and [row['id'] for row in chosen['tasks']] == ['T-independent-4']
    assert chosen['summary']['tasks_total'] == 1 and chosen['summary']['requirements_total'] == 0
    assert client.get('/api/v1/delivery/quality').status_code == 422
    assert before == table_values(sessions)
    assert not any(re.match(r'\s*(insert|update|delete|replace)\b', q, re.I) for q in sql)


def test_exact_detail_rechecks_current_ci_and_reader_permissions(indexed):
    client, sessions, actor, ids = indexed
    first = client.get('/api/v1/delivery/release-evidence/' + ids[0][1])
    latest = client.get('/api/v1/delivery/release-evidence/' + ids[-1][1])
    assert not first.json()['evidence']['current']
    assert 'release_ci_superseded' in {row['code'] for row in first.json()['evidence']['reasons']}
    assert latest.json()['evidence']['current']
    actor['id'] = 'reader'
    response = client.get('/api/v1/delivery/releases/' + ids[-1][0])
    assert response.status_code == 200
    assert not any(response.json()['candidate']['permissions'].values())
    assert not any(response.json()['permissions'].values())


def test_scoped_requirement_keeps_canonical_basis_without_unrelated_rows(indexed):
    from sop_manager.routers.delivery_release import quality
    from sop_manager.routers.delivery_service import reconcile

    _, sessions, _, _ = indexed
    api = query_api()
    with sessions() as db:
        project = db.get(Project, 'project')
        data = reconcile(db, project, db.get(DeliveryWorkspace, 'project').data)
        expected = quality(db, project, data, requirement_ids=['R-release'])
        result = api.quality_scope(db, project, requirement_ids=['R-release'])
    assert result['scope_basis'] == expected['scope_basis'] and result['eligible'] == expected['eligible']
    assert [row['id'] for row in result['tasks']] == ['T-release']
    assert result['independent_tasks'] == [] and result['summary']['tasks_total'] == 1


def test_catalogue_filters_count_full_scope_and_escape_search(indexed):
    client, _, _, _ = indexed
    ready = client.get('/api/v1/delivery/quality/catalogue', params={'kind': 'requirement', 'readiness': 'ready', 'limit': 1})
    assert ready.status_code == 200 and ready.json()['total'] == 1
    assert ready.json()['items'][0]['id'] == 'R-release'
    percent = client.get('/api/v1/delivery/quality/catalogue', params={'q': '%'})
    assert percent.status_code == 200 and percent.json()['total'] == 0
    releases = client.get('/api/v1/delivery/release-pages', params={'kind': 'candidate', 'q': '1.0.2'})
    assert releases.status_code == 200 and releases.json()['total'] == 1


def test_old_schema_is_explicit_rebuild_without_read_fallback(indexed):
    client, sessions, _, _ = indexed
    with sessions() as db:
        db.connection().execute(update(DeliveryQueryState).values(schema_version=2))
        db.commit()
    before = table_values(sessions)
    for path in ['/quality/catalogue', '/releases', '/release-pages']:
        response = client.get('/api/v1/delivery' + path)
        assert response.status_code == 409
        assert response.json()['detail']['code'] == 'delivery_query_rebuild_required'
    assert before == table_values(sessions)


def test_deleted_scope_keeps_immutable_release_and_ci_visible_but_not_approvable(indexed):
    client, sessions, _, ids = indexed
    with sessions() as db:
        db.delete(db.get(Requirement, 'R-release'))
        db.commit()
    before = table_values(sessions)
    for path in ['/releases/' + ids[-1][0], '/release-evidence/' + ids[-1][1]]:
        response = client.get('/api/v1/delivery' + path)
        assert response.status_code == 200, response.text
        assert response.json()['envelope']
        value = response.json().get('candidate') or response.json()['evidence']
        assert 'release_scope_unavailable' in {reason['code'] for reason in value['reasons']}
        if 'candidate' in response.json():
            assert not value['permissions']['can_approve']
            assert value['permissions']['can_reject']
    assert before == table_values(sessions)


def test_unlatched_stale_detail_basis_matches_canonical_reconciled_command_view(indexed):
    from sop_manager.routers.delivery_release import _candidate_view
    from sop_manager.routers.delivery_service import reconcile

    _, sessions, _, ids = indexed
    # A legacy external change before the canonical capture has latched staleness.
    with sessions() as db:
        db.connection().execute(update(Task).where(Task.id == 'T-release').values(description='Uncaptured changed work'))
        db.commit()
    before = table_values(sessions)
    with sessions() as db:
        project, user = db.get(Project, 'project'), db.get(User, 'lead')
        raw = db.get(DeliveryWorkspace, 'project').data
        assert not raw['release_candidates'][-1]['invalidated']
        data = reconcile(db, project, raw)
        expected = _candidate_view(db, project, data, user, data['release_candidates'][-1])
        result = query_api().candidate_detail(db, project, user, ids[-1][0])['candidate']
    assert result['review_basis'] == expected['review_basis']
    assert result['invalidated'] == expected['invalidated'] is True
    assert before == table_values(sessions)


def test_sql_search_supports_id_commit_unicode_and_literal_wildcards(indexed):
    client, sessions, _, ids = indexed
    tests = [('/quality/catalogue', {'q': 'T-independent-4'}, 1),
        ('/release-pages', {'kind': 'candidate', 'q': ids[-1][0]}, 1),
        ('/release-pages', {'kind': 'evidence', 'q': ids[-1][1]}, 1),
        ('/release-pages', {'kind': 'candidate', 'q': 'b' * 40}, 3),
        ('/release-pages', {'kind': 'legacy', 'q': 'Release scope'}, 6)]
    with sessions() as db:
        db.get(Task, 'T-independent-0').title = '查询_%Alpha'
        db.commit()
    tests.extend([('/quality/catalogue', {'q': '查询_%'}, 1), ('/release-pages', {'kind': 'candidate', 'q': '%_'}, 0)])
    for path, params, expected in tests:
        response = client.get('/api/v1/delivery' + path, params=params)
        assert response.status_code == 200, response.text
        assert response.json()['total'] == expected, (params, response.json())


@pytest.mark.parametrize('decision', ['reject', 'revoke'])
def test_grown_scope_keeps_original_and_allows_control_but_not_approval(indexed, decision):
    client, sessions, _, ids = indexed
    with sessions() as db:
        db.add_all([Task(id=f'grown-{i}', tenant_id='tenant', project_id='project', req_id='R-release', title=f'New scope task {i}', owner_id='user:lead', acceptance_criteria=['New condition']) for i in range(500)])
        db.commit()
        frozen = deepcopy(db.get(DeliveryWorkspace, 'project').data['release_candidates'][-1]['snapshot'])
    before = table_values(sessions)
    assert client.get('/api/v1/delivery/quality', params={'requirement_ids': 'R-release'}).status_code == 413
    detail = client.get('/api/v1/delivery/releases/' + ids[-1][0])
    evidence = client.get('/api/v1/delivery/release-evidence/' + ids[-1][1])
    assert detail.status_code == evidence.status_code == 200, (detail.text, evidence.text)
    candidate = detail.json()['candidate']
    assert candidate['snapshot'] == frozen and not candidate['valid'] and not candidate['permissions']['can_approve']
    assert 'release_scope_check_incomplete' in {reason['code'] for reason in candidate['reasons']}
    assert not evidence.json()['evidence']['current']
    assert before == table_values(sessions)
    command = {'action': 'release.candidate.review', 'expected_version': detail.json()['version'], 'idempotency_key': 'budget-refuse-approval',
        'payload': {'id': ids[-1][0], 'decision': 'approve', 'comment': 'Must retain full gate', 'review_basis': candidate['review_basis']}}
    refused = client.post('/api/v1/delivery/commands', json=command)
    assert refused.status_code == 409, refused.text
    command.update(action='release.candidate.revoke' if decision == 'revoke' else 'release.candidate.review', idempotency_key='budget-control-' + decision)
    command['payload'].update(comment='Control the original candidate')
    if decision == 'revoke':
        command['payload'].pop('decision')
    else:
        command['payload']['decision'] = 'reject'
    controlled = client.post('/api/v1/delivery/commands', json=command)
    assert controlled.status_code == 200, controlled.text
    with sessions() as db:
        actual = db.get(DeliveryWorkspace, 'project').data['release_candidates'][-1]
        assert actual['decision'] == ('revoked' if decision == 'revoke' else 'rejected')
        assert actual['snapshot'] == frozen
        assert all(reason['code'] != 'release_scope_check_incomplete' for reason in actual['invalidated_reasons'])


@pytest.mark.parametrize('initial_decision', ['pending', 'approved'])
def test_budget_only_incomplete_is_unverified_and_never_latched(trusted, env, initial_decision, monkeypatch):
    from sop_manager.routers import delivery_quality_scope
    from sop_manager.routers.delivery_release import _candidate_view
    from sop_manager.routers.delivery_service import remember_basis

    client, sessions, _ = env
    _, data, key = trusted
    with sessions() as db:
        db.add_all([Task(id=f'original-{i}', tenant_id='tenant', project_id='project', req_id='R-release', title=f'Original task {i}', status='completed', owner_id='user:lead', acceptance_criteria=['Checked']) for i in range(2)])
        db.commit()
        project, user = db.get(Project, 'project'), db.get(User, 'lead')
        remember_basis(db, project, data)
        ci_id, _ = import_ci(db, project, user, data, key)
        body = candidate_input(ci_id)
        proposal = preview(db, project, data, user, body, version=0)
        release_id, _, _ = apply_release(db, project, user, data, 'release.candidate.create', ReleaseCandidateCreate(**body.model_dump(), preview_basis=proposal['preview_basis']))
        canonical = _candidate_view(db, project, data, user, data['release_candidates'][0])
        assert canonical['valid']
        if initial_decision == 'approved':
            apply_release(db, project, user, data, 'release.candidate.review', ReleaseCandidateReview(
                id=release_id, decision='approve', comment='Complete canonical proof passed', review_basis=canonical['review_basis']))
            canonical = _candidate_view(db, project, data, user, data['release_candidates'][0])
            assert canonical['valid']
        db.add(DeliveryWorkspace(project_id='project', tenant_id='tenant', version=0, data=data))
        db.commit()
    # Create a legal source packet first, then exercise the real bounded reader
    # under a smaller budget without changing the candidate's accepted scope.
    original_budget = delivery_quality_scope._Scope.budget

    def reduced_budget(scope, count):
        scope.limit = min(scope.limit, 2)
        return original_budget(scope, count)

    monkeypatch.setattr(delivery_quality_scope._Scope, 'budget', reduced_budget)
    before = table_values(sessions)
    detail = client.get('/api/v1/delivery/releases/' + release_id)
    assert detail.status_code == 200, detail.text
    value = detail.json()['candidate']
    assert value['status'] == 'unverified' and not value['valid'] and not value['invalidated']
    assert not value['permissions']['can_approve']
    assert value['permissions']['can_reject'] == (initial_decision == 'pending')
    assert value['permissions']['can_revoke']
    assert value['review_basis'] == canonical['review_basis']
    assert value['invalidated_reasons'] == []
    assert before == table_values(sessions)
    assert client.get('/api/v1/delivery/quality', params={'requirement_ids': 'R-release'}).status_code == 413
