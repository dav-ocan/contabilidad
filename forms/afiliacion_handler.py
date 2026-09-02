import logging
import os
import re
from typing import Dict, List

from django.conf import settings
from gspread.utils import rowcol_to_a1

from finanzas_abaoca.services.google_sheets_service import get_google_sheet

logger = logging.getLogger(__name__)

# Columnas que se guardan como numero real (no texto) para que no haya
# ambiguedad de separador de miles/decimales al leerlas desde Apps Script.
MONEY_HEADER_KEYS = {
    "MONTO",
    "CUOTA_MENSUAL",
    "SALARIO",
    "TRABAJO_1",
    "TRABAJO_2",
    "SALDO_INICIAL",
    "ENTRADA_BANCO",
}

ALT_ID_KEYS = {
    "ID_UNICO",
    "ID_INTERNO",
    "ID",
    "ID_SOCIO",
    "CODIGO_SOCIO",
    "CODIGO",
    "CLAVE",
    "CLAVE_UNICA",
    "NO",
    "NO.",
    "NRO",
    "NUM",
    "NUMERO",
}

TRANSLITERATION = str.maketrans(
    {
        "\u00c1": "A",
        "\u00c9": "E",
        "\u00cd": "I",
        "\u00d3": "O",
        "\u00da": "U",
        "\u00dc": "U",
        "\u00d1": "N",
        "\u00c0": "A",
        "\u00c8": "E",
        "\u00cc": "I",
        "\u00d2": "O",
        "\u00d9": "U",
        "\u00c2": "A",
        "\u00ca": "E",
        "\u00ce": "I",
        "\u00d4": "O",
        "\u00db": "U",
        "\u00b0": "",
    }
)

def _normalize(col: str) -> str:
    col = "_".join(col.strip().upper().split())
    col = col.translate(TRANSLITERATION)
    return col

def _build_fila(header: List[str], data: Dict[str, str]) -> List[str]:
    filas = []
    for col in header:
        key = _normalize(col)
        if key in {"FECHA_DEL_REGISTRO", "FECHA_DE_REGISTRO", "FECHA_REGISTRO", "FECHA"}:
            filas.append(data.get("fecha_registro", ""))
        elif key in {"FECHA_DEL_GASTO", "FECHA_DE_GASTO", "FECHA_DE_GASTOS", "FECHA_GASTO", "FECHA_GASTOS"}:
            filas.append(data.get("fecha_gasto", ""))
        elif key in {"PERSONA_QUE_GASTO", "PERSONA_GASTO", "PERSONA"}:
            filas.append(data.get("persona_gasto", ""))
        elif key == "SALARIO":
            filas.append(data.get("salario", ""))
        elif key == "MONTO":
            filas.append(data.get("monto", ""))
        elif key in {"CATEGORIA_DE_GASTO", "CATEGORIA_GASTO", "CATEGORIA"}:
            filas.append(data.get("categoria_gasto", ""))
        elif key == "SUBCATEGORIA":
            filas.append(data.get("subcategoria", ""))
        elif key in {"METODO_DE_PAGO", "METODO_PAGO", "FORMA_DE_PAGO"}:
            filas.append(data.get("metodo_pago", ""))
        elif key in {"TIPO_DE_TARJETA", "TIPO_TARJETA"}:
            filas.append(data.get("tipo_tarjeta", ""))
        elif key in {"CUOTA_MENSUAL", "CUOTA"}:
            filas.append(data.get("cuota_mensual", ""))
        elif key == "METODO_DE_PAGO_CUOTA_MENSUAL":
            metodo = data.get("metodo_pago", "")
            cuota = data.get("cuota_mensual", "")
            if metodo and cuota:
                filas.append(f"{metodo} | cuota: {cuota}")
            else:
                filas.append(metodo)
        elif key in {"DESCRIPCION_O_DETALLE", "DESCRIPCION", "DETALLE"}:
            filas.append(data.get("descripcion", ""))
        elif key == "FRECUENCIA":
            filas.append(data.get("frecuencia", ""))
        elif key == "COMPROBANTE":
            filas.append(data.get("comprobante", ""))
        elif key in ALT_ID_KEYS:
            filas.append(data.get("_id_autoinc", ""))
        else:
            filas.append("")
    return filas


