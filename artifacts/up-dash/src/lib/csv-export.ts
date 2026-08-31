type Cell = string | number | boolean | Date | null | undefined;

function escape(value: Cell): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (value instanceof Date) {
    s = value.toISOString();
  } else if (typeof value === "number" && !Number.isFinite(value)) {
    s = "";
  } else if (typeof value === "number") {
    // Achado 26/08/2026 (ClickUp Vogabox item 1.2): soma de ponto
    // flutuante do JS produz números tipo 16554.099999999998 em vez de
    // 16554.1 -- ao abrir no Sheets/Excel em locale BR, os vários
    // dígitos decimais viravam separador de milhar (virava algo tipo
    // "16.554.099.999"). Arredondar pra 2 casas antes de exportar evita
    // a ambiguidade -- não é bug de cálculo, é ruído de precisão que só
    // aparecia na hora de virar texto.
    s = Number.isInteger(value) ? String(value) : value.toFixed(2);
  } else {
    s = String(value);
  }
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export interface CsvColumn<Row> {
  header: string;
  accessor: (row: Row) => Cell;
}

export function rowsToCsv<Row>(rows: Row[], columns: CsvColumn<Row>[]): string {
  const head = columns.map((c) => escape(c.header)).join(",");
  const body = rows.map((row) =>
    columns.map((c) => escape(c.accessor(row))).join(","),
  );
  return [head, ...body].join("\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportRowsAsCsv<Row>(
  filename: string,
  rows: Row[],
  columns: CsvColumn<Row>[],
): void {
  if (rows.length === 0) {
    downloadCsv(filename, rowsToCsv([{}] as Row[], columns));
    return;
  }
  downloadCsv(filename, rowsToCsv(rows, columns));
}
