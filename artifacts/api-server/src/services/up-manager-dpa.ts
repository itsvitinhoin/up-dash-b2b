import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, pool, upManagerAdActionsTable as actions } from "@workspace/db";
import { z } from "zod";
import { classifyGrade, localized, matchProductUrl, safeUrl, variantStock, type CatalogProduct, type CatalogVariant } from "./product-campaign-analysis";
import { catalogVariantLabels, managerMetaToken, readCatalog, type ManagerClient, type ManagerPeriod } from "./up-manager";

import { addDaysToDateOnly, saoPauloDateOnly } from "../lib/reporting-period";
import { fetchManagerCatalogProduct, fetchManagerStoreDomains } from "./product-campaign-sources";
import { getGa4ProductViews } from "./ga4-daily-sync";
import { managerStorefrontHost, readPublicProductStock } from "./up-manager-public-assortment";
import { summarizeProductViews } from "./up-manager-product-traffic";

const numericId = z.string().regex(/^\d{1,32}$/);
const configSchema = z.record(z.object({ catalogId: numericId, mode: z.enum(["preview", "live"]).default("preview"), manualRemoval: z.boolean().default(false) }));
const productSetName = "UP Manager · Grade completa";
const inStock = "in stock";

type StoreCatalog = { products: CatalogProduct[]; domains: string[]; observedAt: string };
export type CatalogItem = {
  retailer_id: string;
  retailer_product_group_id?: string;
  availability?: string;
  url?: string;
  name?: string;
  size?: string;
  color?: string;
  image_url?: string;
};
type ProductSet = { id: string; retailer_id?: string; name: string };
type Page<T> = { data: T[]; paging?: { next?: string; cursors?: { after?: string } } };
type ProductChange = { product: string; reason: string; variants: number };
export type DpaResult = {
  status: "preview" | "applied" | "unchanged" | "blocked" | "pending";
  catalogId: string;
  setId?: string;
  checkedAt: string;
  eligible?: number;
  current?: number;
  unmatched?: number;
  gradeExcluded?: ProductChange[];
  additions?: ProductChange[];
  exclusions?: ProductChange[];
  detail?: string;
};

