"""Saved model settings must govern real calls; provider transports stay local stubs."""

import json
import sys
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sop_manager.path_config import reset_request_scope, set_request_scope
from sop_manager.routers import llm_gateway as gateway
from sop_manager.routers import models
from sop_manager.routers.runtime_model_config import credential_env_prefix
from test_business_access import env as business_env
from test_business_access import headers

REAL_AUDIT = gateway._audit_call
env = business_env


@pytest.fixture
def scope(tmp_path, monkeypatch):
    tokens = set_request_scope("tenant-model", "project-model", tmp_path)
    gateway._cache._d.clear()
    monkeypatch.setattr(gateway, "_enforce_llm_quota", lambda *args: None)
    monkeypatch.setattr(gateway, "_audit_call", lambda *args: None)
    for key in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "SOP_LLM_DEFAULT_MODEL", "SOP_LLM_MODEL_PLAN"):
        monkeypatch.delenv(key, raising=False)
    try:
        yield tmp_path
    finally:
        reset_request_scope(tokens)
        gateway._cache._d.clear()


@pytest.fixture
def openai_calls(monkeypatch):
    calls = []

    class Client:
        def __init__(self, **kwargs):
            self.settings = kwargs
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

        def create(self, **kwargs):
            calls.append({"settings": self.settings, "request": kwargs})
            return SimpleNamespace(
                model=kwargs["model"],
                choices=[SimpleNamespace(message=SimpleNamespace(content="local response"), finish_reason="stop")],
                usage=SimpleNamespace(prompt_tokens=10, completion_tokens=4, total_tokens=14),
            )

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=Client))
    return calls


def configured(*, key="local-test-secret", default="gpt-4o-mini", base="https://models.example.test/v1"):
    models.upsert_provider("openai", models.ProviderConfig(name="openai", api_key=key, base_url=base))
    models.set_default(default)


def chat(**kwargs):
    return gateway.llm_chat(gateway.ChatIn(messages=[gateway.Message(role="user", content="plan a feature")], **kwargs), None)


def test_saved_default_and_provider_credentials_are_used_by_actual_call(scope, openai_calls, monkeypatch):
    configured()
    monkeypatch.setenv("OPENAI_API_KEY", "wrong-environment-key")
    monkeypatch.setenv("SOP_LLM_DEFAULT_MODEL", "wrong-environment-model")
    result = chat()
    assert result.model == "gpt-4o-mini" and result.provider == "openai"
    assert openai_calls[0]["settings"] == {"api_key": "local-test-secret", "base_url": "https://models.example.test/v1"}
    assert result.usage.total_tokens == 14


def test_explicit_model_then_task_route_then_saved_default(scope, openai_calls, monkeypatch):
    configured()
    models.set_role_model(models.RoleModelConfig(role="plan", model_id="gpt-4o"))
    monkeypatch.setenv("SOP_LLM_MODEL_PLAN", "wrong-env-model")
    assert chat(task_type="plan").model == "gpt-4o"
    assert chat(task_type="plan", model="gpt-4o-mini").model == "gpt-4o-mini"
    assert chat(task_type="unknown").model == "gpt-4o-mini"
    assert gateway.get_routing()["plan"] == "gpt-4o"


def test_custom_model_key_overrides_provider_key_and_public_results_are_masked(scope, openai_calls):
    configured()
    result = models.add_custom_model(models.CustomModel(id="vendor/code-v1", provider="openai", name="Code", api_key="custom-secret-12345"))
    public = models.list_models()
    assert "custom-secret-12345" not in json.dumps(result)
    assert "custom-secret-12345" not in json.dumps(public)
    assert result["model"]["has_api_key"]
    output = chat(model="vendor/code-v1")
    assert output.model == "vendor/code-v1"
    assert openai_calls[0]["settings"]["api_key"] == "custom-secret-12345"


def test_environment_reference_is_resolved_only_at_call_time(scope, openai_calls, monkeypatch):
    name = f"{credential_env_prefix()}PRIMARY"
    reference = "${" + name + "}"
    configured(key=reference)
    monkeypatch.setenv(name, "first-resolved-key")
    chat(cache_ttl=60)
    monkeypatch.setenv(name, "rotated-resolved-key")
    chat(cache_ttl=60)
    assert [c["settings"]["api_key"] for c in openai_calls] == ["first-resolved-key", "rotated-resolved-key"]
    assert models.list_models()["providers"]["openai"]["api_key"] == reference