def _money_columns(header: List[str]) -> List[int]:
    """Indices (1-based) de columnas monetarias segun el encabezado."""
    return [idx + 1 for idx, col in enumerate(header) if _normalize(col) in MONEY_HEADER_KEYS]


def _row_from_append_response(response) -> "int | None":
    """Extrae el numero de fila donde gspread.append_row realmente escribio."""
    try:
        updated_range = response["updates"]["updatedRange"]
    except (KeyError, TypeError):
        return None
    match = re.search(r"![A-Za-z]+(\d+)", updated_range)
    return int(match.group(1)) if match else None


def _apply_currency_format(sheet, row_number: int, col_indices: List[int]):
    """Aplica formato de moneda a las celdas indicadas. Es solo estetico:
    si falla, no afecta el dato ya guardado."""
    for col_index in col_indices:
        try:
            cell = rowcol_to_a1(row_number, col_index)
            sheet.format(cell, {"numberFormat": {"type": "CURRENCY", "pattern": "$#,##0.00"}})
        except Exception:
            logger.warning("No se pudo aplicar formato de moneda en fila %s col %s.", row_number, col_index)


def _last_data_row(sheet, key_col: int = 1, header_row: int = 1) -> int:
    """Detecta la ultima fila con datos reales leyendo la primera columna
    (siempre poblada en una fila real: 'Fecha del registro' en 'cuentas',
    'Cedula' en 'Data'), en vez de confiar en el tamaño del grid de la hoja."""
    values = sheet.col_values(key_col)
    last_row = header_row
    for idx, value in enumerate(values, start=1):
        if str(value).strip():
            last_row = idx
    return last_row


def _trim_grid_to_data(sheet):
    """gspread's append_row() siempre agrega la fila nueva en (grid_row_count + 1),
    no despues de la ultima fila con datos reales. Si el grid de la hoja quedo mas
    grande que los datos (ej. alguien inserto/pego un rango grande de filas en
    Google Sheets y lo borro despues, lo cual no reduce el grid), append_row deja
    un salto enorme entre los datos reales y la fila nueva. Se recorta el grid al
    tamaño real de los datos antes de cada guardado para que esto no vuelva a
    pasar sin importar cuanto haya crecido el grid."""
    try:
        last_row = _last_data_row(sheet)
        target_rows = max(last_row, 2)
        if sheet.row_count > target_rows:
            sheet.resize(rows=target_rows)
    except Exception:
        logger.warning("No se pudo recortar el grid de '%s' antes de guardar.", sheet.title)


def guardar_nuevo_afiliado_en_google_sheets(data: Dict[str, str]) -> bool:
    sheet_id = os.getenv("SHEET_PATH") or getattr(settings, "SHEET_PATH", "")
    if not sheet_id:
        raise RuntimeError("SHEET_PATH is not configured.")

    sheet = get_google_sheet(sheet_id, "cuentas")
    _trim_grid_to_data(sheet)

    header_row = 1
    data_start_row = header_row + 1
    header = sheet.row_values(header_row)

    id_col_index = None
    for idx, col in enumerate(header):
        if _normalize(col) in ALT_ID_KEYS:
            id_col_index = idx + 1
            break

    next_id = ""
    if id_col_index:
        col_values = sheet.col_values(id_col_index)
        existing_ids: List[int] = []
        for raw in col_values[data_start_row - 1:]:
            try:
                existing_ids.append(int(str(raw).strip()))
            except (TypeError, ValueError):
                continue
        next_id = str(max(existing_ids) + 1) if existing_ids else "1"
    data["_id_autoinc"] = next_id

    fila = _build_fila(header, data)

    response = sheet.append_row(fila, value_input_option="RAW")
    row_number = _row_from_append_response(response)
    money_cols = _money_columns(header)
    if row_number and money_cols:
        _apply_currency_format(sheet, row_number, money_cols)
    return True


