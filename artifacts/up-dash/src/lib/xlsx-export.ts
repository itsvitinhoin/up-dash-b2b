import * as XLSX from "xlsx";

// Achado 31/08/2026 (ClickUp Vogabox item ERP 4.4/4.5): os 3 exports mais
// usados do ERP (Pedidos, Clientes, Desempenho do catálogo) saíam em CSV,
// mas o time abre tudo direto no Excel -- gerar .xlsx de verdade evita o
// passo manual de "importar CSV" e os problemas de acentuação/separador
// que o CSV dá dependendo do Excel/locale de quem abre. Mesma interface de
// coluna (header + accessor) que csv-export.ts, pra trocar só a chamada
// no call site sem reescrever as definições de coluna.

type Cell = string | number | boolean | Date | null | undefined;

export interface XlsxColumn<Row> {
  header: string;
  accessor: (row: Row) => Cell;
}

function cellValue(value: Cell): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    // Mesmo motivo do arredondamento em csv-export.ts: evita
    // 16554.099999999998 aparecendo cru na célula.
    if (!Number.isFinite(value)) return null;
    return Number.isInteger(value) ? value : Math.round(value * 100) / 100;
  }
  return value;
}

function columnWidths(header: string[], body: (string | number | boolean | Date | null)[][]): { wch: number }[] {
  return header.map((h, i) => {
    let maxLen = h.length;
    for (const row of body) {
      const v = row[i];
      const len = v instanceof Date ? 10 : String(v ?? "").length;
      if (len > maxLen) maxLen = len;
    }
    return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
  });
}

export function downloadXlsx(
  filename: string,
  sheetName: string,
  header: string[],
  body: (string | number | boolean | Date | null)[][],
): void {
  const worksheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  worksheet["!cols"] = columnWidths(header, body);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, filename);
}

export function exportRowsAsXlsx<Row>(
  filename: string,
  sheetName: string,
  rows: Row[],
  columns: XlsxColumn<Row>[],
): void {
  const header = columns.map((c) => c.header);
  const source = rows.length === 0 ? ([{}] as Row[]) : rows;
  const body = source.map((row) => columns.map((c) => cellValue(c.accessor(row))));
  downloadXlsx(filename, sheetName, header, body);
}
