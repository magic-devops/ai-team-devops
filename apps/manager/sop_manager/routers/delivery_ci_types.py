"""Shared strict CI and source-packet scalar types; no service dependencies."""
from typing import Annotated, ClassVar
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationInfo, field_validator

HexDigest = Annotated[str, StringConstraints(strict=True, pattern=r"^[0-9a-f]{64}$")]
CommitSha = Annotated[str, StringConstraints(strict=True, pattern=r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")]
Identity = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=200)]
Count = Annotated[int, Field(strict=True, ge=0, le=10_000_000)]


def safe_https(value: str, *, repository=False) -> str:
    """Locations are identifiers; the verifier never fetches them."""
    try:
        value.encode("utf-8")
        parsed = urlsplit(value)
        port = parsed.port
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.fragment
            or "#" in value
            or "?" in value
            or port == 0
            or any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in value)
            or "\\" in value
        ):
            raise ValueError
    except (ValueError, UnicodeError) as exc:
        raise ValueError("Use an HTTPS URI without credentials or a fragment") from exc
    return value


class CiInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=False)
    multiline_text_fields: ClassVar[frozenset[str]] = frozenset()

    @field_validator("*", mode="after")
    @classmethod
    def string_is_text(cls, value, info: ValidationInfo):
        if isinstance(value, str):
            value.encode("utf-8")
            allowed = "\n\r\t" if info.field_name in cls.multiline_text_fields else ""
            if not value.strip() or any((ord(char) < 32 or ord(char) == 127) and char not in allowed for char in value):
                raise ValueError("Expected nonempty text without unsupported control characters")
        return value
