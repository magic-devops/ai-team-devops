"""Lifecycle and project configuration have one explicit write contract."""

from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from sop_manager.routers.delivery_contract import PAYLOADS, Command, ProjectEdit
from test_delivery_workbench import env  # noqa: F401


@pytest.mark.parametrize('changes', [
    {'target_status': 'deleted'}, {'target_status': True},
    {'reason': ''}, {'reason': None}, {'reason': 'x' * 2001},
    {'preview_basis': 'latest'}, {'status': 'archived'},
    {'from_status': 'active'}, {'version': 3},
])
def test_lifecycle_does_not_accept_guessed_state_or_missing_basis(changes):
    with pytest.raises(ValidationError):
        PAYLOADS['project.lifecycle'].model_validate({
            'target_status': 'archived', 'reason': 'Completed investigation',
            'preview_basis': 'a' * 64, **changes,
        })


def test_lifecycle_is_an_explicit_versioned_command():
    body = Command(action='project.lifecycle', payload={
        'target_status': 'paused', 'reason': 'Await delivery window', 'preview_basis': 'a' * 64,
    }, expected_version=3, idempotency_key='lifecycle-fixed-key')
    assert PAYLOADS[body.action].model_validate(body.payload).target_status == 'paused'


def test_project_metadata_extends_existing_command_without_status_alias():
    draft = ProjectEdit.model_validate({
        'business_id': None, 'project_path': 'D:/codes/project',
        'vector_db': 'lance', 'vector_db_config': {}, 'is_template': False,
    })
    assert draft.model_dump(exclude_unset=True)['business_id'] is None
    with pytest.raises(ValidationError):
        ProjectEdit.model_validate({'status': 'archived'})


def test_archived_project_exposes_read_only_and_distinct_lifecycle_permission(env):  # noqa: F811
    from sop_manager.routers.delivery import _permissions
    client, sessions, _ = env
    from sop_manager.routers.sql_models import User
    with sessions() as db:
        actor = db.get(User, 'lead')
        scope = SimpleNamespace(id='project', tenant_id='tenant', status='archived')
        permissions = _permissions(db, actor, scope)
        assert not any(permissions[key] for key in ['write', 'approve', 'configure'])
        assert permissions['lifecycle']


def test_all_canonical_configuration_fields_require_configure():
    from sop_manager.routers.delivery import _command_permission
    for field in ['business_id', 'project_path', 'vector_db', 'vector_db_config', 'is_template']:
        assert _command_permission('project.update', {field: None}) == 'configure'
    assert _command_permission('project.lifecycle', {}) == 'lifecycle'
