import { brazilianState } from "../lib/brazilian-states";
import {
  safeUrl,
  type CampaignAd,
  type CatalogProduct,
  type CatalogCategory,
} from "./product-campaign-analysis";

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function creativeDestinations(value: unknown): {
  urls: string[];
  catalog: boolean;
  imageUrl: string | null;
} {
  const creative = record(value);
  const story = record(creative.object_story_spec);
  const link = record(story.link_data);
  const video = record(story.video_data);
  const urls = [
    creative.object_url,
    creative.link_url,
    link.link,
    record(record(link.call_to_action).value).link,
    record(record(video.call_to_action).value).link,
    ...list(link.child_attachments).flatMap((child) => [
      record(child).link,
      record(child).website_url,
      record(record(record(child).call_to_action).value).link,
    ]),
    ...list(record(creative.asset_feed_spec).link_urls).map(
      (item) => record(item).website_url,
    ),
  ].flatMap((value) => {
    const url = safeUrl(value);
    return url ? [url.toString()] : [];
  });
  return {
    urls: [...new Set(urls)],
    catalog: Boolean(
      creative.product_set_id || story.template_data || story.product_data,
    ),
    imageUrl:
      safeUrl(creative.image_url ?? creative.thumbnail_url)?.toString() ?? null,
  };
}

export function isActiveAd(value: unknown, now: Date): boolean {
  const ad = record(value);
  if (ad.effective_status !== "ACTIVE") return false;
  for (const ancestor of [record(ad.campaign), record(ad.adset)]) {
    if (ancestor.effective_status !== "ACTIVE") return false;
  }
  const set = record(ad.adset);
  for (const [key, expired] of [
    ["start_time", false],
    ["end_time", true],
  ] as const) {
    if (!set[key]) continue;
    const date = Date.parse(string(set[key]));
    if (
      !Number.isFinite(date) ||
      (expired ? date <= now.getTime() : date > now.getTime())
    )
      return false;
  }
  return true;
}

async function requestJson(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      redirect: "error",
    });
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      signal.throwIfAborted();
      continue;
    }
    const body: unknown = await response.json();
    // Never surface remote error bodies or URLs: they can contain credentials.
    if (!response.ok || record(body).error)
      throw new Error(`Fonte indisponível (HTTP ${response.status}).`);
    return body;
  }
  throw new Error("Fonte indisponível.");
}

export async function fetchGraphRows(
  path: string,
  token: string,
  params: Record<string, string>,
  signal: AbortSignal,
): Promise<unknown[]> {
  const version = process.env.META_GRAPH_VERSION ?? "v24.0";
  let url: string | null =
    `https://graph.facebook.com/${version}/${path}?${new URLSearchParams(params)}`;
  const rows: unknown[] = [];
  const visited = new Set<string>();
  for (let page = 0; url && page < 100; page++) {
    const parsed = new URL(url);
    if (parsed.origin !== "https://graph.facebook.com" || visited.has(url))
      throw new Error("Paginação Meta inválida.");
    visited.add(url);
    parsed.searchParams.delete("access_token");
    const body = record(
      await requestJson(
        parsed.toString(),
        { Authorization: `Bearer ${token}` },
        signal,
      ),
    );
    if (!Array.isArray(body.data)) throw new Error("Resposta Meta incompleta.");
    rows.push(...body.data);
    url = string(record(body.paging).next) || null;
  }
  if (url)
    throw new Error("Paginação Meta excedeu o limite; análise não publicada.");
  return rows;
}

export function recentWindow(
  now: Date,
  timeZone: string,
): { since: string; until: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((item) => item.type === type)!.value;
  const end = new Date(
    `${part("year")}-${part("month")}-${part("day")}T00:00:00Z`,
  );
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return {
    since: start.toISOString().slice(0, 10),
    until: end.toISOString().slice(0, 10),
  };
}

