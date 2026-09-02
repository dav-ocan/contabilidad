/**
 * Sincroniza "cuentas" + "Data" hacia "calculos", en 3 bloques separados
 * (ya no se fuerza un gasto y un ingreso a compartir la misma fila):
 *
 *   GASTOS (A:F)          - 1 fila = 1 gasto real de "cuentas"
 *   INGRESOS (H:K)        - 1 fila = 1 ingreso real de "Data" (ya deduplicado
 *                            por persona+mes, igual que antes)
 *   RESUMEN MENSUAL (M:T) - 1 fila = 1 mes, con los totales (antes se
 *                            repetia el mismo total en cada fila de gasto)
 *
 * Fila 1 = titulo de cada bloque. Fila 2 = encabezados. Datos desde fila 3.
 * Checkbox en V2: YA NO controla si se sincroniza o no (ver actualizacion
 * 2026-09-02) - ahora es solo un boton de "sincronizar ya".
 *
 * Actualizacion 2026-09-02: el sync automatico (trigger de tiempo, cada
 * minuto) ya NO depende del checkbox - antes, como el script apagaba el
 * checkbox al terminar cada corrida exitosa (para dar feedback visual),
 * el siguiente trigger de tiempo se encontraba el checkbox en FALSE y se
 * saltaba la sincronizacion, dejando "calculos" desactualizado hasta que
 * alguien lo marcara a mano de nuevo. Ahora syncCuentasToCalculos() SIEMPRE
 * sincroniza cuando se le llama (por el trigger de tiempo o manualmente);
 * el checkbox se mantiene solo como atajo para forzar un sync inmediato en
 * vez de esperar hasta el proximo minuto (ver onEdit(e) mas abajo - un
 * "simple trigger" que Apps Script activa solo con la marca de un checkbox,
 * no requiere instalarlo aparte). Los gastos que llegan por la API de
 * Django (no por edicion manual en el Sheet) NO disparan onEdit, por eso
 * el trigger de tiempo sigue siendo necesario para que la sincronizacion
 * sea automatica de verdad - ver crearTriggerSyncCalculos().
 *
 * Actualizacion 2026-09-01: los totales ahora agrupan por mes+año real (no
 * solo por nombre de mes) - ver la nota mas abajo. El layout de columnas
 * (A:F, H:K, M:T, V) NO cambio respecto a la version anterior, asi que
 * esta actualizacion se puede pegar encima sin volver a borrar "calculos".
 *
 * NOTA sobre "Mes" y "Año" en RESUMEN MENSUAL: los totales se agrupan por
 * MES + AÑO real (tomado de "Fecha de gasto" en "cuentas"), asi que un
 * gasto de Enero 2025 y uno de Enero 2026 ya NO se suman juntos - salen en
 * filas separadas ("Enero 2025", "Enero 2026").
 *
 * NOTA sobre el año de los ingresos ("Data"): esa hoja solo tiene columna
 * "Mes", no "Año", asi que el script no puede saber con certeza a que año
 * pertenece un ingreso. Para ubicarlo en la fila correcta del Resumen,
 * usa este criterio: si ese nombre de mes solo tiene gastos en UN año, usa
 * ese año (caso normal, sin ambiguedad). Si tiene gastos en varios años a
 * la vez, o no tiene ningun gasto ese mes, el script hace lo mejor posible
 * (año mas reciente, o el año actual) y deja un aviso en el log de
 * ejecucion de Apps Script (Ver > Registros) para que se revise a mano.
 * La forma 100% exacta de arreglar esto de raiz es agregar una columna
 * "Año" en "Data" (y al formulario de salario en Django) - no se hizo
 * porque es un cambio de otro sistema, pendiente de decidir con el
 * usuario.
 *
 * Este script no vive en este repo (Django no lo ejecuta) - vive dentro del
 * Google Sheet "DESARROLLO GASTOS", en Extensiones > Apps Script. Este
 * archivo es solo una copia de referencia para verlo comodo en VS Code; la
 * version que realmente corre es la que esta pegada en el editor de Apps
 * Script del Sheet.
 */

