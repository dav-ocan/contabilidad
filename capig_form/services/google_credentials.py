# -*- coding: utf-8 -*-
import base64
import json
import logging
import os
from functools import lru_cache

logger = logging.getLogger(__name__)

REQUIRED_SERVICE_FIELDS = {"private_key", "client_email", "project_id"}


def _strip_wrapping_quotes(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1].strip()
    return value


def _read_json_file(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError as exc:
        raise RuntimeError(f"Credentials file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Credentials file is not valid JSON: {path}") from exc


def _parse_json(value: str) -> dict:
    try:
        return json.loads(value)
    except json.JSONDecodeError as exc:
        logger.exception("SERVICE JSON is invalid.")
        raise RuntimeError(
            "SERVICE JSON is malformed. Check GOOGLE_CLOUD_CREDENTIALS."
        ) from exc


def _decode_base64(value: str) -> str:
    payload = value.split(":", 1)[1].strip()
    try:
        decoded = base64.b64decode(payload, validate=True)
    except Exception as exc:
        raise RuntimeError("GOOGLE_CLOUD_CREDENTIALS base64 is invalid.") from exc
    return decoded.decode("utf-8")


def _looks_like_path(value: str) -> bool:
    if not value:
        return False
    if value.startswith(("/", "./", "../", "~")):
        return True
    if "\\" in value:
        return True
    if len(value) >= 2 and value[1] == ":":
        return True
    return False


@lru_cache(maxsize=1)
def load_service_account_info(raw_service: str | None) -> dict:
    raw_service = _strip_wrapping_quotes(raw_service or "")
    if not raw_service:
        raw_service = _strip_wrapping_quotes(
            os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "")
        )
    if not raw_service:
        raise RuntimeError(
            "Missing Google credentials. Set GOOGLE_CLOUD_CREDENTIALS (JSON) or "
            "GOOGLE_APPLICATION_CREDENTIALS (path)."
        )

    if raw_service.startswith("base64:"):
        raw_service = _decode_base64(raw_service)

    if raw_service.lstrip().startswith("{"):
        info = _parse_json(raw_service)
    elif _looks_like_path(raw_service):
        info = _read_json_file(raw_service)
    else:
        info = _parse_json(raw_service)

    missing = [field for field in REQUIRED_SERVICE_FIELDS if not info.get(field)]
    if missing:
        message = f"Missing required fields in SERVICE: {missing}"
        logger.error(message)
        raise RuntimeError(message)

    return info
