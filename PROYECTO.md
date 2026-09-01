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
- `calculo.js` — Apps Script (vive DENTRO del Google Sheet, no en este repo) que sincroniza `cuentas` + `Data` hacia `calculos` en 3 bloques separados (GASTOS, INGRESOS, RESUMEN MENSUAL — ver seccion "Rediseño de `calculos`" mas abajo). Se dispara cada 5 min via trigger, o manualmente con el checkbox en `calculos!V2`.

## Revision de calculos (2026-09-01) — auditoria inicial
Se hizo una auditoria completa del flujo de calculo. 5 hallazgos, de mayor a menor riesgo (ver detalle mas abajo de cuales se corrigieron).

## Correcciones aplicadas (2026-09-02)
Se corrigieron los 4 hallazgos de mayor riesgo. Todos los cambios son solo hacia adelante: no leen ni reescriben filas existentes en `cuentas`/`Data`, solo cambian como se guardan/calculan los datos nuevos a partir de ahora.

1. **Parseo ambiguo de montos (`cuota_mensual`)** — CORREGIDO. El campo paso de texto libre a `type="number"` en `afiliado_form.html`, y en `form_views.py` todos los montos (`monto`, `trabajo_1/2`, `salario`, `saldo_inicial`, `entrada_banco`, `cuota_mensual`) ahora se validan y convierten a `float` real via la nueva funcion `_parse_amount()` (reemplaza a `_format_currency`/`_format_currency_if_number`, que se eliminaron por quedar sin uso). En `afiliacion_handler.py` esos valores se escriben al Sheet como numero real (no como texto "$1,234.56"), eliminando de raiz la ambiguedad de separador de miles/decimales para toda fila nueva. Se agrego formato de moneda automatico (`$#,##0.00`) a esas celdas al guardarlas. Riesgo residual: si alguien edita una celda a mano directo en el Sheet con formato "1.234" (punto como separador de miles, sin coma), `calculo.js` (`parseAmount_`) todavia puede interpretarlo mal — no hay forma de corregir esto desde el codigo, es disciplina de captura manual (escribir montos en Sheets sin puntos de miles, ej. "1234.56" o usar coma decimal "1234,56").
2. **Doble conteo de "Saldo inicial"/"Entrada banco"** — CORREGIDO en `calculo.js` (pegado manualmente en el editor de Apps Script del Sheet, ya que no hay acceso directo desde este repo). Antes se sumaban por cada fila de `Data` del mes; ahora se toma el valor MAS RECIENTE del mes (no el primero, no la suma), y si cambia respecto al anterior se deja un aviso en el log de ejecucion de Apps Script (Ver > Registros) en vez de sumarlo silenciosamente.
2b. **Doble conteo de "Trabajo 1"/"Trabajo 2"/"Salario" al corregir un envio** — CORREGIDO en `calculo.js` (2026-09-02, mismo dia, tras confirmar con el usuario que "actualizar salario" se puede reenviar para el mismo mes para reflejar un cambio de sueldo). Antes, si la MISMA persona reenviaba el formulario de salario para el mismo mes (para corregir un monto), el script sumaba la fila vieja Y la nueva. Ahora se dedupe por `persona + mes`: la fila mas reciente de esa persona para ese mes reemplaza a la anterior. Entre personas DISTINTAS si se sigue sumando (Lorena + Julio = ingreso total del hogar). Requirio agregar lectura de la columna `Persona` en `Data` (antes no se leia en el script).
3. **Emparejamiento posicional gasto/cobro en `calculos`** — CORREGIDO el 2026-09-01 (ver seccion "Rediseño de `calculos`" mas abajo). El total mensual (Saldo final/Diferencia) siempre fue correcto de todas formas, esto era solo un problema de presentacion/entendibilidad.
4. **Condicion de carrera al guardar** — CORREGIDO. `guardar_nuevo_afiliado_en_google_sheets` y `upsert_salario_data` ahora usan `sheet.append_row(..., value_input_option="RAW")` (atomico del lado de la API de Sheets) en vez de calcular la fila con `len(get_all_values())+1` y hacer `update()` — ya no hay riesgo de que dos guardados casi simultaneos se sobreescriban entre si.
5. **Zona horaria de Apps Script** — el riesgo concreto (gastos del dia 1 del mes contandose en el mes anterior) quedo CORREGIDO el 2026-09-01 parseando las fechas en hora LOCAL en vez de dejar que el motor de JS las interprete como UTC (ver seccion "Rediseño de `calculos`"). Ya no depende de la config de zona horaria del proyecto de Apps Script, asi que no hace falta verificarla para este caso — pero sigue siendo buena practica revisarla (Extensiones > Apps Script > Configuracion del proyecto > Zona horaria) si en el futuro se agregan otros calculos basados en fecha/hora.

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
  - `calculos` — layout viejo hasta el 2026-09-01: saldo inicial (opcional) | Tipo Cobros | cobros monto | Categoría de gasto | Subcategoría | Monto categoria | saldo final | Entrada banco | diferencia | Fecha de gasto | Mes | Año | Actualizar (col M = checkbox de sync). Ver "Rediseño de `calculos`" mas abajo para el layout actual.

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

