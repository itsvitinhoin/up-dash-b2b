export interface ProductSaleRow {
  category: string | null;
  color: string | null;
  size: string | null;
  units: number;
  revenue: number;
}

export interface ProductSalesBucket {
  label: string;
  units: number;
  revenue: number;
}

/** Each item contributes once to each dimension, including missing attributes. */
export function buildProductSalesBreakdowns(rows: readonly ProductSaleRow[]) {
  const categories = new Map<string, ProductSalesBucket>();
  const colors = new Map<string, ProductSalesBucket>();
  const sizes = new Map<string, ProductSalesBucket>();
  let units = 0;
  let revenue = 0;

  function add(map: Map<string, ProductSalesBucket>, attribute: string | null, row: ProductSaleRow) {
    const label = attribute?.trim() || "Não informado";
    const key = label.toLocaleLowerCase("pt-BR");
    const bucket = map.get(key) ?? { label, units: 0, revenue: 0 };
    bucket.units += row.units;
    bucket.revenue += row.revenue;
    map.set(key, bucket);
  }

  for (const row of rows) {
    units += row.units;
    revenue += row.revenue;
    add(categories, row.category, row);
    add(colors, row.color, row);
    add(sizes, row.size, row);
  }

  const buckets = (map: Map<string, ProductSalesBucket>) => [...map.values()]
    .sort((a, b) => b.units - a.units || a.label.localeCompare(b.label, "pt-BR"));

  return { totals: { units, revenue }, categories: buckets(categories), colors: buckets(colors), sizes: buckets(sizes) };
}