function braavoCatalogLink(item: CatalogItem, domains: string[]) {
  const url = safeUrl(item.url);
  if (!url || url.port || !domains.some(domain => domain.toLowerCase().replace(/^www\./, "") === url.hostname.toLowerCase().replace(/^www\./, ""))) return null;
  const product = url.pathname.match(/^\/prod\/(\d+)\/[^/]+\/?$/)?.[1];
  const variant = url.hash.match(/^#s(\d+)$/)?.[1];
  return product && variant ? { productId: `braavo:${product}`, key: `braavo:${product}:${variant}`, path: url.pathname } : null;
}

function storeWithDpaDomain(client: ManagerClient, store: StoreCatalog | null) {
  const host = client.commercePlatform === "BRAAVO" ? managerStorefrontHost(client.id) : null;
  return host && store ? { ...store, domains: [host] } : store;
}

async function confirmBraavoDpaStock(client: ManagerClient, store: StoreCatalog, items: CatalogItem[], candidatesOnly = false) {
  if (client.commercePlatform !== "BRAAVO" || !store.domains.length) return store;
  const listings = new Map<string, { path: string; stockIds: Set<string> }>();
  for (const item of items) {
    const link = braavoCatalogLink(item, store.domains);
    if (!link) continue;
    const listing = listings.get(link.productId) ?? { path: link.path, stockIds: new Set() };
    if (item.availability === inStock) listing.stockIds.add(link.key);
    listings.set(link.productId, listing);
  }
  const products = store.products.filter(product => {
    const row = listings.get(String(product.id));
    return Boolean(row && (!candidatesOnly || product.variants?.every(variant => row.stockIds.has(`${product.id}:${variant.id}`))));
  });
  const observed = new Map<string, Map<string, number>>();
  const signal = AbortSignal.timeout(16_000);
  for (let start = 0; start < Math.min(products.length, 24) && !signal.aborted; start += 4) {
    await Promise.all(products.slice(start, start + 4).map(async product => {
      const id = String(product.id);
      const stock = await readPublicProductStock(client.id, listings.get(id)!.path, signal).catch(() => null);
      if (stock) observed.set(id, stock);
    }));
  }
  return { ...store, products: store.products.map(product => {
    const stock = observed.get(String(product.id));
    if (!stock) return product;
    const known = new Map((product.variants ?? []).map(variant => [String(variant.id), variant]));
    for (const [id, available] of stock) known.set(id, { ...known.get(id), id, stock: available });
    return { ...product, variants: [...known.values()] };
  }) };
}

function matchesCatalogVariant(item: CatalogItem, product: CatalogProduct, variant: CatalogVariant, domains: string[]) {
  if (String(product.id).startsWith("braavo:")) return braavoCatalogLink(item, domains)?.key === `${product.id}:${variant.id}`;
  if (item.retailer_product_group_id && item.retailer_product_group_id !== String(product.id)) return false;
  const exact = item.url ? matchProductUrl(item.url, domains, [product]) : null;
  return exact ? String(exact.variant?.id) === String(variant.id) : !item.url && item.retailer_product_group_id === String(product.id);
}

export function planDpaProducts(store: StoreCatalog, items: CatalogItem[], current: CatalogItem[]) {
  const itemsById = new Map<string, CatalogItem[]>();
  for (const item of items) {
    const braavo = braavoCatalogLink(item, store.domains);
    const key = braavo?.key ?? item.retailer_id;
    const rows = itemsById.get(key) ?? [];
    rows.push(item);
    itemsById.set(key, rows);
  }
  const currentIds = new Set(current.map(item => item.retailer_id));
  const next = new Set(currentIds);
  const used = new Map<string, string>();
  const additions: ProductChange[] = [];
  const exclusions: ProductChange[] = [];
  const gradeExcluded: ProductChange[] = [];
  let unmatched = 0;

  for (const product of store.products) {
    const variants = product.variants ?? [];
    const productId = String(product.id);
    const name = localized(product.name) || productId;
    const matched = variants.map(variant => {
      const ids = new Set([String(variant.id), variant.sku?.trim(), `${productId}:${variant.id}`].filter((id): id is string => Boolean(id)));
      const candidates = [...ids].flatMap(id => itemsById.get(id) ?? [])
        .filter(item => matchesCatalogVariant(item, product, variant, store.domains));
      const item = candidates.length === 1 ? candidates[0] : undefined;
      if (item) {
        const prior = used.get(item.retailer_id);
        if (prior !== undefined) throw new Error("O mesmo item da Meta identifica mais de uma variante da loja.");
        used.set(item.retailer_id, productId);
      }
      return item;
    });
    const visible = product.published === true || ["published", "visible"].includes(product.visibility ?? "");
    const hidden = product.published === false || ["hidden", "unpublished"].includes(product.visibility ?? "");
    const grade = classifyGrade(variants);
    const available = matched.filter((item): item is CatalogItem => Boolean(item));
    if (hidden || (visible && variants.some(variant => variantStock(variant) === 0))) {
      const reason = hidden ? "Produto oculto na loja" : grade === "out_of_stock" ? "Grade esgotada" : "Grade quebrada";
      const related = new Set([...available.map(item => item.retailer_id),
        ...current.filter(item => item.retailer_product_group_id === productId || braavoCatalogLink(item, store.domains)?.productId === productId).map(item => item.retailer_id)]);
      const removed = [...related].filter(id => next.delete(id)).length;
      if (related.size) gradeExcluded.push({ product: name, variants: related.size, reason });
      if (removed) exclusions.push({ product: name, variants: removed, reason });
      continue;
    }
    if (!visible || grade !== "complete" || matched.some(item => item?.availability !== inStock)) {
      unmatched++;
      continue;
    }
    const added = available.filter(item => !currentIds.has(item.retailer_id)).length;
    for (const item of available) next.add(item.retailer_id);
    if (added) additions.push({ product: name, variants: added, reason: "Grade completa e publicada" });
  }
  return { ids: [...next].sort(), unmatched, additions, exclusions, gradeExcluded, changed: additions.length + exclusions.length > 0 };
}

function graphClient(token: string) {
  const version = process.env.META_GRAPH_VERSION ?? "v24.0";
  if (!/^v\d+\.0$/.test(version)) throw new Error("Versão da API da Meta inválida.");
  return async <T>(path: string, query: Record<string, string> = {}, body?: URLSearchParams): Promise<T> => {
    const url = new URL(path, `https://graph.facebook.com/${version}/`);
    url.search = new URLSearchParams(query).toString();
    const response = await fetch(url, {
      method: body ? "POST" : "GET", body, headers: { Authorization: `Bearer ${token}` },
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12_000),
    });
    const result = await response.json() as T & { error?: { code?: number } };
    if (!response.ok || result.error) throw new Error(`Meta retornou HTTP ${response.status}${result.error?.code ? ` (código ${result.error.code})` : ""}.`);
    return result;
  };
}

