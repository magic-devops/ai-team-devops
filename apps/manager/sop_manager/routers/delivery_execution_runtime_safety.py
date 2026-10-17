"""Bounded, text-only public runtime projections."""

from .delivery_issue_evidence import _clean

_USAGE_KEYS = frozenset({
    "input_tokens", "output_tokens", "total_tokens", "prompt_tokens", "completion_tokens",
    "cached_tokens", "reasoning_tokens", "cache_read_input_tokens", "cache_creation_input_tokens",
    "tokens", "cost", "total_cost", "input_cost", "output_cost", "usd", "amount",
    "input_tokens_details", "output_tokens_details", "prompt_tokens_details", "completion_tokens_details",
    "cache_read", "cache_write", "input", "output", "total", "cached", "reasoning",
})


def safe_text(value, limit=12000, *, tail=False):
    original = str(value or "")
    text, changed, _ = _clean(original, max(len(original), 1))
    return (text[-limit:] if tail else text[:limit]), changed, len(text) > limit


def safe_usage(value, depth=0):
    if not isinstance(value, dict) or depth > 3:
        return None
    result = {}
    for key, part in list(value.items())[:64]:
        if key not in _USAGE_KEYS:
            continue
        if isinstance(part, (int, float)) and not isinstance(part, bool) and 0 <= part <= 10 ** 18:
            result[key] = part
        elif isinstance(part, dict):
            nested = safe_usage(part, depth + 1)
            if nested:
                result[key] = nested
    return result or None
