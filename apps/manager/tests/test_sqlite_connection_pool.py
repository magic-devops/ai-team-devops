"""File SQLite sessions must not share transactions across concurrent requests."""

from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Event

import pytest
from sop_manager.routers import sql_models
from sqlalchemy import column, select, table, text, update
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool


@pytest.fixture
def file_engine(monkeypatch, tmp_path):
    monkeypatch.setattr(sql_models, "_DB_TYPE", "sqlite")
    monkeypatch.setattr(sql_models, "_DATABASE_URL", "sqlite:///" + (tmp_path / "manager.sqlite").as_posix())
    engine = sql_models.make_engine()
    yield engine
    engine.dispose()


def test_file_sqlite_simultaneous_sessions_have_separate_connections(file_engine):
    with file_engine.connect() as first, file_engine.connect() as second:
        assert first.connection.dbapi_connection is not second.connection.dbapi_connection


def test_file_sqlite_reader_cannot_observe_or_rollback_another_request_transaction(file_engine):
    probe = table("request_probe", column("id"), column("value"))
    with file_engine.begin() as connection:
        connection.execute(text("CREATE TABLE request_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)"))
        connection.execute(text("INSERT INTO request_probe VALUES (1, 'committed')"))
    with Session(file_engine) as writer:
        writer.execute(update(probe).where(probe.c.id == 1).values(value="pending"))
        with Session(file_engine) as reader:
            assert reader.scalar(select(probe.c.value).where(probe.c.id == 1)) == "committed"
        writer.commit()
    with Session(file_engine) as observer:
        assert observer.scalar(select(probe.c.value).where(probe.c.id == 1)) == "pending"


def test_file_sqlite_checkout_remains_available_during_overlapping_requests(file_engine):
    # Scope middleware checks out synchronously on the event loop. Outstanding
    # request sessions must not make that checkout wait on a finite pool queue.
    held = [file_engine.connect() for _ in range(15)]
    started = Event()
    executor = ThreadPoolExecutor(max_workers=1)

    def next_request():
        started.set()
        with file_engine.connect() as connection:
            return connection.scalar(text("SELECT 1"))

    try:
        future = executor.submit(next_request)
        assert started.wait(timeout=5)
        try:
            assert future.result(timeout=1) == 1
        except TimeoutError:
            pytest.fail("File SQLite checkout waited behind other request sessions")
    finally:
        for connection in held:
            connection.close()
        executor.shutdown(wait=True)


@pytest.mark.parametrize("url", ["sqlite://", "sqlite:///:memory:"])
def test_memory_sqlite_keeps_shared_connection_and_database_semantics(monkeypatch, url):
    monkeypatch.setattr(sql_models, "_DB_TYPE", "sqlite")
    monkeypatch.setattr(sql_models, "_DATABASE_URL", url)
    engine = sql_models.make_engine()
    try:
        assert isinstance(engine.pool, StaticPool)
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE shared_probe (value TEXT)"))
            connection.execute(text("INSERT INTO shared_probe VALUES ('same database')"))
        with Session(engine) as session:
            probe = table("shared_probe", column("value"))
            assert session.scalar(select(probe.c.value)) == "same database"
    finally:
        engine.dispose()