type Graph = ReturnType<typeof graphClient>;
const itemFields = "retailer_id,retailer_product_group_id,availability,url,name";

async function readEdge<T>(graph: Graph, edge: string, query: Record<string, string>) {
  const rows: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < 70; page++) {
    const result = await graph<Page<T>>(edge, { ...query, limit: "100", ...(after ? { after } : {}) });
    if (!Array.isArray(result.data)) throw new Error("A Meta retornou uma lista incompleta.");
    rows.push(...result.data);
    if (!result.paging?.next) return rows;
    const cursor = result.paging.cursors?.after;
    if (!cursor || cursor === after) break;
    after = cursor;
  }
  throw new Error("A leitura paginada do catálogo não terminou.");
}

const retailerFilter = (ids: string[]) => ({
  retailer_id: ids.length === 1 ? { eq: ids[0] } : { is_any: ids },
});
const sameIds = (items: CatalogItem[], ids: string[]) => {
  const observed = new Set(items.map(item => item.retailer_id));
  return observed.size === ids.length && ids.every(id => observed.has(id));
};

async function verifyDpaFilter(graph: Graph, catalogId: string, ids: string[], marker: string) {
  const filterIds = ids.length ? ids : [`${marker}-empty`];
  for (let start = 0; start < filterIds.length; start += 50) {
    const chunk = filterIds.slice(start, start + 50);
    const filtered = await readEdge<CatalogItem>(graph, `${catalogId}/products`,
      { fields: "retailer_id", filter: JSON.stringify(retailerFilter(chunk)) });
    if (!sameIds(filtered, ids.length ? chunk : [])) return null;
  }
  return JSON.stringify(retailerFilter(filterIds));
}

async function withDpaLock<T>(catalogId: string, busy: T, run: () => Promise<T>): Promise<T> {
  const connection = await pool.connect();
  const key = `up-manager-dpa:${catalogId}`;
  let held = false;
  let broken = false;
  try {
    const lock = await connection.query<{ held: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS held", [key]);
    held = lock.rows[0]?.held === true;
    return held ? await run() : busy;
  } finally {
    if (held) await connection.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key]).catch(() => { broken = true; });
    connection.release(broken);
  }
}

function managedProductSet(sets: ProductSet[], marker: string) {
  const managed = sets.filter(set => set.retailer_id === marker);
  if (managed.length > 1 || managed.some(set => !numericId.safeParse(set.id).success)) {
    throw new Error("Mais de um conjunto gerenciado ou identificador inválido.");
  }
  return managed[0];
}

function readConfig(clientId: string) {
  const env = process.env.UP_MANAGER_DPA_CATALOGS?.trim();
  return env ? configSchema.parse(JSON.parse(env))[clientId] : undefined;
}

