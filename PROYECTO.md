# Finanzas Familia Abaoca

## Que es esto
App Django para llevar el control de gastos e ingresos familiares (Lorena y Julio). Dos formularios simples: registrar un gasto y actualizar el salario/ingreso mensual por persona. Los datos se guardan directo en un Google Sheet compartido, y los comprobantes (fotos/PDF) se suben a una carpeta de Google Drive organizada por año/mes.

## Ubicacion
- Carpeta local: `C:\Users\Alexe\OneDrive\Desktop\Finanzas Familia Abaoca` (renombrada el 2026-09-02; antes se llamaba "Desarrollo gastos")
- Repo GitHub: https://github.com/dav-ocan/contabilidad
- Deploy (Render): https://contabilidad-ezwy.onrender.com
- Paquete Django interno: `finanzas_abaoca` (renombrado el 2026-09-02; antes se llamaba `capig_form`, heredado de un template viejo de otro proyecto)

**IMPORTANTE - no confundir:** existe otra carpeta llamada `contabilidad_familiar` (repo `dav-ocan/contabilidad_familiar`) en el mismo Desktop. A pesar del nombre, ESE proyecto es un sistema de afiliados/socios de un gremio (RUC, sectores, ventas anuales) sin ninguna relacion con las finanzas familiares. No tocar ese proyecto al trabajar aqui.

## Integraciones externas
- **Google Sheet**: "DESARROLLO GASTOS" — ID `1qeV3a2_iyKJ8cdCOxHBa4xK2JjN5guSh-5yb-cojEDY`
  - Link: https://docs.google.com/spreadsheets/d/1qeV3a2_iyKJ8cdCOxHBa4xK2JjN5guSh-5yb-cojEDY/edit
  - Pestanas: `cuentas` (gastos individuales), `Data` (ingresos/salario por persona y mes), `calculos` (totales mensuales calculados por Apps Script)
- **Google Drive**: carpeta raiz de comprobantes — ID `10z1F8Pfl1GqQn_1f2VY6icyl6SH9KITw` (subcarpetas automaticas por año/mes)
- **Credenciales**: service account de Google Cloud (`contabilidad@wide-journey-421422.iam.gserviceaccount.com`), configurado via `.env` local (`GOOGLE_CLOUD_CREDENTIALS`, `SHEET_PATH`, `DRIVE_FOLDER_ID`). El `.env` esta en `.gitignore`, nunca se ha commiteado.

## Estructura del codigo
- `forms/view/form_views.py` — vistas: `nuevo_afiliado_view` (formulario de gasto, mal nombrada por herencia de un template viejo de CAPIG), `actualizar_salario_view` (formulario de ingreso/salario)
- `forms/afiliacion_handler.py` — logica de escritura a Sheets (`guardar_nuevo_afiliado_en_google_sheets`, `upsert_salario_data`, `get_cedula_for_persona`)
- `finanzas_abaoca/services/google_sheets_service.py` / `google_drive_service.py` / `google_credentials.py` — clientes de Google Sheets/Drive
- `calculo.js` — Apps Script (vive DENTRO del Google Sheet, no en este repo) que sincroniza `cuentas` + `Data` hacia `calculos` y calcula Saldo final / Diferencia por mes. Se dispara cada 5 min via trigger, o manualmente con el checkbox en `calculos!M2`.

## Revision de calculos (2026-09-01) — auditoria inicial
Se hizo una auditoria completa del flujo de calculo. 5 hallazgos, de mayor a menor riesgo (ver detalle mas abajo de cuales se corrigieron).

## Correcciones aplicadas (2026-09-02)
Se corrigieron los 4 hallazgos de mayor riesgo. Todos los cambios son solo hacia adelante: no leen ni reescriben filas existentes en `cuentas`/`Data`, solo cambian como se guardan/calculan los datos nuevos a partir de ahora.

