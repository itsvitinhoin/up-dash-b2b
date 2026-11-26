import { and, eq, gte, inArray, isNotNull, like, lt, sql } from "drizzle-orm";
import { braavoCatalogTable as catalog, db, ordersTable as orders, productsTable as products } from "@workspace/db";
import { addDaysToDateOnly, saoPauloDateOnlyStart } from "../lib/reporting-period";
import { brazilianState } from "../lib/brazilian-states";
import { paidOrderStatus } from "./metric-rules";
import type { CatalogCategory, CatalogProduct } from "./product-campaign-analysis";
import type { ShippingObservation } from "./up-manager-shipping-insights";
import type { ManagerPeriod } from "./up-manager";

const knownSize = /^(?:[pPmMgG]{1,4}|XS|XL|XXL|U|único|[2-6][0-9])$/i;

function braavoOptions(label: string, parent: string) {
  if (!label.startsWith(parent)) return [];
  const suffix = label.slice(parent.length).trim();
  const pair = suffix.match(/^\((.*),\s*([^,]+)\)$/);
  if (pair) return [pair[1].trim(), pair[2].trim()];
  if (!suffix.startsWith("- ")) return [];
  const option = suffix.slice(2);
  return knownSize.test(option) ? ["", option] : [option, ""];
}

export async function readBraavoManagerCatalog(clientId: string, now = Date.now()) {
  const [parents, skus] = await Promise.all([
    db.select({ id: catalog.externalId, kind: catalog.kind, name: sql<string | null>`${catalog.data}->>'nome'`,
      category: sql<string | null>`${catalog.data}->>'categoria_id'`, parent: sql<string | null>`${catalog.data}->>'pai_id'` })
      .from(catalog).where(and(eq(catalog.clientId, clientId), inArray(catalog.kind, ["products", "categories"]))),
    db.select({ externalId: products.externalId, name: products.name, sku: products.sku,
      stock: products.stock, price: products.price, imageUrl: products.imageUrl, syncedAt: products.sourceSyncedAt })
      .from(products).where(and(eq(products.clientId, clientId), eq(products.status, "ACTIVE"),
        like(products.externalId, "braavo:%"), isNotNull(products.sourceSyncedAt))),
  ]);
  const names = new Map(parents.filter(({ kind, name }) => kind === "products" && name).map(({ id, name, category }) => [id, { name: name!, category }]));
  const categories: CatalogCategory[] = parents.flatMap(({ id, kind, name, parent }) => kind === "categories" && name
    ? [{ id, name, handle: name, parent }] : []);
  const grouped = new Map<string, CatalogProduct>();
  let observation = now;
  for (const row of skus) {
    const match = row.externalId?.match(/^braavo:([^:]+):([^:]+)$/);
    if (!match || !row.syncedAt) continue;
    const [, productId, skuId] = match;
    const record = names.get(productId);
    if (!record) continue;
    const { name, category } = record;
    const id = `braavo:${productId}`;
    const product = grouped.get(id) ?? { id, name, published: true, attributes: ["Cor", "Tamanho"], categories: category ? [category] : undefined,
      images: row.imageUrl ? [{ src: row.imageUrl }] : [], variants: [] };
    const synchronized = row.syncedAt.getTime();
    const stock = now - synchronized <= 48 * 3_600_000 ? Math.max(0, row.stock) : null;
    observation = Math.min(observation, synchronized);
    product.variants!.push({ id: skuId, sku: row.sku, price: row.price, stock, values: braavoOptions(row.name, name) });
    grouped.set(id, product);
  }
  return grouped.size ? { products: [...grouped.values()], domains: [], categories, observedAt: new Date(observation).toISOString() } : null;
}

export async function readBraavoManagerFreight(clientId: string, period: ManagerPeriod): Promise<ShippingObservation[]> {
  const rows = await db.select({ state: orders.state, price: orders.shippingAmount, total: orders.fulfilledAmount })
    .from(orders).where(and(eq(orders.clientId, clientId), paidOrderStatus(),
      gte(orders.createdAt, saoPauloDateOnlyStart(period.dateFrom)), lt(orders.createdAt, saoPauloDateOnlyStart(addDaysToDateOnly(period.dateTo, 1)))));
  return rows.map(({ state, price, total }) => ({
    shippingState: brazilianState(state, "BR"),
    shipping_cost_customer: price > 0 ? price : null,
    total,
  }));
}