export async function syncManagerDpaSet(client: ManagerClient, inputStore: StoreCatalog | null): Promise<DpaResult | null> {
  let config: z.infer<typeof configSchema>[string] | undefined;
  try {
    config = readConfig(client.id);
  } catch {
    return { status: "blocked", catalogId: "", checkedAt: new Date().toISOString(), detail: "A configuração dos catálogos DPA é inválida." };
  }
  if (!config) return null;
  const { catalogId, mode } = config;
  const result: Pick<DpaResult, "catalogId" | "checkedAt"> = { catalogId, checkedAt: new Date().toISOString() };
  const token = managerMetaToken(client);
  const store = storeWithDpaDomain(client, inputStore);
  const observedAt = Date.parse(store?.observedAt ?? "");
  const nvmStale = client.commercePlatform !== "BRAAVO" &&
    (!Number.isFinite(observedAt) || Math.abs(Date.now() - observedAt) > 30 * 60_000);
  if (!token || !store?.products.length || !store.domains.length || nvmStale) {
    return { ...result, status: "blocked", detail: "Catálogo da loja ou credencial Meta sem leitura atual confirmada." };
  }
  const graph = graphClient(token);
  const marker = `up-manager-dpa-${client.id}`;
  const run = async (): Promise<DpaResult> => {
    let writeStarted = false;
    try {
      const [sets, items] = await Promise.all([
        readEdge<ProductSet>(graph, `${catalogId}/product_sets`, { fields: "id,retailer_id,name" }),
        readEdge<CatalogItem>(graph, `${catalogId}/products`, { fields: itemFields, bulk_pagination: "true" }),
      ]);
      const set = managedProductSet(sets, marker);
      const current = set ? await readEdge<CatalogItem>(graph, `${set.id}/products`, { fields: itemFields }) : [];
      const grade = await confirmBraavoDpaStock(client, store, current.length ? current : items, !current.length);
      const plan = planDpaProducts(grade, items, current);
      const detail = { ...result, setId: set?.id, eligible: plan.ids.length, current: current.length, unmatched: plan.unmatched,
        additions: plan.additions, exclusions: plan.exclusions, gradeExcluded: plan.gradeExcluded };
      if (set && !plan.changed) return { ...detail, status: "unchanged" };
      if (!set && !plan.ids.length) return { ...detail, status: "blocked", detail: "Nenhum produto com grade completa e correspondência confirmada." };

      const filter = await verifyDpaFilter(graph, catalogId, plan.ids, marker);
      if (!filter) return { ...detail, status: "blocked", detail: "A Meta não confirmou a seleção exata dos itens." };
      if (mode === "preview") return { ...detail, status: "preview" };
      const body = new URLSearchParams({ filter });
      if (!set) {
        body.set("name", productSetName);
        body.set("retailer_id", marker);
      }
      writeStarted = true;
      const updated = await graph<{ id?: string; success?: boolean }>(set?.id ?? `${catalogId}/product_sets`, {}, body);
      const setId = set?.id ?? updated.id;
      if (!setId || !numericId.safeParse(setId).success) return { ...detail, status: "pending", detail: "A Meta ainda não retornou o ID do conjunto." };
      const actual = await readEdge<CatalogItem>(graph, `${setId}/products`, { fields: "retailer_id" });
      return sameIds(actual, plan.ids)
        ? { ...detail, setId, status: "applied" }
        : { ...detail, setId, status: "pending", detail: "Aguardando confirmação dos itens aplicados pela Meta." };
    } catch (error) {
      return { ...result, status: writeStarted ? "pending" : "blocked",
        detail: error instanceof Error && /^(Meta retornou HTTP|O mesmo item da Meta|Mais de um conjunto|A leitura paginada|A Meta retornou uma lista)/.test(error.message)
          ? error.message : "A leitura do conjunto de produtos da Meta não pôde ser confirmada." };
    }
  };
  return mode === "live" ? withDpaLock<DpaResult>(catalogId,
    { ...result, status: "blocked", detail: "Uma atualização do conjunto está em andamento." }, run)
      .catch((): DpaResult => ({ ...result, status: "blocked", detail: "Não foi possível reservar a atualização do conjunto." })) : run();
}

type Views = Awaited<ReturnType<typeof getGa4ProductViews>>;
type CatalogVariantRow = {
  id: string;
  label: string;
  size: string | null;
  color: string | null;
  stock: number | null;
  inSet: boolean | null;
};

