"""Shared source/CI schema behavior definitions; comparison is deferred by user."""
from pathlib import Path

from fastapi import FastAPI
import yaml
from sop_manager.routers.delivery import router


def test_source_packet_and_ci_contract_are_published_without_runtime_fallbacks():
    app = FastAPI()
    app.include_router(router)
    actual = app.openapi()
    published = yaml.safe_load((Path(__file__).resolve().parents[3] / "apis/openapi/openapi.yaml").read_bytes())
    path = "/api/v1/delivery/releases/source-packet"
    for field in ("parameters", "requestBody", "responses"):
        assert actual["paths"][path]["post"][field] == published["paths"][path]["post"][field]
    for name in ("ReleaseSourceMapping", "ReleaseSourceBinding", "ReleaseSourcePacket", "ReleaseSourcePacketInput",
            "ReleaseSourcePacketResponse", "CiSourceTrace", "CiPredicate", "ReleaseCiImport", "ReleaseCiEvidence", "ReleaseCiEvidenceSnapshot"):
        assert actual["components"]["schemas"][name] == published["components"]["schemas"][name], name