1. **Parseo ambiguo de montos (`cuota_mensual`)** — CORREGIDO. El campo paso de texto libre a `type="number"` en `afiliado_form.html`, y en `form_views.py` todos los montos (`monto`, `trabajo_1/2`, `salario`, `saldo_inicial`, `entrada_banco`, `cuota_mensual`) ahora se validan y convierten a `float` real via la nueva funcion `_parse_amount()` (reemplaza a `_format_currency`/`_format_currency_if_number`, que se eliminaron por quedar sin uso). En `afiliacion_handler.py` esos valores se escriben al Sheet como numero real (no como texto "$1,234.56"), eliminando de raiz la ambiguedad de separador de miles/decimales para toda fila nueva. Se agrego formato de moneda automatico (`$#,##0.00`) a esas celdas al guardarlas. Riesgo residual: si alguien edita una celda a mano directo en el Sheet con formato "1.234" (punto como separador de miles, sin coma), `calculo.js` (`parseAmount_`) todavia puede interpretarlo mal — no hay forma de corregir esto desde el codigo, es disciplina de captura manual (escribir montos en Sheets sin puntos de miles, ej. "1234.56" o usar coma decimal "1234,56").
2. **Doble conteo de "Saldo inicial"/"Entrada banco"** — CORREGIDO en `calculo.js` (pegado manualmente en el editor de Apps Script del Sheet, ya que no hay acceso directo desde este repo). Antes se sumaban por cada fila de `Data` del mes; ahora se toma el valor MAS RECIENTE del mes (no el primero, no la suma), y si cambia respecto al anterior se deja un aviso en el log de ejecucion de Apps Script (Ver > Registros) en vez de sumarlo silenciosamente.
2b. **Doble conteo de "Trabajo 1"/"Trabajo 2"/"Salario" al corregir un envio** — CORREGIDO en `calculo.js` (2026-09-02, mismo dia, tras confirmar con el usuario que "actualizar salario" se puede reenviar para el mismo mes para reflejar un cambio de sueldo). Antes, si la MISMA persona reenviaba el formulario de salario para el mismo mes (para corregir un monto), el script sumaba la fila vieja Y la nueva. Ahora se dedupe por `persona + mes`: la fila mas reciente de esa persona para ese mes reemplaza a la anterior. Entre personas DISTINTAS si se sigue sumando (Lorena + Julio = ingreso total del hogar). Requirio agregar lectura de la columna `Persona` en `Data` (antes no se leia en el script).
3. **Emparejamiento posicional gasto/cobro en `calculos`** — PENDIENTE, no corregido (cambio estructural del layout de la hoja, se decide en conjunto antes de tocarlo). El total mensual (Saldo final/Diferencia) es correcto de todas formas.
4. **Condicion de carrera al guardar** — CORREGIDO. `guardar_nuevo_afiliado_en_google_sheets` y `upsert_salario_data` ahora usan `sheet.append_row(..., value_input_option="RAW")` (atomico del lado de la API de Sheets) en vez de calcular la fila con `len(get_all_values())+1` y hacer `update()` — ya no hay riesgo de que dos guardados casi simultaneos se sobreescriban entre si.
5. **Zona horaria de Apps Script** — PENDIENTE de verificar (Extensiones > Apps Script > Configuracion del proyecto > Zona horaria). Si no es UTC, gastos registrados el dia 1 del mes podrian contarse en el mes anterior.

## Renombrado del paquete y carpeta (2026-09-02)
`capig_form` → `finanzas_abaoca` en todo el codigo (10 referencias: Procfile, manage.py, settings.py, wsgi.py, asgi.py, urls internos, imports de servicios). Ningun texto visible al usuario mencionaba "capig" (solo el nombre interno del paquete), asi que el cambio es puramente tecnico. Verificado con `manage.py check` (limpio) y con `django.test.Client` contra las vistas reales (GET a `/`, `/registrar-afiliado/`, `/actualizar-salario/` — las 3 devuelven 200) usando un entorno virtual temporal con las dependencias reales instaladas.

## Bug critico encontrado y corregido: `requirements.txt` (2026-09-02)
`requirements.txt` tenia `python-environ==0.4.54`, un paquete que **no existe en PyPI** (el correcto es `django-environ`, que es lo que el codigo realmente usa via `import environ`). Esto ya estaba asi en el ultimo commit (o sea, ya en lo que Render tiene desplegado) — si Render alguna vez necesita reconstruir el proyecto desde cero, el build fallaria. Corregido a `django-environ==0.11.2`. Verificado: `pip install -r requirements.txt` limpio + `manage.py check` limpio con las dependencias reales.