@pytest.mark.parametrize("case", ["disabled", "missing", "unresolved", "unsupported"])
def test_unavailable_saved_provider_fails_without_legacy_fallback(scope, openai_calls, monkeypatch, case):
    configured()
    monkeypatch.setenv("OPENAI_API_KEY", "environment-must-not-override")
    if case == "disabled":
        models.upsert_provider("openai", models.ProviderConfig(name="openai", enabled=False))
    elif case == "missing":
        models.delete_provider("openai")
    elif case == "unresolved":
        reference = "${" + credential_env_prefix() + "UNSET}"
        models.upsert_provider("openai", models.ProviderConfig(name="openai", api_key=reference))
    else:
        models.upsert_provider("google", models.ProviderConfig(name="google", api_key="test-google-key"))
        models.set_default("gemini-1.5-pro")
    with pytest.raises(HTTPException) as error:
        chat()
    assert error.value.status_code == 503
    assert not openai_calls


def test_saved_provider_error_is_safe_and_never_attempts_another_provider(scope, openai_calls, monkeypatch):
    configured()
    attempted = []

    def failed(self, body):
        attempted.append(self.name)
        raise RuntimeError("upstream failed api_key=local-test-secret https://private-url.invalid")

    monkeypatch.setattr(gateway.OpenAIProvider, "chat", failed)
    with pytest.raises(HTTPException) as error:
        chat()
    assert error.value.status_code == 502
    assert attempted == ["openai"]
    assert "local-test-secret" not in str(error.value.detail)
    assert "private-url" not in str(error.value.detail)


def test_without_saved_settings_legacy_env_routing_is_compatible(scope, openai_calls, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "legacy-key")
    monkeypatch.setenv("SOP_LLM_MODEL_PLAN", "gpt-4o-mini")
    assert chat(task_type="plan").model == "gpt-4o-mini"
    assert openai_calls[0]["settings"] == {"api_key": "legacy-key"}


def test_cache_does_not_mutate_first_response_and_hits_have_no_new_usage(scope, openai_calls, monkeypatch):
    configured()
    audited = []
    monkeypatch.setattr(gateway, "_audit_call", lambda *args: audited.append(args))
    first = chat(cache_ttl=60)
    second = chat(cache_ttl=60)
    assert len(openai_calls) == 1
    assert first.cached is False and first.usage.total_tokens == 14
    assert second.cached is True and second.usage.total_tokens == 0
    assert audited[-1][1].total_tokens == 0


def test_cache_is_separate_for_project_scope_and_changed_saved_configuration(scope, openai_calls, tmp_path):
    configured()
    chat(cache_ttl=60)
    other = set_request_scope("other-tenant", "other-project", tmp_path / "other")
    try:
        configured()
        assert chat(cache_ttl=60).cached is False
    finally:
        reset_request_scope(other)
    models.upsert_provider("openai", models.ProviderConfig(name="openai", api_key="new-key", base_url="https://models.example.test/v2"))
    assert chat(cache_ttl=60).cached is False
    assert len(openai_calls) == 3


def test_malformed_saved_config_fails_closed_instead_of_using_legacy_env(scope, openai_calls, monkeypatch):
    models._models_file().parent.mkdir(parents=True, exist_ok=True)
    models._models_file().write_text("not-json", encoding="utf-8")
    monkeypatch.setenv("OPENAI_API_KEY", "legacy-key")
    with pytest.raises(HTTPException) as error:
        chat(model="gpt-4o-mini")
    assert error.value.status_code == 503
    assert not openai_calls


@pytest.mark.parametrize("url", ["file:///etc/passwd", "https://key:secret@host.test", "https://host.test/?key=secret", "http://", "https://host.test/#fragment", "https://host.test/\nunsafe"])
def test_provider_base_url_rejects_non_http_credential_or_ambiguous_values(url):
    with pytest.raises(ValidationError):
        models.ProviderConfig(name="openai", base_url=url)


