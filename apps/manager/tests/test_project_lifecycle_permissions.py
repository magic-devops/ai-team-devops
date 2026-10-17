import sqlite3

import pytest
from sop_manager import project_write_guard as guard
from sop_manager.routers.sql_models import Project, ProjectMember
from sqlalchemy import create_engine
from test_delivery_workbench import command
from test_delivery_workbench import env as delivery_env

env = delivery_env

@pytest.mark.parametrize('revocation', ['viewer', 'removed'])
def test_permission_revoked_before_project_lock(env, monkeypatch, revocation, tmp_path):
    client, sessions, actor = env
    actor['id'] = 'reader'
    with sessions() as db:
        db.get(ProjectMember, ('project', 'reader')).role = 'project_admin'
        db.commit()
    # Give the request and revoker separate physical SQLite connections.
    original_engine = sessions.kw['bind']
    with original_engine.connect() as connection:
        target = sqlite3.connect(tmp_path / 'review.sqlite')
        connection.connection.driver_connection.backup(target)
        target.close()
    engine = create_engine('sqlite:///' + str(tmp_path / 'review.sqlite'))
    sessions.configure(bind=engine)
    original = guard.require_project_operation
    done = False
    def revoke_then_lock(db, tenant_id, project_id, operation='write'):
        nonlocal done
        if not done:
            done = True
            with sessions() as concurrent:
                member = concurrent.get(ProjectMember, ('project', 'reader'))
                if revocation == 'removed':
                    concurrent.delete(member)
                else:
                    member.role = revocation
                concurrent.commit()
        return original(db, tenant_id, project_id, operation)
    monkeypatch.setattr(guard, 'require_project_operation', revoke_then_lock)
    try:
        saved = command(client, 'project.update', {'name': 'Unauthorized after revocation'}, key='revoked-config')
        print('FILE DB REVOCATION', revocation, 'HTTP', saved.status_code)
        with sessions() as db:
            print('PROJECT NAME', db.get(Project, 'project').name)
            member = db.get(ProjectMember, ('project', 'reader'))
            print('MEMBER AFTER', member.role if member else None)
        assert saved.status_code in (401, 403)
        with sessions() as db:
            assert db.get(Project, 'project').name == 'Product'
    finally:
        sessions.configure(bind=original_engine)
        engine.dispose()