var GASTOS_COL = 1; // A
var GASTOS_HEADERS = ["Fecha de gasto", "Mes", "Año", "Categoría de gasto", "Subcategoría", "Monto categoria"];
var GASTOS_TITLE = "GASTOS";

var INGRESOS_COL = 8; // H
var INGRESOS_HEADERS = ["Mes", "Persona", "Tipo Cobros", "Cobros monto"];
var INGRESOS_TITLE = "INGRESOS";

var RESUMEN_COL = 13; // M
var RESUMEN_HEADERS = ["Mes", "Año", "Saldo inicial", "Entrada banco", "Total ingresos", "Total gastos", "Saldo final", "Diferencia"];
var RESUMEN_TITLE = "RESUMEN MENSUAL";

var CHECKBOX_COL = 22; // V
var CHECKBOX_CELL = "V2";

var TITLE_ROW = 1;
var HEADER_ROW = 2;
var DATA_START_ROW = 3;

var MONTH_ORDER = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function syncCuentasToCalculos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var src = ss.getSheetByName("cuentas");
  var dataSheet = ss.getSheetByName("Data");
  var dst = ss.getSheetByName("calculos");

  if (!src) throw new Error("No existe la hoja 'cuentas'.");
  if (!dataSheet) throw new Error("No existe la hoja 'Data'.");
  if (!dst) throw new Error("No existe la hoja 'calculos'.");

  var success = false;
  try {
    ss.toast("Actualizando calculos...", "Calculos", 5);

    var cuentasData = src.getDataRange().getValues();
    if (!cuentasData.length) return;

    var srcHeaders = cuentasData[0];
    var srcIdxCategoria = findHeaderIndex_(srcHeaders, [
      "Categoría de gasto",
      "Categoria de gasto",
      "Categoria gasto",
    ]);
    var srcIdxSubcategoria = findHeaderIndex_(srcHeaders, [
      "Subcategoría",
      "Subcategoria",
    ]);
    var srcIdxMonto = findHeaderIndex_(srcHeaders, ["Monto"]);
    var srcIdxFechaGasto = findHeaderIndex_(srcHeaders, [
      "Fecha de gasto",
      "Fecha gasto",
      "Fecha de gastos",
    ]);

    if (srcIdxCategoria === -1) throw new Error("Falta encabezado 'Categoría de gasto' en 'cuentas'.");
    if (srcIdxSubcategoria === -1) throw new Error("Falta encabezado 'Subcategoría' en 'cuentas'.");
    if (srcIdxMonto === -1) throw new Error("Falta encabezado 'Monto' en 'cuentas'.");
    if (srcIdxFechaGasto === -1) throw new Error("Falta encabezado 'Fecha de gasto' en 'cuentas'.");

    var dataData = dataSheet.getDataRange().getValues();
    if (!dataData.length) throw new Error("La hoja 'Data' no tiene encabezados.");

    var dataHeaders = dataData[0];
    var srcIdxSaldoInicial = findHeaderIndex_(dataHeaders, [
      "Saldo inicial",
      "Saldo inicial (opcional)",
    ]);
    var srcIdxEntradaBanco = findHeaderIndex_(dataHeaders, [
      "Entrada banco",
      "Entrada banco (opcional)",
    ]);
    var srcIdxSalario = findHeaderIndex_(dataHeaders, ["Salario", "SALARIO"]);
    var srcIdxTrabajo1 = findHeaderIndex_(dataHeaders, [
      "Trabajo 1",
      "Trabajo_1",
      "TRABAJO 1",
      "TRABAJO_1",
    ]);
    var srcIdxTrabajo2 = findHeaderIndex_(dataHeaders, [
      "Trabajo 2",
      "Trabajo_2",
      "TRABAJO 2",
      "TRABAJO_2",
    ]);
    var srcIdxDataMes = findHeaderIndex_(dataHeaders, ["Mes", "MES"]);
    var srcIdxPersona = findHeaderIndex_(dataHeaders, ["Persona", "PERSONA"]);

    if (srcIdxSaldoInicial === -1) throw new Error("Falta encabezado 'Saldo inicial' en 'Data'.");
    if (srcIdxEntradaBanco === -1) throw new Error("Falta encabezado 'Entrada banco' en 'Data'.");
    if (srcIdxSalario === -1) throw new Error("Falta encabezado 'Salario' en 'Data'.");
    if (srcIdxTrabajo1 === -1) throw new Error("Falta encabezado 'Trabajo 1' en 'Data'.");
    if (srcIdxTrabajo2 === -1) throw new Error("Falta encabezado 'Trabajo 2' en 'Data'.");
    if (srcIdxDataMes === -1) throw new Error("Falta encabezado 'Mes' en 'Data'.");
    if (srcIdxPersona === -1) throw new Error("Falta encabezado 'Persona' en 'Data'.");

    setupCalculosLayout_(dst);

    // ---- Bloque GASTOS ----
    var monthTotals = {};
    // Para cada nombre de mes, en que año(s) hubo gastos y cuantas filas -
    // se usa para ubicar los ingresos de "Data" (que no tienen año propio)
    // en el año correcto cuando no hay ambiguedad.
    var yearsByMonth = {};
    var rows = cuentasData.slice(1);
    var rowCount = rows.length;

    var valuesFecha = [];
    var valuesMes = [];
    var valuesAno = [];
    var valuesCategoria = [];
    var valuesSubcategoria = [];
    var valuesMonto = [];

    rows.forEach(function(row) {
      var fechaValue = row[srcIdxFechaGasto] || "";
      var parts = extractDateParts_(fechaValue);
      valuesFecha.push([fechaValue]);
      valuesMes.push([parts.mes]);
      valuesAno.push([parts.ano]);
      valuesCategoria.push([row[srcIdxCategoria] || ""]);
      valuesSubcategoria.push([row[srcIdxSubcategoria] || ""]);
      valuesMonto.push([row[srcIdxMonto] || ""]);

      var monthKey = monthKeyFromValue_(parts.mes);
      if (monthKey && parts.ano) {
        var totals = getMonthTotals_(monthTotals, yearMonthKey_(parts.ano, monthKey));
        totals.montoGasto += parseAmount_(row[srcIdxMonto]);

        if (!yearsByMonth[monthKey]) yearsByMonth[monthKey] = {};
        yearsByMonth[monthKey][parts.ano] = (yearsByMonth[monthKey][parts.ano] || 0) + 1;
      }
    });

    writeColumn_(dst, GASTOS_COL + 0, valuesFecha, rowCount);
    writeColumn_(dst, GASTOS_COL + 1, valuesMes, rowCount);
    writeColumn_(dst, GASTOS_COL + 2, valuesAno, rowCount);
    writeColumn_(dst, GASTOS_COL + 3, valuesCategoria, rowCount);
    writeColumn_(dst, GASTOS_COL + 4, valuesSubcategoria, rowCount);
    writeColumn_(dst, GASTOS_COL + 5, valuesMonto, rowCount);

    // ---- Bloque INGRESOS ----
    // "Saldo inicial" y "Entrada banco" son un valor del MES (no por
    // persona): si aparecen en mas de una fila del mismo mes, se usa el
    // valor MAS RECIENTE, nunca se suman.
    //
    // "Trabajo 1", "Trabajo 2" y "Salario" SI son por persona: si la MISMA
    // persona reenvia el formulario para el mismo mes (ej. corrigio su
    // sueldo), la fila mas reciente de esa persona+mes reemplaza a la
    // anterior en vez de sumarse encima. Distintas personas SI se suman
    // entre si (Lorena + Julio = ingreso total del hogar).
    var dataRows = dataData.slice(1);
    var latestByPersonaMonth = {};

    dataRows.forEach(function(row, rowIndex) {
      var monthKey = monthKeyFromValue_(row[srcIdxDataMes]);
      if (!monthKey) return;

      var ano = resolveAnoParaMes_(monthKey, yearsByMonth);
      var ymKey = yearMonthKey_(ano, monthKey);
      var totals = getMonthTotals_(monthTotals, ymKey);

      var saldoInicialAmount = parseAmount_(row[srcIdxSaldoInicial]);
      if (saldoInicialAmount) {
        if (totals.saldoInicial && totals.saldoInicial !== saldoInicialAmount) {
          Logger.log("Aviso: 'Saldo inicial' de " + monthKey + " " + ano + " cambio de " + totals.saldoInicial + " a " + saldoInicialAmount + " (se uso el valor mas reciente).");
        }
        totals.saldoInicial = saldoInicialAmount;
      }

      var entradaBancoAmount = parseAmount_(row[srcIdxEntradaBanco]);
      if (entradaBancoAmount) {
        if (totals.entradaBanco && totals.entradaBanco !== entradaBancoAmount) {
          Logger.log("Aviso: 'Entrada banco' de " + monthKey + " " + ano + " cambio de " + totals.entradaBanco + " a " + entradaBancoAmount + " (se uso el valor mas reciente).");
        }
        totals.entradaBanco = entradaBancoAmount;
      }

      var personaRaw = row[srcIdxPersona] || "";
      var personaKey = normalizeHeader_(personaRaw);
      var mapKey = personaKey ? (personaKey + "|" + ymKey) : ("__fila" + rowIndex);
      latestByPersonaMonth[mapKey] = {
        ymKey: ymKey,
        monthKey: monthKey,
        persona: personaRaw,
        trabajo1: row[srcIdxTrabajo1],
        trabajo2: row[srcIdxTrabajo2],
        salario: row[srcIdxSalario],
      };
    });

    var ingresoRows = [];
    Object.keys(latestByPersonaMonth).forEach(function(mapKey) {
      var entryData = latestByPersonaMonth[mapKey];
      var totals = getMonthTotals_(monthTotals, entryData.ymKey);
      var cobros = collectCobros_(entryData.trabajo1, entryData.trabajo2, entryData.salario);

      cobros.forEach(function(cobro) {
        totals.cobrosMonto += parseAmount_(cobro.monto);
        ingresoRows.push({
          mes: capitalize_(entryData.monthKey),
          persona: entryData.persona,
          tipo: cobro.tipo,
          monto: cobro.monto,
        });
      });
    });

    var ingresoRowCount = ingresoRows.length;
    writeColumn_(dst, INGRESOS_COL + 0, ingresoRows.map(function(r) { return [r.mes]; }), ingresoRowCount);
    writeColumn_(dst, INGRESOS_COL + 1, ingresoRows.map(function(r) { return [r.persona]; }), ingresoRowCount);
    writeColumn_(dst, INGRESOS_COL + 2, ingresoRows.map(function(r) { return [r.tipo]; }), ingresoRowCount);
    writeColumn_(dst, INGRESOS_COL + 3, ingresoRows.map(function(r) { return [r.monto]; }), ingresoRowCount);

    // ---- Bloque RESUMEN MENSUAL ----
    // Una fila por combinacion real de mes+año (ordenadas por año y luego
    // por orden de calendario), no una fila fija por cada uno de los 12
    // nombres de mes como antes.
    var resumenKeys = Object.keys(monthTotals).filter(function(ymKey) {
      var totals = monthTotals[ymKey];
      return totals.saldoInicial || totals.cobrosMonto || totals.montoGasto || totals.entradaBanco;
    });
    resumenKeys.sort(function(a, b) {
      var pa = parseYearMonthKey_(a);
      var pb = parseYearMonthKey_(b);
      if (pa.ano !== pb.ano) return pa.ano - pb.ano;
      return MONTH_ORDER.indexOf(pa.monthKey) - MONTH_ORDER.indexOf(pb.monthKey);
    });

    var resumenRows = resumenKeys.map(function(ymKey) {
      var parsed = parseYearMonthKey_(ymKey);
      var totals = monthTotals[ymKey];
      var saldoFinalNum = totals.saldoInicial + totals.cobrosMonto - totals.montoGasto;
      var diferenciaNum = saldoFinalNum - totals.entradaBanco;

      return {
        mes: capitalize_(parsed.monthKey),
        ano: parsed.ano,
        saldoInicial: totals.saldoInicial ? formatAmountNumber_(totals.saldoInicial) : "",
        entradaBanco: totals.entradaBanco ? formatAmountNumber_(totals.entradaBanco) : "",
        totalIngresos: formatAmountNumber_(totals.cobrosMonto),
        totalGastos: formatAmountNumber_(totals.montoGasto),
        saldoFinal: formatAmountNumber_(saldoFinalNum),
        diferencia: formatAmountNumber_(diferenciaNum),
      };
    });

    var resumenRowCount = resumenRows.length;
    writeColumn_(dst, RESUMEN_COL + 0, resumenRows.map(function(r) { return [r.mes]; }), resumenRowCount);
    writeColumn_(dst, RESUMEN_COL + 1, resumenRows.map(function(r) { return [r.ano]; }), resumenRowCount);
    writeColumn_(dst, RESUMEN_COL + 2, resumenRows.map(function(r) { return [r.saldoInicial]; }), resumenRowCount);
    writeColumn_(dst, RESUMEN_COL + 3, resumenRows.map(function(r) { return [r.entradaBanco]; }), resumenRowCount);
    writeColumn_(dst, RESUMEN_COL + 4, resumenRows.map(function(r) { return [r.totalIngresos]; }), resumenRowCount);
    writeColumn_(dst, RESUMEN_COL + 5, resumenRows.map(function(r) { return [r.totalGastos]; }), resumenRowCount);
    writeColumn_(dst, RESUMEN_COL + 6, resumenRows.map(function(r) { return [r.saldoFinal]; }), resumenRowCount);
    writeColumn_(dst, RESUMEN_COL + 7, resumenRows.map(function(r) { return [r.diferencia]; }), resumenRowCount);

    success = true;
  } catch (error) {
    ss.toast("Error: " + (error && error.message ? error.message : error), "Calculos", 8);
    throw error;
  } finally {
    if (success) {
      dst.getRange(CHECKBOX_CELL).setValue(false);
      ss.toast("Actualizacion lista", "Calculos", 4);
    }
  }
}