export function buildDpaInventory(
  items: CatalogItem[], currentIds: ReadonlySet<string> | null, store: StoreCatalog | null, views: Views,
) {
  const byRetailerId = new Map<string, { product: CatalogProduct; variant: CatalogVariant }[]>();
  const storeProducts = store?.products ?? [];
  for (const product of storeProducts) {
    for (const variant of product.variants ?? []) {
      for (const id of new Set([String(variant.id), variant.sku?.trim(), `${product.id}:${variant.id}`].filter((key): key is string => Boolean(key)))) {
        const matches = byRetailerId.get(id) ?? [];
        matches.push({ product, variant });
        byRetailerId.set(id, matches);
      }
    }
  }

  const groups = new Map<string, { id: string; name: string; imageUrl: string | null; url: string | null; storeProductId?: string; variants: CatalogVariantRow[] }>();
  for (const item of new Map(items.filter(item => item.retailer_id).map(item => [item.retailer_id, item])).values()) {
    const braavo = braavoCatalogLink(item, store?.domains ?? []);
    const candidates = (byRetailerId.get(braavo?.key ?? item.retailer_id) ?? []).filter(({ product, variant }) =>
      matchesCatalogVariant(item, product, variant, store?.domains ?? []));
    const matched = candidates.length === 1 ? candidates[0] : undefined;
    const groupId = item.retailer_product_group_id?.trim();
    const key = braavo?.productId ?? (matched ? String(matched.product.id) : groupId || `meta:${item.retailer_id}`);
    const group = groups.get(key) ?? { id: key, name: "", imageUrl: null, url: null, variants: [] };
    const options = (matched?.variant.values ?? []).map(localized);
    const labels = matched ? catalogVariantLabels(matched.product, options) : null;
    const size = labels?.size || item.size?.trim() || null;
    const color = labels?.color || item.color?.trim() || null;
    if (matched) {
      group.name = localized(matched.product.name) || group.name;
      group.storeProductId = String(matched.product.id);
    }
    group.name ||= item.name?.trim() || item.retailer_id;
    group.imageUrl ??= safeUrl(matched?.product.images?.[0]?.src ?? item.image_url)?.href ?? null;
    group.url ??= safeUrl(item.url)?.href ?? null;
    group.variants.push({
      id: item.retailer_id,
      label: options.filter(Boolean).join(" / ") || item.retailer_id,
      size,
      color,
      stock: matched ? variantStock(matched.variant) : null,
      inSet: currentIds?.has(item.retailer_id) ?? null,
    });
    groups.set(key, group);
  }
  const storeById = new Map(storeProducts.map(product => [String(product.id), product]));
  const metaOnly = [...groups.values()].filter(group => !storeById.has(group.id))
    .map(group => ({ id: group.id, name: group.name, variants: group.variants.map(variant => ({ id: variant.id })) }));
  const totals = views ? summarizeProductViews(views, [...storeProducts, ...metaOnly]).totals : null;
  return [...groups.values()].map(({ storeProductId, ...group }) => {
    const product = storeProductId ? storeById.get(storeProductId) : undefined;
    const outOfStock = product?.variants?.filter(variant => variantStock(variant) === 0)
      .map(variant => (variant.values ?? []).map(localized).filter(Boolean).join(" / ") || String(variant.id)) ?? [];
    return { ...group, outOfStock, views: totals?.get(group.id)?.views ?? null };
  })
    .sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || a.name.localeCompare(b.name, "pt-BR"));
}

export async function readManagerDpaInventory(client: ManagerClient, isAdmin = false) {
  const config = readConfig(client.id);
  if (!config) return null;
  const token = managerMetaToken(client);
  if (!token) throw new Error("Credencial Meta indisponível.");
  const graph = graphClient(token);
  const { catalogId } = config;
  const dateTo = addDaysToDateOnly(saoPauloDateOnly(new Date()), -1);
  const period: ManagerPeriod = { dateFrom: addDaysToDateOnly(dateTo, -6), dateTo };
  const fields = `${itemFields},size,color,image_url`;
  const membership = readEdge<ProductSet>(graph, `${catalogId}/product_sets`, { fields: "id,retailer_id,name" })
    .then(async sets => {
      const set = managedProductSet(sets, `up-manager-dpa-${client.id}`);
      const current = set ? await readEdge<CatalogItem>(graph, `${set.id}/products`, { fields }) : [];
      return { setId: set?.id ?? null, setName: set?.name ?? null, current };
    }).catch(() => null);
  const [items, selected, store, views] = await Promise.all([
    readEdge<CatalogItem>(graph, `${catalogId}/products`, { fields, bulk_pagination: "true" }),
    membership,
    readCatalog(client).then(store => storeWithDpaDomain(client, store)).catch(() => null),
    getGa4ProductViews({ clientId: client.id, propertyId: client.ga4PropertyId, ...period }).catch(() => null),
  ]);
  const currentIds = selected ? new Set(selected.current.map(item => item.retailer_id)) : null;
  const grade = store && selected?.current.length ? await confirmBraavoDpaStock(client, store, selected.current) : store;
  return {
    setId: selected?.setId ?? null, setName: selected?.setName ?? null, membershipAvailable: selected !== null,
    stockObservedAt: store?.observedAt ?? null,
    canRemove: Boolean(isAdmin && config.manualRemoval && selected?.setId && store),
    ga4Available: views !== null,
    period,
    products: buildDpaInventory([...(selected?.current ?? []), ...items], currentIds, grade, views),
  };
}

type DpaRemoval = { status: "applied" | "blocked" | "pending"; removed?: number; message: string };
type DpaSelection = { setId: string; productId: string };