def _get_header_map(header: List[str]) -> Dict[str, int]:
    return {_normalize(col): idx + 1 for idx, col in enumerate(header)}


def _set_if_present(row: List[str], header_map: Dict[str, int], keys: List[str], value: str):
    for key in keys:
        col_index = header_map.get(key)
        if col_index:
            row[col_index - 1] = value
            return


def _normalize_value(value: str) -> str:
    return str(value or "").strip().lower()


def _find_row_by_value(sheet, col_index: int, value: str, start_row: int) -> int:
    if not col_index or not value:
        return 0
    values = sheet.col_values(col_index)
    target = _normalize_value(value)
    for idx, raw in enumerate(values[start_row - 1 :], start=start_row):
        if _normalize_value(raw) == target:
            return idx
    return 0


def get_cedula_for_persona(persona: str) -> str:
    sheet_id = os.getenv("SHEET_PATH") or getattr(settings, "SHEET_PATH", "")
    if not sheet_id:
        raise RuntimeError("SHEET_PATH is not configured.")

    sheet = get_google_sheet(sheet_id, "Data")
    header_row = 1
    header = sheet.row_values(header_row)
    if not header:
        return ""

    header_map = _get_header_map(header)
    persona_col = header_map.get("PERSONA")
    cedula_col = header_map.get("CEDULA") or header_map.get("RUC")
    if not persona_col or not cedula_col:
        return ""

    data_start_row = header_row + 1
    target_row = _find_row_by_value(sheet, persona_col, persona, data_start_row)
    if not target_row:
        return ""

    row = sheet.row_values(target_row)
    if len(row) < cedula_col:
        return ""
    return str(row[cedula_col - 1]).strip()


def upsert_salario_data(data: Dict[str, str]) -> bool:
    sheet_id = os.getenv("SHEET_PATH") or getattr(settings, "SHEET_PATH", "")
    if not sheet_id:
        raise RuntimeError("SHEET_PATH is not configured.")

    sheet = get_google_sheet(sheet_id, "Data")
    _trim_grid_to_data(sheet)
    header_row = 1
    header = sheet.row_values(header_row)
    if not header:
        raise RuntimeError("Data sheet has no headers.")

    header_map = _get_header_map(header)
    cedula_col = header_map.get("CEDULA") or header_map.get("RUC")
    persona_col = header_map.get("PERSONA")
    if not persona_col:
        raise RuntimeError("Data sheet must include PERSONA column.")

    cedula_value = data.get("cedula", "").strip()
    persona_value = data.get("persona", "").strip()
    if not persona_value:
        raise RuntimeError("Persona is required.")

    data_start_row = header_row + 1
    if cedula_col:
        if not cedula_value:
            existing_row = _find_row_by_value(sheet, persona_col, persona_value, data_start_row)
            if existing_row:
                existing = sheet.row_values(existing_row)
                if len(existing) >= cedula_col:
                    cedula_value = str(existing[cedula_col - 1]).strip()
        if not cedula_value:
            raise RuntimeError("Cedula is required for new persona.")

    row = [""] * len(header)
    if cedula_col:
        row[cedula_col - 1] = cedula_value
    _set_if_present(row, header_map, ["PERSONA"], persona_value)
    _set_if_present(row, header_map, ["TRABAJO_1"], data.get("trabajo_1", ""))
    _set_if_present(row, header_map, ["TRABAJO_2"], data.get("trabajo_2", ""))
    _set_if_present(row, header_map, ["SALARIO"], data.get("salario", ""))
    _set_if_present(row, header_map, ["SALDO_INICIAL"], data.get("saldo_inicial", ""))
    _set_if_present(row, header_map, ["ENTRADA_BANCO"], data.get("entrada_banco", ""))
    _set_if_present(row, header_map, ["MES"], data.get("mes", ""))

    response = sheet.append_row(row, value_input_option="RAW")
    row_number = _row_from_append_response(response)
    money_cols = _money_columns(header)
    if row_number and money_cols:
        _apply_currency_format(sheet, row_number, money_cols)
    return True