Es seguro reordenar (ver nota abajo sobre que el codigo lee por nombre, no posicion) — **excepto la hoja `calculos`**, donde el layout de columnas esta fijo por posicion en `calculo.js` (constantes `GASTOS_COL`, `INGRESOS_COL`, `RESUMEN_COL`, `CHECKBOX_COL`), no por nombre. Ver "Rediseño de `calculos`" para el detalle.

## Rediseño de `calculos` en 3 bloques + fix de fechas (2026-09-01)
A pedido del usuario, se corrigieron dos cosas relacionadas en `calculo.js` (pegado manualmente en el editor de Apps Script del Sheet, no hay acceso directo desde este repo):

1. **Hallazgo #3 (emparejamiento posicional gasto/cobro)**: la hoja `calculos` ahora tiene 3 bloques de columnas independientes en vez de forzar un gasto y un ingreso a compartir la misma fila:
   - `GASTOS` (A:F) — 1 fila = 1 gasto real de `cuentas`.
   - `INGRESOS` (H:K) — 1 fila = 1 ingreso real de `Data` (deduplicado por persona+mes, igual que antes).
   - `RESUMEN MENSUAL` (M:T) — 1 fila = 1 combinacion real de mes+año, con Saldo inicial/Entrada banco/Total ingresos/Total gastos/Saldo final/Diferencia (antes el mismo total se repetia en cada fila de gasto del mes).
   - Fila 1 = titulo de cada bloque, fila 2 = encabezados, datos desde fila 3. Checkbox de sync manual movido de `M2` a `V2`.
   - Si alguien edita a mano un encabezado del layout nuevo, el script ahora falla con un error claro en vez de arriesgarse a mezclar columnas.
   - Verificado con datos simulados y con los 105 gastos reales del Sheet (los totales por mes coincidieron exactamente con una suma manual independiente).

2. **Agrupamiento de totales por mes+año real** (no solo por nombre de mes como antes): un gasto de Enero 2025 y uno de Enero 2026 ya no se suman juntos en el mismo total — salen en filas separadas del Resumen Mensual. Como la hoja `Data` no tiene columna de año (solo "Mes"), el año de un ingreso se infiere de los años en que hubo gastos ese mismo mes; si es ambiguo, el script hace lo mejor posible y deja un aviso en el log de ejecucion de Apps Script (Ver > Registros) para revision manual. La forma exacta de eliminar esa ambiguedad seria agregar una columna "Año" a `Data` y al formulario de salario en Django — evaluado pero no aplicado, es un cambio de otro sistema, pendiente de decidir con el usuario.

3. **Bug de fechas ISO corregido en `toDate_`**: el formulario web guarda "Fecha de gasto" como texto `"YYYY-MM-DD"` (formato nativo de `<input type="date">`). Ese formato se interpreta como medianoche UTC por el motor de JS, lo que en la zona horaria de Ecuador (UTC-5) corria la fecha 5 horas hacia atras — un gasto del dia 1 de un mes se leia como el dia 31 del mes anterior. Se corrigio parseando ese formato a mano en hora local. Esto tambien resuelve en la practica el hallazgo #5 (zona horaria de Apps Script) para este caso especifico.

Migracion: como el layout de columnas cambio de posicion una vez (el 2026-09-01, al pasar del layout viejo de 1 bloque al de 3 bloques), hizo falta borrar el contenido de `calculos` una sola vez antes de pegar esa version. Actualizaciones posteriores al mismo layout de 3 bloques (como el fix de fechas y el agrupamiento por año) no requieren volver a borrar la hoja.