export async function fetchCampaignAds(
  accountId: string,
  token: string,
  signal: AbortSignal,
) {
  const id = accountId.trim().replace(/^(act_|act=)/, "");
  if (!/^\d+$/.test(id)) throw new Error("Conta Meta inválida.");
  const version = process.env.META_GRAPH_VERSION ?? "v24.0";
  const account = record(
    await requestJson(
      `https://graph.facebook.com/${version}/act_${id}?fields=timezone_name,currency`,
      { Authorization: `Bearer ${token}` },
      signal,
    ),
  );
  const timeZone = string(account.timezone_name);
  const currency = string(account.currency);
  if (!timeZone || !currency)
    throw new Error("Fuso ou moeda da conta Meta indisponível.");
  const now = new Date();
  const window = recentWindow(now, timeZone);
  const rawAds = await fetchGraphRows(
    `act_${id}/ads`,
    token,
    {
      fields:
        "id,name,effective_status,campaign{id,name,effective_status},adset{id,name,effective_status,start_time,end_time},creative{id,name,thumbnail_url,image_url,object_url,link_url,product_set_id,object_story_spec,asset_feed_spec}",
      filtering: JSON.stringify([
        { field: "effective_status", operator: "IN", value: ["ACTIVE"] },
      ]),
      limit: "100",
    },
    signal,
  );
  const warnings: string[] = [];
  let metrics: unknown[] | null;
  try {
    metrics = await fetchGraphRows(
      `act_${id}/insights`,
      token,
      {
        level: "ad",
        fields: "ad_id,spend,impressions",
        time_range: JSON.stringify(window),
        limit: "500",
      },
      signal,
    );
  } catch {
    metrics = null;
    warnings.push(
      "Gasto recente indisponível. Os alertas de estoque continuam disponíveis.",
    );
  }
  const byId = new Map(
    (metrics ?? []).map((value) => [
      string(record(value).ad_id),
      record(value),
    ]),
  );
  const ads: CampaignAd[] = rawAds
    .filter((value) => isActiveAd(value, now))
    .map((value) => {
      const ad = record(value);
      if (!/^\d+$/.test(string(ad.id)))
        throw new Error("Identificador de anúncio inválido.");
      const metric = byId.get(string(ad.id));
      const creative = record(ad.creative);
      const story = record(creative.object_story_spec);
      const link = record(story.link_data);
      const videoCta = record(
        record(record(story.video_data).call_to_action).value,
      );
      // Only explicit website links in single image/video creatives enter the pilot.
      const reviewableDestination =
        Boolean(safeUrl(link.link ?? videoCta.link)) &&
        !creative.asset_feed_spec &&
        list(link.child_attachments).length === 0;
      const number = (value: unknown) => {
        const result = Number(value ?? 0);
        return Number.isFinite(result) && result >= 0 ? result : null;
      };
      return {
        id: string(ad.id),
        name: string(ad.name),
        campaignName: string(record(ad.campaign).name),
        campaignId: string(record(ad.campaign).id) || undefined,
        adsetId: string(record(ad.adset).id) || undefined,
        creativeId: string(creative.id) || undefined,
        creativeName: string(creative.name) || undefined,
        adsetName: string(record(ad.adset).name),
        effectiveStatus: "ACTIVE",
        ...creativeDestinations(creative),
        reviewableDestination,
        spend: metrics === null ? null : number(metric?.spend),
        impressions: metrics === null ? null : number(metric?.impressions),
      };
    });
  if (rawAds.length !== ads.length)
    warnings.push(
      `${rawAds.length - ads.length} anúncio(s) excluído(s) por status, agendamento ou hierarquia não confirmados.`,
    );
  return {
    ads,
    warnings,
    window,
    currency,
    timeZone,
    observedAt: now.toISOString(),
  };
}

export async function fetchManagerStockAd(
  accountId: string,
  adId: string,
  token: string,
  signal: AbortSignal,
  expectedStatus: "ACTIVE" | "PAUSED" = "ACTIVE",
): Promise<CampaignAd | null> {
  const id = accountId.trim().replace(/^(act_|act=)/, "");
  const version = process.env.META_GRAPH_VERSION ?? "v24.0";
  if (!/^\d+$/.test(id) || !/^\d+$/.test(adId) || !/^v\d+\.0$/.test(version))
    return null;
  const fields = "id,account_id,name,status,effective_status,campaign{id,name,effective_status},adset{id,name,effective_status,start_time,end_time},creative{id,name,object_url,link_url,product_set_id,object_story_spec,asset_feed_spec}";
  const row = record(await requestJson(
    `https://graph.facebook.com/${version}/${adId}?${new URLSearchParams({ fields })}`,
    { Authorization: `Bearer ${token}` },
    signal,
  ));
  if (string(row.id) !== adId || string(row.account_id).replace(/^act_/, "") !== id ||
    row.effective_status !== expectedStatus || (expectedStatus === "PAUSED" && row.status !== "PAUSED") ||
    !isActiveAd({ ...row, effective_status: "ACTIVE" }, new Date())) return null;
  return {
    id: adId,
    name: string(row.name),
    campaignId: string(record(row.campaign).id),
    campaignName: string(record(row.campaign).name),
    adsetId: string(record(row.adset).id),
    adsetName: string(record(row.adset).name),
    effectiveStatus: expectedStatus,
    ...creativeDestinations(row.creative),
    spend: null,
    impressions: null,
  };
}

