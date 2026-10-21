"""Explicit fixed returned-delivery references, outside current Task semantics."""
from typing import Annotated
from math import isfinite

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator

FeedbackIdentity = Annotated[str, StringConstraints(strict=True, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$")]
FeedbackDigest = Annotated[str, StringConstraints(strict=True, pattern=r"^[0-9a-f]{64}$")]
MAX_FEEDBACK_CONTEXT_BYTES = 64 * 1024


class FeedbackReference(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    submission_id: FeedbackIdentity
    submission_digest: FeedbackDigest
    decision_id: FeedbackIdentity

    @model_validator(mode="before")
    @classmethod
    def safe_reference_text(cls, value):
        pending, visited = [(value, 0)], 0
        try:
            while pending:
                part, depth = pending.pop()
                visited += 1
                if depth > 8 or visited > 100:
                    raise ValueError("Reference input exceeds its bounded shape")
                if isinstance(part, str):
                    part.encode("utf-8")
                elif isinstance(part, float) and not isfinite(part):
                    raise ValueError("Use finite JSON numbers")
                elif isinstance(part, dict):
                    pending.extend((item, depth + 1) for pair in part.items() for item in pair)
                elif isinstance(part, (list, tuple)):
                    pending.extend((item, depth + 1) for item in part)
        except (UnicodeError, ValueError):
            raise HTTPException(422, {"code": "feedback_reference_invalid", "message": "Use a complete bounded finite Unicode feedback reference."}) from None
        return value
