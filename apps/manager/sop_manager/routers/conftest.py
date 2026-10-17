"""Legacy file-router tests explicitly use a canonical isolated SQL project."""

import pytest


@pytest.fixture(autouse=True)
def isolated_router_sql(isolated_project_sql):
    return isolated_project_sql