function nuvemCatalogHeaders(token: string) {
  return {
    Authentication: `bearer ${token}`,
    "User-Agent": process.env.NUVEMSHOP_USER_AGENT ?? "UP Dash (suporte@grupoup.com.br)",
  };
}

export async function fetchManagerStoreDomains(storeId: string, token: string, signal: AbortSignal) {
  if (!/^\d+$/.test(storeId)) throw new Error("Loja Nuvemshop inválida.");
  const store = record(await requestJson(
    `https://api.nuvemshop.com.br/v1/${storeId}/store?fields=id,domains,original_domain`,
    nuvemCatalogHeaders(token),
    signal,
  ));
  const domains = [...list(store.domains), store.original_domain].filter(
    (value): value is string => typeof value === "string" && !!value,
  );
  if (!domains.length) throw new Error("Domínios da loja indisponíveis.");
  return domains;
}

export async function fetchCampaignCatalog(
  storeId: string,
  token: string,
  signal: AbortSignal,
) {
  if (!/^\d+$/.test(storeId)) throw new Error("Loja Nuvemshop inválida.");
  const base = `https://api.nuvemshop.com.br/v1/${storeId}`;
  const headers = nuvemCatalogHeaders(token);
  const observedAt = new Date().toISOString();
  const domains = await fetchManagerStoreDomains(storeId, token, signal);
  const products: CatalogProduct[] = [];
  for (let page = 1; page <= 100; page++) {
    // Read the complete catalog, including zero-stock products and every variant.
    const body = await requestJson(
      `${base}/products?page=${page}&per_page=200`,
      headers,
      signal,
    );
    if (!Array.isArray(body)) throw new Error("Catálogo Nuvemshop incompleto.");
    for (const item of body) {
      const product = record(item);
      if (!product.id || !product.name || !Array.isArray(product.variants))
        throw new Error("Produto Nuvemshop incompleto.");
      products.push(item as CatalogProduct);
    }
    if (body.length < 200) return { products, domains, observedAt };
  }
  throw new Error("Catálogo excedeu o limite; análise não publicada.");
}

export async function fetchManagerCategories(storeId: string, token: string, signal: AbortSignal) {
  if (!/^\d+$/.test(storeId)) return null;
  const categories: CatalogCategory[] = [];
  for (let page = 1; page <= 10; page++) {
    const body = await requestJson(`https://api.nuvemshop.com.br/v1/${storeId}/categories?fields=id,handle,name,parent&per_page=200&page=${page}`, nuvemCatalogHeaders(token), signal);
    if (!Array.isArray(body)) return null;
    for (const raw of body) {
      const item = record(raw);
      if (item.id && item.handle && item.name) categories.push(item as CatalogCategory);
    }
    if (body.length < 200) return categories;
  }
  return null;
}

export async function fetchManagerCatalogProduct(
  storeId: string,
  token: string,
  productId: string,
): Promise<CatalogProduct> {
  if (!/^\d+$/.test(storeId) || !/^\d+$/.test(productId)) throw new Error("Produto inválido.");
  const headers = {
    Authentication: `bearer ${token}`,
    "User-Agent": process.env.NUVEMSHOP_USER_AGENT ?? "UP Dash (suporte@grupoup.com.br)",
  };
  const product = record(await requestJson(
    `https://api.nuvemshop.com.br/v1/${storeId}/products/${productId}`,
    headers,
    AbortSignal.timeout(10_000),
  ));
  if (String(product.id) !== productId || !Array.isArray(product.variants))
    throw new Error("Produto Nuvemshop indisponível.");
  return product as unknown as CatalogProduct;
}