/**
 * Ejecutar esta funcion UNA VEZ a mano (boton "Ejecutar" en el editor de
 * Apps Script) para instalar el trigger automatico. Solo tener la funcion
 * escrita no crea el trigger - hay que correrla explicitamente, y aceptar
 * los permisos que pida Google la primera vez. Se puede volver a correr
 * sin problema (borra el trigger viejo antes de crear el nuevo, para
 * nunca dejar dos corriendo a la vez).
 */
function crearTriggerSyncCalculos() {
  var triggers = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === "syncCuentasToCalculos";
  });
  triggers.forEach(function(t) {
    ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger("syncCuentasToCalculos")
    .timeBased()
    .everyMinutes(1)
    .create();
}

/**
 * "Simple trigger" - Apps Script lo activa solo con que exista esta funcion
 * llamada exactamente "onEdit", sin necesidad de instalarlo en el icono del
 * reloj. Solo reacciona a ediciones manuales hechas por una persona en la
 * interfaz del Sheet (marcar el checkbox) - las filas que llegan por la API
 * de Django NO pasan por aqui, para eso esta el trigger de tiempo de
 * crearTriggerSyncCalculos(). Sirve como boton de "sincronizar ya".
 */
function onEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== "calculos") return;
  if (e.range.getA1Notation() !== CHECKBOX_CELL) return;
  if (e.range.getValue() !== true) return;
  syncCuentasToCalculos();
}