@pytest.mark.parametrize("model_id", ["", " ", "bad\nmodel", "x" * 201])
def test_custom_model_id_is_bounded(model_id):
    with pytest.raises(ValidationError):
        models.CustomModel(id=model_id, provider="openai", name="Model")


def test_provider_name_cannot_differ_from_url_name(scope):
    with pytest.raises(HTTPException) as error:
        models.upsert_provider("openai", models.ProviderConfig(name="anthropic", api_key="test"))
    assert error.value.status_code == 400


def test_ollama_saved_endpoint_does_not_require_a_cloud_key(scope, monkeypatch):
    calls = []
    models.upsert_provider("ollama", models.ProviderConfig(name="ollama", base_url="http://127.0.0.1:11435"))
    models.set_default("qwen2.5-coder")

    def post(url, **kwargs):
        calls.append((url, kwargs))
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"message": {"content": "local"}, "prompt_eval_count": 5, "eval_count": 3})

    import httpx

    monkeypatch.setattr(httpx, "post", post)
    output = chat()
    assert calls[0][0] == "http://127.0.0.1:11435/api/chat"
    assert output.model == "qwen2.5-coder" and output.provider == "ollama"
    assert output.usage.total_tokens == 8


def test_anthropic_adapter_uses_saved_custom_endpoint_key_and_actual_model(scope, monkeypatch):
    calls = []
    models.upsert_provider("anthropic", models.ProviderConfig(name="anthropic", api_key="project-anthropic-key", base_url="https://anthropic.example.test"))

    class Client:
        def __init__(self, **kwargs):
            self.settings = kwargs
            self.messages = SimpleNamespace(create=self.create)

        def create(self, **kwargs):
            calls.append({"settings": self.settings, "request": kwargs})
            return SimpleNamespace(model="claude-opus-4-7-actual", content=[SimpleNamespace(text="planned")], usage=SimpleNamespace(input_tokens=8, output_tokens=3), stop_reason="end_turn")

    monkeypatch.setitem(sys.modules, "anthropic", SimpleNamespace(Anthropic=Client, NOT_GIVEN=object()))
    result = chat(task_type="plan")
    assert result.provider == "anthropic" and result.model == "claude-opus-4-7-actual"
    assert result.usage.total_tokens == 11
    assert calls[0]["request"]["model"] == "claude-opus-4-7"
    assert calls[0]["settings"] == {"api_key": "project-anthropic-key", "base_url": "https://anthropic.example.test"}


def test_cached_calls_skip_quota_check_and_audit_zero_billed_usage(scope, openai_calls, monkeypatch):
    configured()
    checked = []
    monkeypatch.setattr(gateway, "_enforce_llm_quota", lambda *args: checked.append(args))
    chat(cache_ttl=60)
    chat(cache_ttl=60)
    assert len(checked) == 1


def test_usage_audit_distinguishes_identical_new_calls_and_avoids_duplicate_cached_cost(scope, monkeypatch):
    from sop_manager.routers import usage

    events = []
    monkeypatch.setattr(usage, "record_usage_event", lambda row: events.append(row))
    # Get the real audit implementation hidden by the isolating fixture.
    real_usage = gateway.ChatUsage(prompt_tokens=10, completion_tokens=4, total_tokens=14, cost_usd=0.01)
    REAL_AUDIT("gpt-4o-mini", real_usage, "plan", "openai", False, 1)
    REAL_AUDIT("gpt-4o-mini", real_usage, "plan", "openai", False, 1)
    REAL_AUDIT("gpt-4o-mini", gateway.ChatUsage(), "plan", "openai", True, 0)
    token_events = [event for event in events if event["metric"] == "llm_tokens"]
    assert len({row["idempotency_key"] for row in token_events}) == 3
    assert sum(row["value"] for row in token_events) == 28
    assert sum(row["value"] for row in events if row["metric"] == "llm_cost_usd") == 0.02


@pytest.fixture
def embedding_calls(monkeypatch):
    calls = []

    class Client:
        def __init__(self, **kwargs):
            self.settings = kwargs
            self.embeddings = SimpleNamespace(create=self.create)

        def create(self, **kwargs):
            calls.append({"settings": self.settings, "request": kwargs})
            return SimpleNamespace(model=kwargs["model"], data=[SimpleNamespace(embedding=[0.2, 0.5])], usage=SimpleNamespace(total_tokens=7))

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=Client))
    monkeypatch.setitem(sys.modules, "sentence_transformers", None)
    return calls