## Verificacion end-to-end (2026-09-02) — con datos reales del Sheet
Se conecto con las credenciales reales (solo lectura) para confirmar que todo llega correctamente:
- Las 3 hojas existen y son accesibles: `cuentas`, `Data`, `calculos`.
- `cuentas`: 105 filas de gastos reales, encabezados y datos llegando correctamente.
- `calculos`: 105 filas calculadas, formulas corriendo.
- **HALLAZGO IMPORTANTE: `Data` esta completamente vacia (0 filas, solo encabezados).** Nunca se ha registrado un salario/ingreso a traves del formulario "Actualizar salario". Esto explica por que `calculos!Saldo final` siempre da negativo (ej. -$476.10): la formula (Saldo inicial + Cobros - Gastos) es matematicamente correcta, pero como Saldo inicial y Cobros siempre son $0 (nunca se ha llenado esa hoja), el resultado es simplemente "menos todo lo gastado". No es un bug de codigo — es que el formulario de salario aparentemente nunca se ha usado. Pendiente de confirmar con el usuario si es intencional (no lo usan) o si hay que probar que el formulario efectivamente escribe bien (requeriria una escritura de prueba real al Sheet, no se hizo sin autorizacion explicita).
- Encabezados reales observados:
  - `cuentas` (12 cols): Fecha del registro | Fecha de gasto | Persona que gastó | Monto | Categoría de gasto | Subcategoría | Método de pago | TIpo de tarjeta | cuota mensual | Descripción o detalle | Frecuencia | Comprobante
  - `Data` (8 cols): Cedula | Persona | Salario | trabajo 1 | trabajo 2 | Saldo inicial | Entrada banco | Mes
  - `calculos` (13 cols): saldo inicial (opcional) | Tipo Cobros | cobros monto | Categoría de gasto | Subcategoría | Monto categoria | saldo final | Entrada banco | diferencia | Fecha de gasto | Mes | Año | Actualizar (col M = checkbox de sync)

## Propuesta de reorganizacion de encabezados en `cuentas` (pendiente de aprobacion, no aplicada)
Desde una perspectiva contable, el orden actual mezcla metadata de sistema (fecha de registro) con datos de la transaccion. Propuesta:
1. Fecha de gasto (fecha real de la transaccion, debe liderar)
2. Persona que gastó
3. Categoría de gasto
4. Subcategoría
5. Monto
6. Método de pago
7. Tipo de tarjeta
8. cuota mensual
9. Descripción o detalle
10. Frecuencia
11. Comprobante
12. Fecha del registro (metadata/auditoria — al final, como campo de control)

Es seguro reordenar (ver nota abajo sobre que el codigo lee por nombre, no posicion) — **excepto la hoja `calculos`**, donde la columna "Actualizar" (checkbox de sync) esta referenciada por posicion fija `M2` en `calculo.js` (`readCheckboxFlag_(dst, "M2")` y `dst.getRange("M2")`), no por nombre. Si se reordena `calculos` y "Actualizar" deja de ser la columna M, hay que actualizar esas 2 referencias en el script manualmente.

## Nota sobre reordenar columnas/encabezados en los Sheets
Tanto el codigo Python (`afiliacion_handler.py`, via `_normalize()` + listas de alias) como el Apps Script (`calculo.js`, via `findHeaderIndex_`) leen y escriben **por nombre de encabezado**, no por posicion fija de columna. Mover una columna completa (encabezado + su data) a otra posicion en `cuentas`, `Data` o `calculos` es seguro siempre que: (a) se mueva el encabezado junto con toda su columna de datos (un "mover columna" normal de Sheets ya hace esto), y (b) el texto del encabezado siga coincidiendo con alguno de los alias reconocidos en el codigo (ej. "Categoria de gasto" tambien acepta "Categoria gasto"; revisar `ALT_ID_KEYS`/alias en `_build_fila` y los arrays de `findHeaderIndex_` en `calculo.js` para ver que variantes de nombre estan cubiertas antes de renombrar a algo distinto).