async function freshRemovalStock(client: ManagerClient, productId: string) {
  if (client.commercePlatform !== "NUVEMSHOP") return storeWithDpaDomain(client, await readCatalog(client));
  if (!client.storeId || !client.storeToken || !numericId.safeParse(productId).success) return null;
  const [product, domains] = await Promise.all([
    fetchManagerCatalogProduct(client.storeId, client.storeToken, productId),
    fetchManagerStoreDomains(client.storeId, client.storeToken, AbortSignal.timeout(12_000)),
  ]);
  return { products: [product], domains, observedAt: new Date().toISOString() };
}

export function planDpaRemoval(current: CatalogItem[], store: StoreCatalog, productId: string) {
  const ids = new Set(current.filter(item => item.retailer_id).map(item => item.retailer_id));
  const product = buildDpaInventory(current, ids, store, null).find(row => row.id === productId);
  if (!product?.outOfStock.length) return null;
  const removed = [...new Set(product.variants.map(variant => variant.id))];
  for (const id of removed) ids.delete(id);
  return { product, removed, remaining: [...ids].sort() };
}

export async function removeManagerDpaProduct(client: ManagerClient, selection: DpaSelection, actorUserId: string): Promise<DpaRemoval> {
  const config = readConfig(client.id);
  const token = managerMetaToken(client);
  if (!config?.manualRemoval || !token || !client.accountId) {
    return { status: "blocked", message: "A retirada está indisponível para este catálogo." };
  }
  const { catalogId } = config;
  const graph = graphClient(token);
  const marker = `up-manager-dpa-${client.id}`;
  return withDpaLock<DpaRemoval>(catalogId, { status: "blocked", message: "O conjunto está sendo atualizado. Tente novamente." }, async () => {
    const sets = await readEdge<ProductSet>(graph, `${catalogId}/product_sets`, { fields: "id,retailer_id,name" });
    const set = managedProductSet(sets, marker);
    if (!set || set.id !== selection.setId) return { status: "blocked", message: "O conjunto selecionado mudou. Atualize o catálogo." };
    const [sourceStock, current] = await Promise.all([
      freshRemovalStock(client, selection.productId).catch(() => null),
      readEdge<CatalogItem>(graph, `${set.id}/products`, { fields: itemFields }),
    ]);
    if (!sourceStock) return { status: "blocked", message: "Não foi possível confirmar o estoque atual da loja." };
    const store = await confirmBraavoDpaStock(client, sourceStock,
      current.filter(item => braavoCatalogLink(item, sourceStock.domains)?.productId === selection.productId));
    const plan = planDpaRemoval(current, store, selection.productId);
    if (!plan) return { status: "blocked", message: "A consulta atual não confirmou uma quebra de grade em um produto vinculado ao conjunto." };
    const filter = await verifyDpaFilter(graph, catalogId, plan.remaining, marker);
    if (!filter) return { status: "blocked", message: "A Meta não confirmou os demais itens do conjunto. A retirada não foi aplicada." };

    const recommendationId = randomUUID();
    await db.insert(actions).values({
      clientId: client.id, actorUserId, accountId: client.accountId!, recommendationId, status: "pending",
      evidence: { kind: "dpa-removal", catalogId, setId: set.id, productId: plan.product.id,
        productName: plan.product.name, variants: plan.removed.length, outOfStock: plan.product.outOfStock },
    });
    let verified = false;
    try {
      await graph(set.id, {}, new URLSearchParams({ filter }));
      const actual = await readEdge<CatalogItem>(graph, `${set.id}/products`, { fields: "retailer_id" });
      verified = sameIds(actual, plan.remaining);
    } catch {
      // The request may have succeeded before the connection failed. Recheck membership.
      const actual = await readEdge<CatalogItem>(graph, `${set.id}/products`, { fields: "retailer_id" }).catch(() => null);
      verified = actual !== null && sameIds(actual, plan.remaining);
    }
    await db.update(actions).set({ status: verified ? "applied" : "uncertain", updatedAt: new Date() })
      .where(and(eq(actions.clientId, client.id), eq(actions.recommendationId, recommendationId)));
    return verified
      ? { status: "applied", removed: plan.removed.length, message: `${plan.product.name} foi retirado do conjunto DPA.` }
      : { status: "pending", message: "A Meta ainda não confirmou a retirada. Atualize a lista para conferir o conjunto." };
  });
}