def test_embedding_fallback_uses_saved_provider_and_records_actual_usage(scope, embedding_calls, monkeypatch):
    configured()
    monkeypatch.setenv("OPENAI_API_KEY", "wrong-environment-key")
    audit = []
    monkeypatch.setattr(gateway, "_audit_call", lambda *args: audit.append(args))
    output = gateway.llm_embeddings(gateway.EmbeddingsIn(input="input text"))
    assert embedding_calls[0]["settings"]["api_key"] == "local-test-secret"
    assert embedding_calls[0]["settings"]["base_url"] == "https://models.example.test/v1"
    assert output.model == "text-embedding-3-small" and output.usage.total_tokens == 7
    assert audit[-1][2] == "embeddings" and audit[-1][1].total_tokens == 7


def test_saved_embedding_provider_disabled_cannot_use_environment_key(scope, embedding_calls, monkeypatch):
    configured()
    models.upsert_provider("openai", models.ProviderConfig(name="openai", enabled=False))
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-use-this-key")
    with pytest.raises(HTTPException) as error:
        gateway.llm_embeddings(gateway.EmbeddingsIn(input="input text"))
    assert error.value.status_code == 503 and not embedding_calls


def test_custom_embedding_model_keeps_its_explicit_id_and_model_key(scope, embedding_calls):
    configured()
    models.add_custom_model(models.CustomModel(id="vendor/embed-v1", provider="openai", name="Embedding", api_key="embedding-model-key"))
    output = gateway.llm_embeddings(gateway.EmbeddingsIn(input=["input text"], model="vendor/embed-v1"))
    assert output.model == "vendor/embed-v1"
    assert embedding_calls[0]["settings"]["api_key"] == "embedding-model-key"
    assert embedding_calls[0]["request"]["model"] == "vendor/embed-v1"


def test_local_embeddings_still_work_without_cloud_provider(scope, monkeypatch):
    models.set_default("gpt-4o-mini")

    class Local:
        def __init__(self, name):
            self.name = name

        def encode(self, inputs, **kwargs):
            return [SimpleNamespace(tolist=lambda: [0.1, 0.3]) for _ in inputs]

    monkeypatch.setitem(sys.modules, "sentence_transformers", SimpleNamespace(SentenceTransformer=Local))
    if hasattr(gateway.llm_embeddings, "_st_cache"):
        monkeypatch.delattr(gateway.llm_embeddings, "_st_cache")
    result = gateway.llm_embeddings(gateway.EmbeddingsIn(input="local text"))
    assert result.model == "bge-m3" and result.vectors == [[0.1, 0.3]]


def test_model_discovery_lists_configured_custom_model_and_omits_unsupported(scope):
    configured()
    models.add_custom_model(models.CustomModel(id="vendor/code", provider="openai", name="Code"))
    rows = gateway.list_models()
    assert {row.id for row in rows} == {"gpt-4o", "gpt-4o-mini", "vendor/code"}
    assert gateway.health()["routing_source"] == "project"


def test_embedding_quota_estimate_has_no_generation_allowance():
    body = gateway.ChatIn(messages=[gateway.Message(role="user", content="12345678")], max_tokens=0)
    assert gateway._estimate_prompt_tokens(body) == 2


def test_provider_health_probe_revalidates_saved_url_before_network(scope, monkeypatch):
    configured()
    config = models._load()
    config["providers"]["openai"]["base_url"] = "file:///private/file"
    models._save(config)
    attempts = []
    monkeypatch.setattr(models.urllib.request, "urlopen", lambda *args, **kwargs: attempts.append(args))
    result = models.test_provider("openai")
    assert result["ok"] is False and result["status"] == "invalid_endpoint"
    assert not attempts