/* Helpers de layout (bloques de calculos) */

function setupCalculosLayout_(dst) {
  writeBlockHeader_(dst, GASTOS_COL, GASTOS_TITLE, GASTOS_HEADERS);
  writeBlockHeader_(dst, INGRESOS_COL, INGRESOS_TITLE, INGRESOS_HEADERS);
  writeBlockHeader_(dst, RESUMEN_COL, RESUMEN_TITLE, RESUMEN_HEADERS);

  var checkboxLabelCell = dst.getRange(TITLE_ROW, CHECKBOX_COL);
  if (!checkboxLabelCell.getValue()) {
    checkboxLabelCell.setValue("Actualizar");
    checkboxLabelCell.setFontWeight("bold");
  }
  var checkboxCell = dst.getRange(HEADER_ROW, CHECKBOX_COL);
  if (checkboxCell.getValue() === "") {
    checkboxCell.insertCheckboxes();
  }
}

// Escribe el titulo (fila 1) y los encabezados (fila 2) de un bloque. Si ya
// hay texto ahi y no coincide con lo esperado, falla en vez de sobrescribir
// en silencio (para no arriesgar mezclar columnas si alguien movio algo a
// mano en el Sheet).
function writeBlockHeader_(sheet, startCol, title, headers) {
  var titleCell = sheet.getRange(TITLE_ROW, startCol);
  var currentTitle = String(titleCell.getValue() || "").trim();
  if (currentTitle && currentTitle !== title) {
    throw new Error("La hoja 'calculos' tiene '" + currentTitle + "' en " + columnLetter_(startCol) + "1, se esperaba '" + title + "'. Revisa el layout antes de sincronizar (puede que alguien haya movido o editado las columnas a mano).");
  }
  titleCell.setValue(title);
  titleCell.setFontWeight("bold");

  for (var i = 0; i < headers.length; i++) {
    var cell = sheet.getRange(HEADER_ROW, startCol + i);
    var currentHeader = String(cell.getValue() || "").trim();
    var expected = headers[i];
    if (currentHeader && normalizeHeader_(currentHeader) !== normalizeHeader_(expected)) {
      throw new Error("La hoja 'calculos' tiene '" + currentHeader + "' en " + columnLetter_(startCol + i) + "2, se esperaba '" + expected + "'. Revisa el layout antes de sincronizar.");
    }
    cell.setValue(expected);
    cell.setFontWeight("bold");
  }
}

