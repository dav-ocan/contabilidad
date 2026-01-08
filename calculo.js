/**
 * Sincroniza columnas desde "cuentas" hacia "calculos".
 * Origen: cuentas -> Categoria de gasto, Subcategoria, Monto
 *         Data -> Saldo inicial, Entrada banco, Salario, Trabajo 1, Trabajo 2
 * Destino: Categoria de gasto, Subcategoria, Monto categoria,
 *          Saldo inicial, Entrada banco, Tipo Cobros, Cobros monto
 */
function syncCuentasToCalculos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var src = ss.getSheetByName("cuentas");
  var dataSheet = ss.getSheetByName("Data");
  var dst = ss.getSheetByName("calculos");

  if (!src) throw new Error("No existe la hoja 'cuentas'.");
  if (!dataSheet) throw new Error("No existe la hoja 'Data'.");
  if (!dst) throw new Error("No existe la hoja 'calculos'.");

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

  if (srcIdxCategoria === -1) {
    throw new Error("Falta encabezado 'Categor\u00eda de gasto' en 'cuentas'.");
  }
  if (srcIdxSubcategoria === -1) {
    throw new Error("Falta encabezado 'Subcategor\u00eda' en 'cuentas'.");
  }
  if (srcIdxMonto === -1) {
    throw new Error("Falta encabezado 'Monto' en 'cuentas'.");
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

  if (updated) {
    dst.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
  }

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

  writeColumn_(dst, destCategoria.index + 1, valuesCategoria, rowCount);
  writeColumn_(dst, destSubcategoria.index + 1, valuesSubcategoria, rowCount);
  writeColumn_(dst, destMonto.index + 1, valuesMonto, rowCount);

  var dataRows = dataData.slice(1);
  var dataRowCount = dataRows.length;
  var valuesSaldoInicial = dataRows.map(function(row) {
    return [row[srcIdxSaldoInicial] || ""];
  });
  var valuesEntradaBanco = dataRows.map(function(row) {
    return [row[srcIdxEntradaBanco] || ""];
  });

  writeColumn_(dst, destSaldoInicial.index + 1, valuesSaldoInicial, dataRowCount);
  writeColumn_(dst, destEntradaBanco.index + 1, valuesEntradaBanco, dataRowCount);

  var valuesTipoCobros = [];
  var valuesCobrosMonto = [];
  dataRows.forEach(function(row) {
    var pick = pickCobro_(
      row[srcIdxTrabajo1],
      row[srcIdxTrabajo2],
      row[srcIdxSalario]
    );
    valuesTipoCobros.push([pick.tipo]);
    valuesCobrosMonto.push([pick.monto]);
  });

  writeColumn_(dst, destTipoCobros.index + 1, valuesTipoCobros, dataRowCount);
  writeColumn_(dst, destCobrosMonto.index + 1, valuesCobrosMonto, dataRowCount);
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

function hasValue_(value) {
  var text = String(value == null ? "" : value).trim();
  return text !== "";
}

function pickCobro_(trabajo1, trabajo2, salario) {
  if (hasValue_(trabajo1)) {
    return { tipo: "Trabajo 1", monto: trabajo1 };
  }
  if (hasValue_(trabajo2)) {
    return { tipo: "Trabajo 2", monto: trabajo2 };
  }
  if (hasValue_(salario)) {
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
