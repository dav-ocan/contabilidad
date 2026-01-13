/**
 * Sincroniza columnas desde "cuentas" hacia "calculos".
 * Origen: cuentas -> Categoria de gasto, Subcategoria, Monto, Fecha de gasto
 *         Data -> Saldo inicial, Entrada banco, Salario, Trabajo 1, Trabajo 2
 * Destino: Categoria de gasto, Subcategoria, Monto categoria,
 *          Fecha de gasto, Mes, A\u00f1o,
 *          Saldo inicial, Entrada banco, Tipo Cobros, Cobros monto
 *          Saldo final y Diferencia (totales por mes)
 */
function syncCuentasToCalculos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var src = ss.getSheetByName("cuentas");
  var dataSheet = ss.getSheetByName("Data");
  var dst = ss.getSheetByName("calculos");

  if (!src) throw new Error("No existe la hoja 'cuentas'.");
  if (!dataSheet) throw new Error("No existe la hoja 'Data'.");
  if (!dst) throw new Error("No existe la hoja 'calculos'.");

  var allowSync = readCheckboxFlag_(dst, "M2");
  if (allowSync === false) return;

  var success = false;
  try {
    ss.toast("Actualizando calculos...", "Calculos", 5);

    var cuentasData = src.getDataRange().getValues();
    if (!cuentasData.length) return;

  var srcHeaders = cuentasData[0];
  var srcIdxCategoria = findHeaderIndex_(srcHeaders, [
    "Categor\u00eda de gasto",
    "Categoria de gasto",
    "Categoria gasto",
  ]);
  var srcIdxSubcategoria = findHeaderIndex_(srcHeaders, [
    "Subcategor\u00eda",
    "Subcategoria",
  ]);
  var srcIdxMonto = findHeaderIndex_(srcHeaders, ["Monto"]);
  var srcIdxFechaGasto = findHeaderIndex_(srcHeaders, [
    "Fecha de gasto",
    "Fecha gasto",
    "Fecha de gastos",
  ]);

  if (srcIdxCategoria === -1) {
    throw new Error("Falta encabezado 'Categor\u00eda de gasto' en 'cuentas'.");
  }
  if (srcIdxSubcategoria === -1) {
    throw new Error("Falta encabezado 'Subcategor\u00eda' en 'cuentas'.");
  }
  if (srcIdxMonto === -1) {
    throw new Error("Falta encabezado 'Monto' en 'cuentas'.");
  }
  if (srcIdxFechaGasto === -1) {
    throw new Error("Falta encabezado 'Fecha de gasto' en 'cuentas'.");
  }

  var dataData = dataSheet.getDataRange().getValues();
  if (!dataData.length) {
    throw new Error("La hoja 'Data' no tiene encabezados.");
  }

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

  if (srcIdxSaldoInicial === -1) {
    throw new Error("Falta encabezado 'Saldo inicial' en 'Data'.");
  }
  if (srcIdxEntradaBanco === -1) {
    throw new Error("Falta encabezado 'Entrada banco' en 'Data'.");
  }
  if (srcIdxSalario === -1) {
    throw new Error("Falta encabezado 'Salario' en 'Data'.");
  }
  if (srcIdxTrabajo1 === -1) {
    throw new Error("Falta encabezado 'Trabajo 1' en 'Data'.");
  }
  if (srcIdxTrabajo2 === -1) {
    throw new Error("Falta encabezado 'Trabajo 2' en 'Data'.");
  }
  if (srcIdxDataMes === -1) {
    throw new Error("Falta encabezado 'Mes' en 'Data'.");
  }

  var headerRow = getHeaderRow_(dst);
  var updated = false;

  var destCategoria = ensureHeader_(headerRow, "Categor\u00eda de gasto");
  updated = updated || destCategoria.added;

  var destSubcategoria = ensureHeader_(headerRow, "Subcategor\u00eda");
  updated = updated || destSubcategoria.added;

  var destMonto = ensureHeaderFromCandidates_(headerRow, [
    "Monto categoria",
    "Monto categoria (Monto de cuentas)",
  ], "Monto categoria");
  updated = updated || destMonto.added;

  var destFechaGasto = ensureHeaderFromCandidates_(headerRow, [
    "Fecha de gasto",
    "Fecha gasto",
    "Fecha de gastos",
  ], "Fecha de gasto");
  updated = updated || destFechaGasto.added;

  var destMes = ensureHeaderFromCandidates_(headerRow, ["Mes", "MES"], "Mes");
  updated = updated || destMes.added;

  var destAno = ensureHeaderFromCandidates_(headerRow, [
    "A\u00f1o",
    "Ano",
    "ANO",
  ], "A\u00f1o");
  updated = updated || destAno.added;

  var destSaldoInicial = ensureHeaderFromCandidates_(headerRow, [
    "Saldo inicial",
    "Saldo inicial (opcional)",
  ], "Saldo inicial");
  updated = updated || destSaldoInicial.added;

  var destEntradaBanco = ensureHeaderFromCandidates_(headerRow, [
    "Entrada banco",
    "Entrada banco (opcional)",
  ], "Entrada banco");
  updated = updated || destEntradaBanco.added;

  var destTipoCobros = ensureHeaderFromCandidates_(headerRow, [
    "Tipo Cobros",
    "Tipo cobros",
    "Tipo de cobros",
  ], "Tipo Cobros");
  updated = updated || destTipoCobros.added;

  var destCobrosMonto = ensureHeaderFromCandidates_(headerRow, [
    "Cobros monto",
    "cobros monto",
    "Monto cobros",
  ], "Cobros monto");
  updated = updated || destCobrosMonto.added;

  var destSaldoFinal = ensureHeaderFromCandidates_(headerRow, [
    "Saldo final",
    "Saldo Final",
  ], "Saldo final");
  updated = updated || destSaldoFinal.added;

  var destDiferencia = ensureHeaderFromCandidates_(headerRow, [
    "Diferencia",
    "DIFERENCIA",
  ], "Diferencia");
  updated = updated || destDiferencia.added;

  if (updated) {
    dst.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
  }

  var monthTotals = {};
  var rows = cuentasData.slice(1);
  var rowCount = rows.length;

  var valuesCategoria = rows.map(function(row) {
    return [row[srcIdxCategoria] || ""];
  });
  var valuesSubcategoria = rows.map(function(row) {
    return [row[srcIdxSubcategoria] || ""];
  });
  var valuesMonto = rows.map(function(row) {
    return [row[srcIdxMonto] || ""];
  });
  var valuesFechaGasto = [];
  var valuesMes = [];
  var valuesAno = [];
  rows.forEach(function(row) {
    var fechaValue = row[srcIdxFechaGasto] || "";
    var parts = extractDateParts_(fechaValue);
    valuesFechaGasto.push([fechaValue]);
    valuesMes.push([parts.mes]);
    valuesAno.push([parts.ano]);

    var monthKey = monthKeyFromValue_(parts.mes);
    if (monthKey) {
      var totals = getMonthTotals_(monthTotals, monthKey);
      totals.montoCategoria += parseAmount_(row[srcIdxMonto]);
    }
  });

  writeColumn_(dst, destCategoria.index + 1, valuesCategoria, rowCount);
  writeColumn_(dst, destSubcategoria.index + 1, valuesSubcategoria, rowCount);
  writeColumn_(dst, destMonto.index + 1, valuesMonto, rowCount);
  writeColumn_(dst, destFechaGasto.index + 1, valuesFechaGasto, rowCount);
  writeColumn_(dst, destMes.index + 1, valuesMes, rowCount);
  writeColumn_(dst, destAno.index + 1, valuesAno, rowCount);

  var dataRows = dataData.slice(1);
  var dataRowCount = dataRows.length;
  var dataByMonth = {};
  dataRows.forEach(function(row) {
    var cobros = collectCobros_(
      row[srcIdxTrabajo1],
      row[srcIdxTrabajo2],
      row[srcIdxSalario]
    );

    var monthKey = monthKeyFromValue_(row[srcIdxDataMes]);
    if (monthKey) {
      var totals = getMonthTotals_(monthTotals, monthKey);
      totals.saldoInicial += parseAmount_(row[srcIdxSaldoInicial]);
      totals.entradaBanco += parseAmount_(row[srcIdxEntradaBanco]);

      var saldoInicialValue = row[srcIdxSaldoInicial] || "";
      var entradaBancoValue = row[srcIdxEntradaBanco] || "";

      if (!dataByMonth[monthKey]) {
        dataByMonth[monthKey] = [];
      }

      if (cobros.length) {
        cobros.forEach(function(cobro) {
          totals.cobrosMonto += parseAmount_(cobro.monto);
          dataByMonth[monthKey].push({
            saldoInicial: saldoInicialValue,
            entradaBanco: entradaBancoValue,
            tipoCobros: cobro.tipo,
            cobrosMonto: cobro.monto,
          });
        });
      } else {
        dataByMonth[monthKey].push({
          saldoInicial: saldoInicialValue,
          entradaBanco: entradaBancoValue,
          tipoCobros: "",
          cobrosMonto: "",
        });
      }
    }
  });

  var valuesSaldoInicial = [];
  var valuesEntradaBanco = [];
  var valuesTipoCobros = [];
  var valuesCobrosMonto = [];
  var dataCounters = {};

  for (var idx = 0; idx < rowCount; idx++) {
    var monthKey = monthKeyFromValue_(valuesMes[idx] ? valuesMes[idx][0] : "");
    var entry = null;
    if (monthKey && dataByMonth[monthKey]) {
      var used = dataCounters[monthKey] || 0;
      entry = dataByMonth[monthKey][used] || null;
      if (entry) {
        dataCounters[monthKey] = used + 1;
      }
    }

    if (entry) {
      valuesSaldoInicial.push([entry.saldoInicial]);
      valuesEntradaBanco.push([entry.entradaBanco]);
      valuesTipoCobros.push([entry.tipoCobros]);
      valuesCobrosMonto.push([entry.cobrosMonto]);
    } else {
      valuesSaldoInicial.push([""]);
      valuesEntradaBanco.push([""]);
      valuesTipoCobros.push([""]);
      valuesCobrosMonto.push([""]);
    }
  }

  writeColumn_(dst, destSaldoInicial.index + 1, valuesSaldoInicial, rowCount);
  writeColumn_(dst, destEntradaBanco.index + 1, valuesEntradaBanco, rowCount);
  writeColumn_(dst, destTipoCobros.index + 1, valuesTipoCobros, rowCount);
  writeColumn_(dst, destCobrosMonto.index + 1, valuesCobrosMonto, rowCount);

  var calcRowCount = rowCount || dataRowCount;
  var valuesSaldoFinal = [];
  var valuesDiferencia = [];
  for (var idx = 0; idx < calcRowCount; idx++) {
    var monthKey = "";
    if (idx < valuesMes.length) {
      monthKey = monthKeyFromValue_(valuesMes[idx][0]);
    }
    if (!monthKey && idx < dataRows.length) {
      monthKey = monthKeyFromValue_(dataRows[idx][srcIdxDataMes]);
    }

    var totalsForMonth = monthKey ? monthTotals[monthKey] : null;
    if (!totalsForMonth) {
      valuesSaldoFinal.push([""]);
      valuesDiferencia.push([""]);
      continue;
    }

    var hasAny = totalsForMonth.saldoInicial
      || totalsForMonth.cobrosMonto
      || totalsForMonth.montoCategoria
      || totalsForMonth.entradaBanco;
    if (!hasAny) {
      valuesSaldoFinal.push([""]);
      valuesDiferencia.push([""]);
      continue;
    }

    var saldoFinalNum = totalsForMonth.saldoInicial
      + totalsForMonth.cobrosMonto
      - totalsForMonth.montoCategoria;
    var diferenciaNum = saldoFinalNum - totalsForMonth.entradaBanco;

    valuesSaldoFinal.push([formatAmountNumber_(saldoFinalNum)]);
    valuesDiferencia.push([formatAmountNumber_(diferenciaNum)]);
  }

  writeColumn_(dst, destSaldoFinal.index + 1, valuesSaldoFinal, calcRowCount);
  writeColumn_(dst, destDiferencia.index + 1, valuesDiferencia, calcRowCount);

    success = true;
  } catch (error) {
    ss.toast("Error: " + (error && error.message ? error.message : error), "Calculos", 8);
    throw error;
  } finally {
    if (success) {
      dst.getRange("M2").setValue(false);
      ss.toast("Actualizacion lista", "Calculos", 4);
    }
  }
}

