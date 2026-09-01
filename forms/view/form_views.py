from decimal import Decimal, InvalidOperation
import logging

from django.shortcuts import render
from django.contrib import messages
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods, require_GET
from django.utils.timezone import now
import pytz

from finanzas_abaoca.services.google_drive_service import upload_comprobante_to_drive
from forms.afiliacion_handler import (
    guardar_nuevo_afiliado_en_google_sheets,
    upsert_salario_data,
    get_cedula_for_persona,
)

logger = logging.getLogger(__name__)

PERSONAS = [
    "Lorena",
    "Julio",
]
MESES = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
]


def dashboard_view(request):
    return render(request, "dashboard.html")


def _fecha_actual():
    guayaquil = pytz.timezone("America/Guayaquil")
    return now().astimezone(guayaquil).date().isoformat()


def _clean_text(value: str) -> str:
    return " ".join(value.split()) if value else ""


def _normalize_number(raw: str) -> str:
    cleaned = raw.strip().replace(" ", "")
    cleaned = cleaned.replace("$", "")

    if "," in cleaned and "." in cleaned:
        if cleaned.rfind(",") > cleaned.rfind("."):
            cleaned = cleaned.replace(".", "")
            cleaned = cleaned.replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif "," in cleaned:
        parts = cleaned.split(",")
        if len(parts[-1]) <= 2:
            cleaned = ".".join(parts)
        else:
            cleaned = "".join(parts)

    return cleaned


def _parse_amount(raw: str) -> float:
    """Valida y convierte un monto a float real (no texto), para que se
    guarde como numero nativo en el Google Sheet sin ambiguedad de separadores."""
    if not raw:
        return 0.0
    normalized = _normalize_number(raw)
    try:
        amount = Decimal(normalized)
    except InvalidOperation as exc:
        raise ValueError("Invalid number") from exc
    return float(amount)


def _list_get(values, index) -> str:
    try:
        return values[index]
    except IndexError:
        return ""


@require_http_methods(["GET", "POST"])
def nuevo_afiliado_view(request):
    fecha_registro = _fecha_actual()
    fecha_gasto_default = fecha_registro

    if request.method == "POST":
        fechas_gasto = request.POST.getlist("fecha_gasto")
        personas_gasto = request.POST.getlist("persona_gasto")
        montos_raw = request.POST.getlist("monto")
        categorias_gasto = request.POST.getlist("categoria_gasto")
        categorias_otro = request.POST.getlist("categoria_otro")
        subcategorias = request.POST.getlist("subcategoria")
        metodos_pago = request.POST.getlist("metodo_pago")
        cuotas_raw = request.POST.getlist("cuota_mensual")
        tipos_tarjeta = request.POST.getlist("tipo_tarjeta")
        descripciones = request.POST.getlist("descripcion")
        frecuencias = request.POST.getlist("frecuencia")
        comprobantes = request.FILES.getlist("comprobante")

        entry_count = max(
            len(fechas_gasto),
            len(personas_gasto),
            len(montos_raw),
            len(categorias_gasto),
            len(metodos_pago),
        )

        if entry_count == 0:
            messages.error(request, "Debe registrar al menos un gasto.")
            return render(
                request,
                "afiliado_form.html",
                {"fecha_registro": fecha_registro, "fecha_gasto": fecha_gasto_default, "personas": PERSONAS},
            )

        for idx in range(entry_count):
            fecha_gasto = _clean_text(_list_get(fechas_gasto, idx)) or fecha_gasto_default
            persona_gasto = _clean_text(_list_get(personas_gasto, idx))
            monto_raw = _list_get(montos_raw, idx).strip()
            categoria_gasto = _clean_text(_list_get(categorias_gasto, idx))
            categoria_otro = _clean_text(_list_get(categorias_otro, idx))
            subcategoria = _clean_text(_list_get(subcategorias, idx))
            metodo_pago = _clean_text(_list_get(metodos_pago, idx))
            cuota_raw = _list_get(cuotas_raw, idx).strip()
            tipo_tarjeta = _clean_text(_list_get(tipos_tarjeta, idx))
            descripcion = _clean_text(_list_get(descripciones, idx))
            frecuencia = _clean_text(_list_get(frecuencias, idx))
            comprobante_file = comprobantes[idx] if idx < len(comprobantes) else None

            if categoria_gasto == "Otros" and categoria_otro:
                categoria_final = categoria_otro
                subcategoria_final = ""
            else:
                categoria_final = categoria_gasto
                subcategoria_final = subcategoria

            if metodo_pago != "Tarjeta":
                cuota_raw = ""
                tipo_tarjeta = ""

            try:
                monto = _parse_amount(monto_raw)
            except ValueError:
                messages.error(request, f"Monto tiene un formato invalido. (Gasto #{idx + 1})")
                return render(
                    request,
                    "afiliado_form.html",
                    {
                        "fecha_registro": fecha_registro,
                        "fecha_gasto": fecha_gasto_default,
                        "personas": PERSONAS,
                    },
                )

            cuota_mensual = ""
            if cuota_raw:
                try:
                    cuota_mensual = _parse_amount(cuota_raw)
                except ValueError:
                    messages.error(request, f"Cuota mensual tiene un formato invalido. (Gasto #{idx + 1})")
                    return render(
                        request,
                        "afiliado_form.html",
                        {
                            "fecha_registro": fecha_registro,
                            "fecha_gasto": fecha_gasto_default,
                            "personas": PERSONAS,
                        },
                    )

            try:
                comprobante_link = ""
                if comprobante_file:
                    try:
                        comprobante_link = upload_comprobante_to_drive(comprobante_file, fecha_registro)
                    except Exception as exc:
                        logger.exception("Error uploading comprobante to Drive.")
                        message = str(exc).strip() or exc.__class__.__name__
                        messages.error(request, f"Error al subir comprobante: {message}")
                        return render(
                            request,
                            "afiliado_form.html",
                            {
                                "fecha_registro": fecha_registro,
                                "fecha_gasto": fecha_gasto_default,
                                "personas": PERSONAS,
                            },
                        )
                guardar_nuevo_afiliado_en_google_sheets({
                    "fecha_registro": fecha_registro,
                    "fecha_gasto": fecha_gasto,
                    "persona_gasto": persona_gasto,
                    "monto": monto,
                    "categoria_gasto": categoria_final,
                    "subcategoria": subcategoria_final,
                    "metodo_pago": metodo_pago,
                    "cuota_mensual": cuota_mensual,
                    "tipo_tarjeta": tipo_tarjeta,
                    "descripcion": descripcion,
                    "frecuencia": frecuencia,
                    "comprobante": comprobante_link,
                })
            except Exception as exc:
                logger.exception("Error registering expense.")
                message = str(exc).strip() or exc.__class__.__name__
                messages.error(request, f"Error al registrar: {message}")
                return render(
                    request,
                    "afiliado_form.html",
                    {
                        "fecha_registro": fecha_registro,
                        "fecha_gasto": fecha_gasto_default,
                        "personas": PERSONAS,
                    },
                )

        return render(request, "success_afiliado.html")

    return render(
        request,
        "afiliado_form.html",
        {"fecha_registro": fecha_registro, "fecha_gasto": fecha_gasto_default, "personas": PERSONAS},
    )


