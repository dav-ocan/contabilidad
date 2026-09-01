# -*- coding: utf-8 -*-
import logging
import os
from datetime import datetime
from io import BytesIO

from django.conf import settings
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload, MediaIoBaseUpload
from googleapiclient.errors import HttpError

from finanzas_abaoca.services.google_credentials import load_service_account_info

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/drive"]


def _get_drive_service():
    info = load_service_account_info(settings.SERVICE)
    creds = Credentials.from_service_account_info(info, scopes=SCOPES)
    return build("drive", "v3", credentials=creds)


def _get_root_folder_id():
    folder_id = getattr(settings, "DRIVE_FOLDER_ID", "")
    if not folder_id:
        raise RuntimeError("DRIVE_FOLDER_ID is not configured.")
    return folder_id


def _get_drive_id(service, folder_id):
    try:
        metadata = (
            service.files()
            .get(fileId=folder_id, fields="id, driveId", supportsAllDrives=True)
            .execute()
        )
        return metadata.get("driveId")
    except HttpError as exc:
        logger.exception("Drive folder not found or not accessible: %s", folder_id)
        raise RuntimeError("Drive folder not found or not accessible.") from exc


def _list_files(service, query, drive_id=None):
    params = {
        "q": query,
        "fields": "files(id, name)",
        "pageSize": 1,
        "supportsAllDrives": True,
        "includeItemsFromAllDrives": True,
    }
    if drive_id:
        params["corpora"] = "drive"
        params["driveId"] = drive_id
    return service.files().list(**params).execute()


def _find_folder(service, parent_id, name, drive_id=None):
    query = (
        "mimeType='application/vnd.google-apps.folder' "
        f"and name='{name}' and '{parent_id}' in parents and trashed=false"
    )
    result = _list_files(service, query, drive_id=drive_id)
    items = result.get("files", [])
    return items[0]["id"] if items else None


def _ensure_folder(service, parent_id, name, drive_id=None):
    folder_id = _find_folder(service, parent_id, name, drive_id=drive_id)
    if folder_id:
        return folder_id
    metadata = {
        "name": name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent_id],
    }
    created = (
        service.files()
        .create(body=metadata, fields="id", supportsAllDrives=True)
        .execute()
    )
    return created["id"]


def _file_exists(service, parent_id, name, drive_id=None):
    query = f"name='{name}' and '{parent_id}' in parents and trashed=false"
    result = _list_files(service, query, drive_id=drive_id)
    return bool(result.get("files"))


def _resolve_file_name(service, parent_id, base_name, drive_id=None):
    name = base_name
    stem, ext = os.path.splitext(base_name)
    counter = 2
    while _file_exists(service, parent_id, name, drive_id=drive_id):
        name = f"{stem}-{counter}{ext}"
        counter += 1
    return name


def _build_media(uploaded):
    if hasattr(uploaded, "temporary_file_path"):
        return MediaFileUpload(
            uploaded.temporary_file_path(),
            mimetype=uploaded.content_type or "application/octet-stream",
            resumable=True,
        )
    data = uploaded.read()
    uploaded.seek(0)
    return MediaIoBaseUpload(
        BytesIO(data),
        mimetype=uploaded.content_type or "application/octet-stream",
        resumable=True,
    )


def _parse_fecha(fecha_registro):
    try:
        return datetime.strptime(fecha_registro, "%Y-%m-%d").date()
    except Exception:
        return datetime.utcnow().date()


def upload_comprobante_to_drive(uploaded, fecha_registro):
    if not uploaded:
        return ""

    service = _get_drive_service()
    root_id = _get_root_folder_id()
    drive_id = _get_drive_id(service, root_id)

    fecha = _parse_fecha(fecha_registro)
    year_folder = _ensure_folder(service, root_id, str(fecha.year), drive_id=drive_id)
    month_folder = _ensure_folder(service, year_folder, f"{fecha.month:02d}", drive_id=drive_id)

    _, ext = os.path.splitext(uploaded.name or "")
    base_name = f"{fecha.isoformat()}{ext}"
    file_name = _resolve_file_name(service, month_folder, base_name, drive_id=drive_id)

    metadata = {"name": file_name, "parents": [month_folder]}
    media = _build_media(uploaded)
    created = (
        service.files()
        .create(
            body=metadata,
            media_body=media,
            fields="id, webViewLink",
            supportsAllDrives=True,
        )
        .execute()
    )
    link = created.get("webViewLink")
    if link:
        return link
    file_id = created.get("id", "")
    return f"https://drive.google.com/file/d/{file_id}/view" if file_id else ""