function columnLetter_(col) {
  var letter = "";
  while (col > 0) {
    var rem = (col - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
}

/* Helpers generales */

function normalizeHeader_(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

function findHeaderIndex_(headers, candidates) {
  var normalized = headers.map(normalizeHeader_);
  for (var i = 0; i < candidates.length; i++) {
    var target = normalizeHeader_(candidates[i]);
    var idx = normalized.indexOf(target);
    if (idx !== -1) return idx;
  }
  return -1;
}

function monthKeyFromValue_(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    var num = Math.round(value);
    if (num >= 1 && num <= 12) return MONTH_ORDER[num - 1];
  }

  var text = normalizeHeader_(value);
  if (!text) return "";

  var parsed = parseInt(text, 10);
  if (!isNaN(parsed) && parsed >= 1 && parsed <= 12) return MONTH_ORDER[parsed - 1];

  for (var i = 0; i < MONTH_ORDER.length; i++) {
    if (text.indexOf(MONTH_ORDER[i]) !== -1) return MONTH_ORDER[i];
  }
  return "";
}

// Clave compuesta "año|mes" para agrupar totales por mes REAL (no solo por
// nombre de mes) - ej. yearMonthKey_(2026, "enero") -> "2026|enero".
function yearMonthKey_(ano, monthKey) {
  return String(ano) + "|" + monthKey;
}

function parseYearMonthKey_(ymKey) {
  var idx = ymKey.indexOf("|");
  return {
    ano: Number(ymKey.slice(0, idx)),
    monthKey: ymKey.slice(idx + 1),
  };
}

// "Data" no tiene columna de año, solo "Mes". Para saber a que año
// pertenece un ingreso, se apoya en los años en que SI hubo gastos ese
// mismo mes (segun "cuentas"): si hay exactamente un año, no hay
// ambiguedad. Si hay varios o ninguno, hace lo mejor posible y avisa en
// el log para revision manual.
function resolveAnoParaMes_(monthKey, yearsByMonth) {
  var years = Object.keys(yearsByMonth[monthKey] || {}).map(Number);

  if (years.length === 1) {
    return years[0];
  }

  if (years.length === 0) {
    var current = new Date().getFullYear();
    Logger.log("Aviso: no hay gastos de '" + monthKey + "' en 'cuentas' para saber a que año pertenece un ingreso de 'Data' de ese mes; se asumio el año actual (" + current + "). Si no es correcto, agrega una columna 'Año' en 'Data'.");
    return current;
  }

  var masReciente = Math.max.apply(null, years);
  Logger.log("Aviso: '" + monthKey + "' tiene gastos en varios años (" + years.join(", ") + ") y 'Data' no dice a cual pertenece un ingreso de ese mes; se asigno al mas reciente (" + masReciente + "). Revisa a mano si corresponde a otro año, o agrega una columna 'Año' en 'Data' para que esto no vuelva a pasar.");
  return masReciente;
}

function getMonthTotals_(monthTotals, monthKey) {
  if (!monthTotals[monthKey]) {
    monthTotals[monthKey] = {
      saldoInicial: 0,
      entradaBanco: 0,
      cobrosMonto: 0,
      montoGasto: 0,
    };
  }
  return monthTotals[monthKey];
}

function extractDateParts_(value) {
  var date = toDate_(value);
  if (!date) return { mes: "", ano: "" };
  var monthNames = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];
  var monthIndex = date.getMonth();
  var year = date.getFullYear();
  return { mes: monthNames[monthIndex] || "", ano: year || "" };
}

function toDate_(value) {
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    // Numero serial de Sheets (dias desde 1899-12-30). En la practica GAS
    // devuelve las celdas de fecha como objeto Date (rama de arriba), no
    // como numero, pero se calcula en LOCAL (no con Date.UTC) por si acaso,
    // para no arrastrar el mismo salto de dia que el caso ISO de abajo.
    var epoch = new Date(1899, 11, 30);
    return new Date(epoch.getFullYear(), epoch.getMonth(), epoch.getDate() + Math.round(value));
  }
  if (value == null) return null;
  var text = String(value).trim();
  if (!text) return null;

  // "YYYY-MM-DD" (ISO, sin hora) - lo guarda asi el formulario web (input
  // type="date") - se interpreta como medianoche UTC por el motor de JS,
  // lo que en la zona horaria de Ecuador (UTC-5) la corre 5 horas hacia
  // atras: el dia 1 de un mes se leeria como el dia 31 del mes anterior.
  // Se parsea a mano en hora LOCAL para evitar ese salto de mes/año.
  var isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    var localDate = new Date(
      parseInt(isoMatch[1], 10),
      parseInt(isoMatch[2], 10) - 1,
      parseInt(isoMatch[3], 10)
    );
    return isNaN(localDate.getTime()) ? null : localDate;
  }

  var parsed = new Date(text);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function parseAmount_(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return value;

  var text = String(value).trim();
  if (!text) return 0;

  text = text.replace(/\s+/g, "").replace(/\$/g, "");
  if (text.indexOf(",") !== -1 && text.indexOf(".") !== -1) {
    if (text.lastIndexOf(",") > text.lastIndexOf(".")) {
      text = text.replace(/\./g, "").replace(",", ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (text.indexOf(",") !== -1) {
    var parts = text.split(",");
    if (parts[parts.length - 1].length <= 2) {
      text = parts.join(".");
    } else {
      text = parts.join("");
    }
  }

  var amount = parseFloat(text);
  return isNaN(amount) ? 0 : amount;
}

function hasAmount_(value) {
  return parseAmount_(value) > 0;
}

function formatAmountNumber_(value) {
  if (typeof value !== "number" || isNaN(value)) return "";
  var sign = value < 0 ? "-" : "";
  var absValue = Math.abs(value);
  var fixed = absValue.toFixed(2);
  var withCommas = fixed.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return sign + "$" + withCommas;
}

function collectCobros_(trabajo1, trabajo2, salario) {
  var cobros = [];
  if (hasAmount_(trabajo1)) cobros.push({ tipo: "Trabajo 1", monto: trabajo1 });
  if (hasAmount_(trabajo2)) cobros.push({ tipo: "Trabajo 2", monto: trabajo2 });
  if (hasAmount_(salario)) cobros.push({ tipo: "Salario", monto: salario });
  return cobros;
}

function capitalize_(text) {
  var value = String(text || "");
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function writeColumn_(sheet, colIndex, values, rowCount) {
  var lastRow = sheet.getLastRow();
  var existingDataRows = Math.max(lastRow - (DATA_START_ROW - 1), 0);
  var clearRows = Math.max(existingDataRows, rowCount);
  if (clearRows > 0) {
    sheet.getRange(DATA_START_ROW, colIndex, clearRows, 1).clearContent();
  }
  if (values.length) {
    sheet.getRange(DATA_START_ROW, colIndex, values.length, 1).setValues(values);
  }
}
