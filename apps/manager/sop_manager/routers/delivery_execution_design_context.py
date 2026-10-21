"""Load only the immutable adopted revisions into an execution original."""
import hashlib

from fastapi import HTTPException

from hermes_core.agent_input import validate_design_context


def execution_design_context(db, project, snapshot):
    from .design_contract import DesignReference
    from .design_service import load_revision

    refs = snapshot["designs"]
    context = []
    for value in refs:
        ref = DesignReference.model_validate(value)
        row = load_revision(db, project, ref.document_id, ref.revision_id, digest=ref.revision_digest)
        encoded = row.content.encode("utf-8")
        if (row.content_sha256 != ref.content_sha256 or row.content_bytes != ref.content_bytes
                or len(encoded) != ref.content_bytes or hashlib.sha256(encoded).hexdigest() != ref.content_sha256):
            raise HTTPException(409, "The adopted design content no longer matches its immutable revision")
        context.append({"slot": ref.slot, "document_id": ref.document_id, "revision_id": ref.revision_id,
                        "revision_digest": ref.revision_digest, "content_sha256": ref.content_sha256, "content": row.content})
    validate_design_context({"source": {"snapshot": snapshot}, "design_context": context})
    return context
