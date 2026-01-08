# -*- coding: utf-8 -*-
import logging
import re
import traceback

import gspread
from django.conf import settings
from google.oauth2.service_account import Credentials
from gspread.exceptions import APIError, SpreadsheetNotFound, WorksheetNotFound

from capig_form.services.google_credentials import load_service_account_info

try:
    from googleapiclient.errors import HttpError
except ImportError:  # optional dependency
    HttpError = Exception

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


def _print_utf8(message):
    print(str(message).encode("utf-8", errors="replace").decode("utf-8"))


def _get_client():
    try:
        info = load_service_account_info(settings.SERVICE)
        creds = Credentials.from_service_account_info(info, scopes=SCOPES)
        return gspread.authorize(creds)
    except Exception as exc:
        logger.exception("Error authenticating with Google Sheets.")
        _print_utf8(traceback.format_exc())
        raise RuntimeError("Could not authenticate with Google Sheets.") from exc


def get_google_sheet(sheet_id, worksheet_name):
    try:
        client = _get_client()
        spreadsheet = client.open_by_key(sheet_id)
        worksheets = spreadsheet.worksheets()
        available_titles = [ws.title for ws in worksheets]

        _print_utf8(f"sheet_id requested: {sheet_id}")
        _print_utf8(f"worksheet_name requested: {repr(worksheet_name)}")
        _print_utf8(f"Worksheets available: {available_titles}")

        if worksheet_name not in available_titles:
            logger.warning(
                "Worksheet '%s' not found in: %s",
                worksheet_name,
                available_titles,
            )

        return spreadsheet.worksheet(worksheet_name)

    except WorksheetNotFound as exc:
        msg = f"Worksheet '{worksheet_name}' not found."
        logger.exception(msg)
        _print_utf8(msg)
        _print_utf8(traceback.format_exc())
        raise

    except SpreadsheetNotFound as exc:
        msg = f"Spreadsheet not found with ID: {sheet_id}"
        logger.exception(msg)
        _print_utf8(msg)
        _print_utf8(traceback.format_exc())
        raise

    except Exception as exc:
        msg = f"Unexpected error accessing sheet: {exc}"
        logger.exception(msg)
        _print_utf8(msg)
        _print_utf8(traceback.format_exc())
        raise


def insert_row_to_sheet(sheet_id, worksheet_name, data):
    try:
        sheet = get_google_sheet(sheet_id, worksheet_name)
        logger.info("Appending row to '%s': len=%s data=%s", worksheet_name, len(data), data)
        _print_utf8(f"Appending {len(data)} values to '{worksheet_name}': {data}")
        sheet.append_row(data)
        return True

    except (WorksheetNotFound, SpreadsheetNotFound):
        logger.exception("Could not insert row because sheet or document was not found.")
        _print_utf8(traceback.format_exc())
        return False

    except (APIError, HttpError):
        logger.exception("Google API rejected the insert in '%s'.", worksheet_name)
        _print_utf8(traceback.format_exc())
        return False

    except Exception:
        logger.exception("Unexpected error inserting row into '%s'.", worksheet_name)
        _print_utf8(traceback.format_exc())
        return False


def update_sheet_with_dataframe(sheet_id, worksheet_name, df):
    try:
        sheet = get_google_sheet(sheet_id, worksheet_name)
        sheet.clear()
        headers = df.columns.values.tolist()
        data = df.values.tolist()
        all_data = [headers] + data
        _print_utf8(f"Uploading {len(data)} rows + headers to '{worksheet_name}' in {sheet_id}")
        sheet.update(all_data)
        return True
    except Exception:
        logger.exception("Error updating sheet with DataFrame.")
        _print_utf8(traceback.format_exc())
        return False


def get_column_data(sheet_id, worksheet_index=0, column="A", start_row=2):
    try:
        column = column.strip()
        if not column:
            raise ValueError("Parameter 'column' cannot be empty.")
        if not re.fullmatch(r"[A-Za-z]", column):
            raise ValueError("Parameter 'column' must be a single letter A-Z.")

        client = _get_client()
        sheet = client.open_by_key(sheet_id).get_worksheet(worksheet_index)

        col_num = ord(column.upper()) - ord("A") + 1
        column_values = sheet.col_values(col_num)
        result = [val.strip() for val in column_values[start_row - 1:] if val.strip()]

        logger.info("Read %s values from column '%s'.", len(result), column)
        return result

    except ValueError as exc:
        logger.exception("Invalid column identifier: '%s'.", column)
        _print_utf8(str(exc))
        _print_utf8(traceback.format_exc())
        raise

    except Exception:
        logger.exception("Error reading column '%s'.", column)
        _print_utf8(traceback.format_exc())
        return []