## Deploy a produccion (2026-09-02)
Commit `82e660a` pusheado a `main` (github.com/dav-ocan/contabilidad). Primer intento de deploy en Render **fallo**: el build fue exitoso (confirma que el fix de `django-environ` funciono), pero el arranque fallo con `ModuleNotFoundError: No module named 'capig_form'`. Causa: **Render tiene el Start Command escrito directamente en su dashboard (Settings > Build & Deploy > Start Command), no lee el `Procfile`** — seguia diciendo `gunicorn capig_form.wsgi --workers=3 --timeout=90`. Render preservo la version anterior corriendo mientras tanto (sin downtime). El usuario cambio manualmente el Start Command a `gunicorn finanzas_abaoca.wsgi --workers=3 --timeout=90` en el dashboard. **Redeploy confirmado exitoso** — verificado en vivo:
- `/` → 200
- `/registrar-afiliado/` → 200, con el campo `cuota_mensual` ya numerico (confirma que es la version nueva, no la cacheada)
- `/actualizar-salario/` → 200
- `/api/cedula/?persona=Lorena` → conecta bien al Sheet real (devuelve vacio porque `Data` sigue sin filas, no es error)

**IMPORTANTE para futuros cambios que requieran renombrar algo en el arranque de la app (modulo wsgi, nombre de paquete, etc.):** el `Procfile` de este repo NO es la fuente de verdad para Render — hay que cambiar tambien el Start Command manualmente en el dashboard de Render, o el deploy fallara igual que esta vez.

## Hallazgo pendiente (no relacionado a los cambios de hoy): `/health/` devuelve 404
`nixpacks.toml` configura un healthcheck de Render en `/health/` cada 30s, pero esa ruta nunca existio en el codigo Django (no hay vista ni URL para ella). Verificado en vivo: `curl https://contabilidad-ezwy.onrender.com/health/` → 404. No ha tumbado el servicio, pero Render probablemente lo reporta como "unhealthy" en su monitoreo. Fix propuesto (trivial, sin riesgo, no toca Sheets): agregar una vista que devuelva 200 en esa ruta. **PENDIENTE — se le pregunto al usuario si lo agrego, no ha respondido todavia.**

## Pendientes abiertos (actualizado 2026-09-01)
- Hallazgo #3 (emparejamiento posicional gasto/cobro en `calculos`): **CORREGIDO el 2026-09-01** — ver "Rediseño de `calculos`".
- Zona horaria de Apps Script: el riesgo concreto que motivaba este pendiente (fechas del dia 1 corriendose de mes) **quedo corregido el 2026-09-01** — ver "Rediseño de `calculos`".
- Ambiguedad de año en ingresos de `Data` (no tiene columna "Año"): mitigado con una heuristica + aviso en el log (ver "Rediseño de `calculos`"), pero la solucion exacta (agregar columna "Año" a `Data` y al formulario Django) sigue **pendiente de decidir con el usuario**.
- Endpoint `/health/` faltante: **se le pregunto al usuario si agregarlo, no ha respondido.**
- Propuesta de reordenar encabezados de `cuentas` (ver seccion arriba): **no aprobada todavia, no aplicada.**
- `Data` sigue vacia: sin confirmar con el usuario si es intencional o si falta probar el formulario de salario con una escritura real. El usuario planea probar el formulario de gasto (`registrar-afiliado`) pronto para confirmar que `calculo.js` lo toma bien.

## Nota sobre reordenar columnas/encabezados en los Sheets
Tanto el codigo Python (`afiliacion_handler.py`, via `_normalize()` + listas de alias) como el Apps Script (`calculo.js`, via `findHeaderIndex_`) leen y escriben **por nombre de encabezado**, no por posicion fija de columna. Mover una columna completa (encabezado + su data) a otra posicion en `cuentas`, `Data` o `calculos` es seguro siempre que: (a) se mueva el encabezado junto con toda su columna de datos (un "mover columna" normal de Sheets ya hace esto), y (b) el texto del encabezado siga coincidiendo con alguno de los alias reconocidos en el codigo (ej. "Categoria de gasto" tambien acepta "Categoria gasto"; revisar `ALT_ID_KEYS`/alias en `_build_fila` y los arrays de `findHeaderIndex_` en `calculo.js` para ver que variantes de nombre estan cubiertas antes de renombrar a algo distinto).