/** Opcional: crea un trigger cada 5 minutos. */
function crearTriggerSyncCalculos() {
  var triggers = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === "syncCuentasToCalculos";
  });
  triggers.forEach(function(t) {
    ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger("syncCuentasToCalculos")
    .timeBased()
    .everyMinutes(5)
    .create();
}

/* Helpers */

function normalizeHeader_(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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

function getHeaderRow_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0];
}

function ensureHeader_(headerRow, headerName) {
  var normalized = headerRow.map(normalizeHeader_);
  var target = normalizeHeader_(headerName);
  var idx = normalized.indexOf(target);
  if (idx === -1) {
    headerRow.push(headerName);
    return { index: headerRow.length - 1, added: true };
  }
  return { index: idx, added: false };
}

function ensureHeaderFromCandidates_(headerRow, candidates, defaultName) {
  var idx = findHeaderIndex_(headerRow, candidates);
  var added = false;
  if (idx === -1) {
    headerRow.push(defaultName);
    idx = headerRow.length - 1;
    added = true;
  }
  return { index: idx, added: added };
}

function readCheckboxFlag_(sheet, a1) {
  var value = sheet.getRange(a1).getValue();
  if (value === true || value === false) return value;
  var text = String(value || "").trim().toLowerCase();
  if (text === "false" || text === "falso" || text === "no") return false;
  if (text === "true" || text === "verdadero" || text === "si") return true;
  return true;
}

