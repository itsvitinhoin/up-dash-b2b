const hostKey = (value: string) => value.toLowerCase().replace(/^www\./, "");
const categoryPath = /^\/cat\/\d+\/[a-zA-Z0-9%-]+$/;
export type PublicAssortment = { ids: string[]; urls?: Map<string, string>; stock: Map<string, { sku: string; units: number }[]> };

function readProductCardUrls(html: string, origin: string) {
  const urls = new Map<string, string>();
  for (const [tag] of html.matchAll(/<a\b[^>]+>/gi)) {
    if (!/\sclass\s*=\s*["'][^"']*\bev-listagem-prod-link\b[^"']*["']/i.test(tag)) continue;
    const link = tag.match(/\shref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!link) continue;
    try {
      const url = new URL(link, origin);
      const id = url.pathname.match(/^\/prod\/(\d+)\/[^/]+\/?$/)?.[1];
      if (url.origin === origin && id && !urls.has(id)) urls.set(id, `${origin}${url.pathname}`);
    } catch { continue; }
  }
  return urls;
}

export function readProductCardIds(html: string, origin: string) {
  return [...readProductCardUrls(html, origin).keys()];
}

export function parsePublicAssortment(html: string, origin: string): PublicAssortment {
  const urls = readProductCardUrls(html, origin);
  const cards = [...html.matchAll(/<li\b[^>]*\bjs-produto-card\b[^>]*>/gi)];
  const stock: PublicAssortment["stock"] = new Map();
  for (const [index, card] of cards.entries()) {
    const encoded = card[0].match(/\sdata-skus\s*=\s*"([^"]*)"/i)?.[1];
    const product = readProductCardIds(html.slice(card.index + card[0].length, cards[index + 1]?.index), origin)[0];
    if (!encoded || !product || stock.has(product)) continue;
    let values: unknown;
    try { values = JSON.parse(encoded.replace(/&quot;|&#34;|&#x22;/gi, '"').replace(/&amp;/g, "&")); } catch { continue; }
    if (!Array.isArray(values) || !values.length || values.length > 100) continue;
    const current = new Map<string, number>();
    for (const value of values) {
      const sku = String(value?.id ?? "");
      if (!/^\d+$/.test(sku) || typeof value?.estoque !== "number" || !Number.isFinite(value.estoque) || current.has(sku)) break;
      current.set(sku, Math.max(0, value.estoque));
    }
    if (current.size === values.length) stock.set(product, [...current].map(([sku, units]) => ({ sku, units })));
  }
  return { ids: [...urls.keys()], urls, stock };
}

async function boundedPage(url: URL, signal: AbortSignal) {
  const response = await fetch(url, { method: "GET", redirect: "error", signal, headers: { Accept: "text/html" } });
  if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("text/html")) return null;
  const reader = response.body.getReader();
  const decode = new TextDecoder();
  let html = "";
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return html + decode.decode();
      bytes += result.value.byteLength;
      if (bytes > 2_000_000) return null;
      html += decode.decode(result.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export function managerStorefrontHost(clientId: string) {
  const allowed = (process.env.UP_MANAGER_PUBLIC_STOREFRONTS ?? "").split(",").map(entry => entry.trim().split("="));
  const configured = allowed.find(([id]) => id === clientId)?.[1];
  return configured && /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(configured) ? configured.toLowerCase() : null;
}

export async function readPublicAssortments(clientId: string, pages: { host: string; path: string }[]) {
  const host = managerStorefrontHost(clientId);
  const results = new Map<string, PublicAssortment>();
  if (!host) return results;
  const pathKeys = [...new Set(pages.filter((page) => hostKey(page.host) === hostKey(host) && categoryPath.test(page.path)).map(({ path }) => path))].slice(0, 8);
  const signal = AbortSignal.timeout(12_000);
  const origin = `https://${host}`;
  await Promise.all(pathKeys.map(async (path) => {
    const html = await boundedPage(new URL(path, origin), signal).catch(() => null);
    if (!html) return;
    const assortment = parsePublicAssortment(html, origin);
    if (assortment.ids.length) results.set(`${hostKey(host)}${path}`, assortment);
  }));
  return results;
}

export function parsePublicProductStock(html: string, productId: string) {
  const stock = new Map<string, number>();
  const attribute = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1];
  for (const [tag] of html.matchAll(/<input\b[^>]*\bdata-quantidade=["'][^"']*["'][^>]*>/gi)) {
    if (attribute(tag, "data-produto-id") !== productId) continue;
    const id = attribute(tag, "data-sku-id");
    const units = attribute(tag, "data-quantidade");
    if (!id || !/^\d+$/.test(id) || units === undefined || !/^\d+$/.test(units)) continue;
    const quantity = Number(units);
    if (!Number.isSafeInteger(quantity) || (stock.has(id) && stock.get(id) !== quantity)) return null;
    stock.set(id, quantity);
  }
  return stock.size ? stock : null;
}

export async function readPublicProductStock(clientId: string, path: string, signal: AbortSignal) {
  const host = managerStorefrontHost(clientId);
  const product = path.match(/^\/prod\/(\d+)\/[a-zA-Z0-9%-]+\/?$/)?.[1];
  if (!host || !product) return null;
  const html = await boundedPage(new URL(path, `https://${host}`), signal);
  return html ? parsePublicProductStock(html, product) : null;
}