@require_http_methods(["GET", "POST"])
def actualizar_salario_view(request):
    if request.method == "POST":
        cedula = _clean_text(request.POST.get("cedula", ""))
        persona = _clean_text(request.POST.get("persona", ""))
        trabajo_1_raw = request.POST.get("trabajo_1", "").strip()
        trabajo_2_raw = request.POST.get("trabajo_2", "").strip()
        salario_raw = request.POST.get("salario", "").strip()
        saldo_inicial_raw = request.POST.get("saldo_inicial", "").strip()
        entrada_banco_raw = request.POST.get("entrada_banco", "").strip()
        mes = _clean_text(request.POST.get("mes", ""))

        if persona and not cedula:
            try:
                cedula = get_cedula_for_persona(persona)
            except Exception:
                cedula = ""

        trabajo_1 = ""
        trabajo_2 = ""
        if trabajo_1_raw:
            try:
                trabajo_1 = _parse_amount(trabajo_1_raw)
            except ValueError:
                messages.error(request, "Trabajo 1 tiene un formato invalido.")
                return render(request, "salario_form.html", {"personas": PERSONAS, "meses": MESES})
        if trabajo_2_raw:
            try:
                trabajo_2 = _parse_amount(trabajo_2_raw)
            except ValueError:
                messages.error(request, "Trabajo 2 tiene un formato invalido.")
                return render(request, "salario_form.html", {"personas": PERSONAS, "meses": MESES})

        try:
            salario = _parse_amount(salario_raw)
        except ValueError:
            messages.error(request, "Salario tiene un formato invalido.")
            return render(request, "salario_form.html", {"personas": PERSONAS, "meses": MESES})

        saldo_inicial = ""
        if saldo_inicial_raw:
            try:
                saldo_inicial = _parse_amount(saldo_inicial_raw)
            except ValueError:
                messages.error(request, "Saldo inicial tiene un formato invalido.")
                return render(request, "salario_form.html", {"personas": PERSONAS, "meses": MESES})

        entrada_banco = ""
        if entrada_banco_raw:
            try:
                entrada_banco = _parse_amount(entrada_banco_raw)
            except ValueError:
                messages.error(request, "Entrada banco tiene un formato invalido.")
                return render(request, "salario_form.html", {"personas": PERSONAS, "meses": MESES})

        try:
            upsert_salario_data({
                "cedula": cedula,
                "persona": persona,
                "trabajo_1": trabajo_1,
                "trabajo_2": trabajo_2,
                "salario": salario,
                "saldo_inicial": saldo_inicial,
                "entrada_banco": entrada_banco,
                "mes": mes,
            })
            return render(request, "success_afiliado.html")
        except Exception as exc:
            logger.exception("Error updating salary data.")
            message = str(exc).strip() or exc.__class__.__name__
            messages.error(request, f"Error al registrar: {message}")

    return render(request, "salario_form.html", {"personas": PERSONAS, "meses": MESES})


@require_GET
def cedula_por_persona_view(request):
    persona = _clean_text(request.GET.get("persona", ""))
    if not persona:
        return JsonResponse({"cedula": ""})
    try:
        cedula = get_cedula_for_persona(persona)
        return JsonResponse({"cedula": cedula})
    except Exception as exc:
        logger.exception("Error fetching cedula by persona.")
        message = str(exc).strip() or exc.__class__.__name__
        return JsonResponse({"error": message}, status=500)


@require_GET
def success_afiliado_view(request):
    return render(request, "success_afiliado.html")