function monthKeyFromValue_(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    var num = Math.round(value);
    if (num >= 1 && num <= 12) {
      return [
        "enero",
        "febrero",
        "marzo",
        "abril",
        "mayo",
        "junio",
        "julio",
        "agosto",
        "septiembre",
        "octubre",
        "noviembre",
        "diciembre",
      ][num - 1];
    }
  }

  var text = normalizeHeader_(value);
  if (!text) return "";

  var parsed = parseInt(text, 10);
  if (!isNaN(parsed) && parsed >= 1 && parsed <= 12) {
    return [
      "enero",
      "febrero",
      "marzo",
      "abril",
      "mayo",
      "junio",
      "julio",
      "agosto",
      "septiembre",
      "octubre",
      "noviembre",
      "diciembre",
    ][parsed - 1];
  }

  var monthNames = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];
  for (var i = 0; i < monthNames.length; i++) {
    if (text.indexOf(monthNames[i]) !== -1) {
      return monthNames[i];
    }
  }
  return "";
}

function getMonthTotals_(monthTotals, monthKey) {
  if (!monthTotals[monthKey]) {
    monthTotals[monthKey] = {
      saldoInicial: 0,
      entradaBanco: 0,
      cobrosMonto: 0,
      montoCategoria: 0,
    };
  }
  return monthTotals[monthKey];
}