export async function fetchManagerCoupons(storeId: string, token: string) {
  if (!/^\d+$/.test(storeId)) throw new Error("Loja Nuvemshop inválida.");
  const headers = {
    Authentication: `bearer ${token}`,
    "User-Agent":
      process.env.NUVEMSHOP_USER_AGENT ?? "UP Dash (suporte@grupoup.com.br)",
  };
  const signal = AbortSignal.timeout(8_000);
  const coupons: Array<{ id: string; terms: string; freeShipping: boolean }> =
    [];
  for (let page = 1; page <= 10; page++) {
    const result = await requestJson(
      `https://api.nuvemshop.com.br/v1/${storeId}/coupons?valid=true&page=${page}&per_page=200`,
      headers,
      signal,
    );
    if (!Array.isArray(result))
      throw new Error("Cupons Nuvemshop indisponíveis.");
    for (const entry of result) {
      const value = record(entry);
      if (!value.id || value.valid !== true || value.deleted_at) continue;
      const ids = (input: unknown) =>
        list(input)
          .map((item) => String(record(item).id ?? item))
          .sort();
      const terms = JSON.stringify([
        value.type,
        value.value,
        value.min_price,
        value.start_date,
        value.end_date,
        value.max_uses,
        value.includes_shipping,
        value.first_consumer_purchase,
        value.combines_with_other_discounts,
        value.only_cheapest_shipping,
        ids(value.categories),
        ids(value.products),
      ]);
      coupons.push({
        id: String(value.id),
        terms,
        freeShipping: value.type === "shipping",
      });
    }
    if (result.length < 200)
      return { observedAt: new Date().toISOString(), items: coupons };
  }
  throw new Error("Lista de cupons incompleta.");
}

export type NuvemOrderShipping = {
  id: number;
  created_at: string;
  payment_status: string;
  status: string;
  shipping_pickup_type?: string;
  shippingState?: string | null;
  shipping_carrier_name?: string | null;
  shipping_option_code?: string | null;
  shipping_option?: string | null;
  shipping_cost_customer?: number | string | null;
  shipping_max_days?: number | string | null;
  total?: number | string | null;
};

export async function fetchManagerOrderShipping(
  storeId: string,
  token: string,
  from: Date,
  end: Date,
): Promise<NuvemOrderShipping[]> {
  if (!/^\d+$/.test(storeId)) throw new Error("Loja Nuvemshop inválida.");
  const headers = {
    Authentication: `bearer ${token}`,
    "User-Agent": process.env.NUVEMSHOP_USER_AGENT ?? "UP Dash (suporte@grupoup.com.br)",
  };
  const signal = AbortSignal.timeout(16_000);
  const orders = new Map<number, NuvemOrderShipping>();
  for (let page = 1; page <= 10; page++) {
    const params = new URLSearchParams({
      created_at_min: from.toISOString(),
      created_at_max: new Date(end.getTime() - 1).toISOString(),
      fields: "id,created_at,status,payment_status,total,shipping_pickup_type,shipping_option,shipping_option_code,shipping_carrier_name,shipping_cost_customer,shipping_max_days,shipping_address",
      payment_status: "paid",
      per_page: "200",
      page: String(page),
    });
    const response = await requestJson(
      `https://api.nuvemshop.com.br/v1/${storeId}/orders?${params}`,
      headers, signal,
    );
    if (!Array.isArray(response)) throw new Error("Histórico de frete incompleto.");
    for (const raw of response as (NuvemOrderShipping & {
      shipping_address?: { province?: string | null; country?: string | null } | null;
    })[]) {
      const { shipping_address: destination, ...item } = raw;
      const created = Date.parse(item.created_at);
      if (Number.isFinite(item.id) && item.status !== "cancelled" && item.payment_status === "paid" &&
        created >= from.getTime() && created < end.getTime() && item.shipping_pickup_type === "ship") {
        orders.set(item.id, { ...item, shippingState: brazilianState(destination?.province, destination?.country) });
      }
    }
    if (response.length < 200) return [...orders.values()];
  }
  throw new Error("Histórico de frete excedeu a cobertura do período.");
}