def test_analytics_nlq_uses_real_gateway_credentials_and_usage_audit(scope, openai_calls, monkeypatch):
    from sop_manager.routers import data_analytics

    configured()
    audited = []
    monkeypatch.setattr(data_analytics, "_build_metrics", lambda *args: {"tasks_total": 2})
    monkeypatch.setattr(gateway, "_audit_call", lambda *args: audited.append(args))
    result = data_analytics.analytics_nlq(data_analytics.NlqIn(question="项目状态"), None)
    assert result["engine"] == "llm" and result["model"] == "gpt-4o-mini"
    assert openai_calls[0]["settings"]["api_key"] == "local-test-secret"
    assert audited[-1][2] == "summarize" and audited[-1][1].total_tokens == 14


def test_analytics_disabled_provider_keeps_rule_answer_without_environment_fallback(scope, openai_calls, monkeypatch):
    from sop_manager.routers import data_analytics

    configured()
    models.upsert_provider("openai", models.ProviderConfig(name="openai", enabled=False))
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-bypass-disabled-provider")
    monkeypatch.setattr(data_analytics, "_build_metrics", lambda *args: {"tasks_total": 2})
    result = data_analytics.analytics_nlq(data_analytics.NlqIn(question="项目状态"), None)
    assert result["engine"] == "rules" and result["fallback_reason"] == "llm_provider_failed"
    assert not openai_calls


def test_malformed_environment_reference_is_rejected(scope):
    with pytest.raises(ValidationError):
        configured(key="${secret-with-dashes-and-spaces}")


@pytest.mark.parametrize("change", [
    {"providers": {"openai": "broken"}},
    {"providers": {"openai": {"api_key": 0}}},
    {"custom_models": [{"id": ["bad"], "provider": "openai"}]},
    {"role_models": {"plan": ["bad"]}},
])
def test_corrupt_saved_field_shapes_fail_closed_for_public_and_call_routes(scope, change):
    configured()
    config = models._load()
    config.update(change)
    models._models_file().write_text(json.dumps(config), encoding="utf-8")
    for operation in (models.list_models, gateway.health, chat):
        with pytest.raises(HTTPException) as error:
            operation()
        assert error.value.status_code == 503


def test_authenticated_http_configuration_chat_cache_and_ledger_use_same_project(env, openai_calls):
    from pathlib import Path

    from sop_manager.routers import sql_models

    client, sessions = env
    with sessions() as db:
        db.get(sql_models.ProjectMember, ("selected", "writer")).role = "project_admin"
        project_path = Path(db.get(sql_models.Project, "selected").project_path)
        db.commit()
    response = client.put("/api/v1/models/providers/openai", headers=headers(), json={
        "name": "openai", "api_key": "http-project-key", "base_url": "https://http-models.example.test/v1",
    })
    assert response.status_code == 200, response.text
    assert "http-project-key" not in response.text
    assert client.put("/api/v1/models/default?model_id=gpt-4o-mini", headers=headers()).status_code == 200
    body = {"messages": [{"role": "user", "content": "HTTP integration evidence"}], "task_type": "plan", "cache_ttl": 60}
    first = client.post("/api/v1/llm/chat", headers=headers(), json=body)
    second = client.post("/api/v1/llm/chat", headers=headers(), json=body)
    assert first.status_code == second.status_code == 200
    assert first.json()["model"] == "gpt-4o-mini" and first.json()["usage"]["total_tokens"] == 14
    assert second.json()["cached"] is True and second.json()["usage"]["total_tokens"] == 0
    assert len(openai_calls) == 1 and openai_calls[0]["settings"]["api_key"] == "http-project-key"
    assert client.post("/api/v1/llm/chat", headers=headers(project="other"), json=body).status_code == 403
    assert client.post("/api/v1/llm/chat", headers=headers("reader"), json=body).status_code == 403
    ledger = [json.loads(line) for path in (project_path / ".sop-runtime" / "ai-memory" / "usage-v1").glob("*.jsonl") for line in path.read_text(encoding="utf-8").splitlines()]
    assert sum(row["value"] for row in ledger if row["metric"] == "llm_tokens") == 14
    assert {row["project_id"] for row in ledger} == {"selected"}
    assert {row["tenant_id"] for row in ledger} == {"team"}