function extractDateParts_(value) {
  var date = toDate_(value);
  if (!date) return { mes: "", ano: "" };
  var monthNames = [
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
  ];
  var monthIndex = date.getMonth();
  var year = date.getFullYear();
  return { mes: monthNames[monthIndex] || "", ano: year || "" };
}

function toDate_(value) {
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    var millis = Date.UTC(1899, 11, 30) + value * 86400000;
    return new Date(millis);
  }
  if (value == null) return null;
  var text = String(value).trim();
  if (!text) return null;
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
  if (hasAmount_(trabajo1)) {
    cobros.push({ tipo: "Trabajo 1", monto: trabajo1 });
  }
  if (hasAmount_(trabajo2)) {
    cobros.push({ tipo: "Trabajo 2", monto: trabajo2 });
  }
  if (hasAmount_(salario)) {
    cobros.push({ tipo: "Salario", monto: salario });
  }
  return cobros;
}

function pickCobro_(trabajo1, trabajo2, salario) {
  if (hasAmount_(trabajo1)) {
    return { tipo: "Trabajo 1", monto: trabajo1 };
  }
  if (hasAmount_(trabajo2)) {
    return { tipo: "Trabajo 2", monto: trabajo2 };
  }
  if (hasAmount_(salario)) {
    return { tipo: "Salario", monto: salario };
  }
  return { tipo: "", monto: "" };
}

function writeColumn_(sheet, colIndex, values, rowCount) {
  var lastRow = sheet.getLastRow();
  var clearRows = Math.max(lastRow - 1, rowCount);
  if (clearRows > 0) {
    sheet.getRange(2, colIndex, clearRows, 1).clearContent();
  }
  if (values.length) {
    sheet.getRange(2, colIndex, values.length, 1).setValues(values);
  }
}
