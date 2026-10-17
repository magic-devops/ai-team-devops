"""Project configuration edits retain one canonical SQL source and tenant scope."""

from sop_manager.routers.sql_models import Business, DeliveryEvent, DeliveryWorkspace, Project, Tenant
from test_delivery_workbench import command
from test_delivery_workbench import env as delivery_env

env = delivery_env


def test_configuration_command_updates_canonical_fields_and_read_projection_without_json_copies(env):
    client, sessions, _ = env
    with sessions() as db:
        db.add(Business(id="business", tenant_id="tenant", name="Product line"))
        db.commit()
    response = command(
        client,
        "project.update",
        {"business_id": "business", "project_path": "D:/product", "vector_db": "qdrant", "is_template": True},
    )
    assert response.status_code == 200, response.text
    visible = response.json()["project"]
    assert visible["business_id"] == "business"
    assert visible["project_path"] == "D:/product"
    assert visible["vector_db"] == "qdrant" and visible["is_template"] is True
    with sessions() as db:
        project = db.get(Project, "project")
        assert project.business_id == "business" and project.project_path == "D:/product"
        assert project.vector_db == "qdrant" and project.is_template
        assert (
            not {"business_id", "project_path", "vector_db", "is_template"}
            & db.get(DeliveryWorkspace, "project").data["project"].keys()
        )


def test_cross_tenant_business_configuration_rejects_the_whole_command_and_omitted_fields_hold(env):
    client, sessions, _ = env
    with sessions() as db:
        db.add(Tenant(id="foreign", name="Foreign", slug="foreign"))
        db.flush()
        db.add(Business(id="foreign-business", tenant_id="foreign", name="Foreign line"))
        db.commit()
    assert command(client, "project.update", {"project_path": "D:/original"}).status_code == 200
    failed = command(client, "project.update", {"business_id": "foreign-business", "name": "Must roll back"})
    assert failed.status_code == 422, failed.text
    assert command(client, "project.update", {"goal": "Only goal"}).status_code == 200
    with sessions() as db:
        project = db.get(Project, "project")
        assert project.name == "Product" and project.business_id is None
        assert project.project_path == "D:/original"
        assert db.query(DeliveryEvent).filter_by(action="project.update").count() == 2