@pytest.mark.parametrize("tenant,project", [("tenant-model", "another-project"), ("another-tenant", "project-model")])
def test_shared_project_root_keeps_model_settings_credentials_and_cache_separate(scope, openai_calls, tenant, project):
    configured(key="original-project-key")
    chat(cache_ttl=60)
    original_path = models._models_file()
    other = set_request_scope(tenant, project, scope)
    try:
        assert models.list_models()["providers"] == {}
        assert models._models_file() != original_path
        configured(key="other-project-key", default="gpt-4o")
        assert chat(cache_ttl=60).model == "gpt-4o"
    finally:
        reset_request_scope(other)
    assert chat(cache_ttl=60).cached is True
    assert models.list_models()["default"] == "gpt-4o-mini"
    assert [row["settings"]["api_key"] for row in openai_calls] == ["original-project-key", "other-project-key"]


def test_legacy_root_config_requires_explicit_single_project_ownership(scope, openai_calls, monkeypatch):
    from sop_manager.path_config import resolved_ai_memory_root

    legacy = resolved_ai_memory_root() / "models.json"
    legacy.parent.mkdir(parents=True, exist_ok=True)
    legacy.write_text(json.dumps({"default_model": "gpt-4o-mini", "providers": {"openai": {"api_key": "owned-legacy-key", "enabled": True}}}), encoding="utf-8")
    assert models.list_models()["providers"] == {}
    monkeypatch.setenv("SOP_LEGACY_MODELS_TENANT_ID", "tenant-model")
    monkeypatch.setenv("SOP_LEGACY_MODELS_PROJECT_ID", "project-model")
    assert chat().model == "gpt-4o-mini"
    assert openai_calls[-1]["settings"]["api_key"] == "owned-legacy-key"
    other = set_request_scope("tenant-model", "another-project", scope)
    try:
        assert models.list_models()["providers"] == {}
    finally:
        reset_request_scope(other)
    models.set_default("gpt-4o")
    assert models._models_file() != legacy and models._models_file().exists()
    assert json.loads(legacy.read_text(encoding="utf-8"))["default_model"] == "gpt-4o-mini"


def test_scope_identifiers_cannot_escape_model_configuration_directory(scope):
    other = set_request_scope("../../tenant", "../../../project", scope)
    try:
        configured()
        assert models._models_file().parent.name == "model-configs"
        assert models._models_file().name.endswith(".json")
        assert models._models_file().resolve().is_relative_to(scope.resolve())
        assert "tenant" not in models._models_file().name
    finally:
        reset_request_scope(other)


@pytest.mark.parametrize("reference", ["${SECRET_KEY}", "${DATABASE_URL}", "${OPENAI_API_KEY}", "${ARBITRARY_SERVER_VARIABLE}"])
def test_project_configuration_rejects_arbitrary_server_environment_references(scope, reference):
    for payload in (
        lambda: models.ProviderConfig(name="openai", api_key=reference),
        lambda: models.CustomModel(id="model", provider="openai", name="Model", api_key=reference),
    ):
        with pytest.raises(ValidationError):
            payload()


def test_historical_unsafe_environment_reference_fails_before_provider_transport(scope, openai_calls, monkeypatch):
    configured()
    config = models._load()
    config["providers"]["openai"]["api_key"] = "${SECRET_KEY}"
    models._save(config)
    monkeypatch.setenv("SECRET_KEY", "server-signing-secret-not-a-model-key")
    with pytest.raises(HTTPException) as error:
        chat()
    assert error.value.status_code == 503 and not openai_calls


def test_scoped_environment_credentials_cannot_be_requested_from_another_project(scope, openai_calls, monkeypatch):
    name = credential_env_prefix() + "PRIMARY"
    reference = "${" + name + "}"
    configured(key=reference)
    monkeypatch.setenv(name, "original-scope-credential")
    assert chat().provider == "openai"
    other = set_request_scope("tenant-model", "different-project", scope)
    try:
        assert credential_env_prefix() not in name
        with pytest.raises(ValidationError):
            models.ProviderConfig(name="openai", api_key=reference)
        models._save({"default_model": "gpt-4o-mini", "providers": {"openai": {"api_key": reference}}})
        with pytest.raises(HTTPException) as error:
            chat()
        assert error.value.status_code == 503
    finally:
        reset_request_scope(other)
    assert len(openai_calls) == 1
