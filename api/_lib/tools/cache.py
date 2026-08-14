"""Cross-request cache backed by Vercel KV / Upstash Redis.

Every search costs up to four Overpass queries plus a Nominatim geocode, all
against free services with no capacity guarantee. Overpass's public mirrors
answer a saturated request with a 504, a 429 or a hang, and the radius ladder
turns one unlucky moment into a failed search -- which is the failure users
actually reported. Caching does not make the mirrors faster; it makes the app
stop asking them the same question.

The process-lifetime dict this replaces for geocoding was close to useless on
serverless, where each request may land in a fresh instance.

Deliberately degrades to a no-op when KV_REST_API_URL / KV_REST_API_TOKEN are
unset, so local development and any deployment without a KV store behave
exactly as before rather than failing. For the same reason every cache error is
swallowed: a cache is an optimisation, and an optimisation that can fail a
request someone is relying on for a dietary constraint is not worth having.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Any, Optional

import httpx

#: Short enough that an edit in OSM shows up the same day, long enough that a
#: popular city is not re-queried per visitor. Diet tags change on the order of
#: months, so this is far more conservative than the data warrants.
DEFAULT_TTL_S = 6 * 60 * 60

#: A cache must never be the slow part of the request it is meant to speed up.
TIMEOUT_S = 2.0

logger = logging.getLogger(__name__)


def _credentials() -> Optional[tuple[str, str]]:
    url = os.environ.get("KV_REST_API_URL")
    token = os.environ.get("KV_REST_API_TOKEN")
    if not url or not token:
        return None
    return url.rstrip("/"), token


def is_enabled() -> bool:
    return _credentials() is not None


def key_for(namespace: str, payload: str) -> str:
    """Namespaced digest of whatever uniquely identifies the request.

    Hashed rather than stored raw because an Overpass query is multi-line and
    carries coordinates; the digest keeps keys short and uniform.
    """
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]
    return f"dad:{namespace}:{digest}"


async def read(key: str) -> Optional[Any]:
    """``get_json`` that cannot raise, whatever the backend does.

    The guarantee lives here rather than only inside ``get_json`` so that a
    caller never has to trust the cache: a search must survive a cache that is
    down, misconfigured, or returning something unexpected.
    """
    try:
        return await get_json(key)
    except Exception as error:  # noqa: BLE001 - a cache must not break a search
        logger.warning("[cache] read failed for %s: %s", key, error)
        return None


async def write(key: str, value: Any, ttl_s: int = DEFAULT_TTL_S) -> None:
    """``set_json`` that cannot raise. See :func:`read`."""
    try:
        await set_json(key, value, ttl_s)
    except Exception as error:  # noqa: BLE001 - a cache must not break a search
        logger.warning("[cache] write failed for %s: %s", key, error)


async def get_json(key: str) -> Optional[Any]:
    """Returns the cached value, or None on a miss or any failure."""
    creds = _credentials()
    if creds is None:
        return None
    url, token = creds

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
            response = await client.get(
                f"{url}/get/{key}",
                headers={"Authorization": f"Bearer {token}"},
            )
        if response.status_code != 200:
            return None
        # Upstash wraps the value: {"result": "<the string we stored>"}.
        raw = response.json().get("result")
        if raw is None:
            return None
        return json.loads(raw)
    except Exception as error:  # noqa: BLE001 - a cache must not break a search
        logger.warning("[cache] read failed for %s: %s", key, error)
        return None


async def set_json(key: str, value: Any, ttl_s: int = DEFAULT_TTL_S) -> None:
    """Stores the value. Failures are logged and otherwise ignored."""
    creds = _credentials()
    if creds is None:
        return
    url, token = creds

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
            await client.post(
                f"{url}/set/{key}",
                params={"EX": str(ttl_s)},
                content=json.dumps(value),
                headers={"Authorization": f"Bearer {token}"},
            )
    except Exception as error:  # noqa: BLE001 - a cache must not break a search
        logger.warning("[cache] write failed for %s: %s", key, error)
