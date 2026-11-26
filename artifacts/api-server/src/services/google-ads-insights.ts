import { and, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db, googleAdsConnectionsTable as connections, googleAdsInsightSnapshotsTable as snapshots,
  type GoogleAdsInsightSnapshot,
} from "@workspace/db";
import { GoogleAdsError, googleAdsConfigured, searchGoogleAds, type GoogleAdsAccountIds, type GoogleAdsDates } from "./google-ads-api";

type Column = GoogleAdsInsightSnapshot["columns"][number];
type Field = Column & { field?: string; scale?: number };
type View = { resource: string; dimensions: Field[]; metrics?: Field[]; extras?: Field[]; order?: string };
type Row = GoogleAdsInsightSnapshot["rows"][number];
const batchLimit = 2_500;
const staleAfter = 6 * 60 * 60 * 1_000;
const looseRow = z.record(z.unknown());
const f = (key: string, label: string, apiField: string, type: Field["type"] = "text", scale?: number): Field =>
  ({ key, label, field: apiField, type, scale });
const campaign = f("campaign", "Campanha", "campaign.name");
const campaignId = f("campaignId", "ID da campanha", "campaign.id");
const adGroup = f("adGroup", "Grupo de anúncios", "ad_group.name");
const channel = f("channel", "Tipo de campanha", "campaign.advertising_channel_type");
const impressions = f("impressions", "Impressões", "metrics.impressions", "number");
const clicks = f("clicks", "Cliques", "metrics.clicks", "number");
const spend = f("spend", "Investimento", "metrics.cost_micros", "currency", 1_000_000);
const conversions = f("conversions", "Conversões", "metrics.conversions", "number");
const value = f("value", "Valor de conversão", "metrics.conversions_value", "currency");
const performance: Field[] = [
  spend, impressions, clicks, conversions, value,
  { key: "ctr", label: "CTR", type: "percent" },
  { key: "cpc", label: "CPC", type: "currency" },
  { key: "cpa", label: "Custo por conv.", type: "currency" },
  { key: "roas", label: "ROAS", type: "ratio" },
];

const views = {
  keywords: {
    resource: "keyword_view",
    dimensions: [
      f("keyword", "Palavra-chave", "ad_group_criterion.keyword.text"),
      f("match", "Correspondência", "ad_group_criterion.keyword.match_type"),
      f("status", "Status", "ad_group_criterion.status"),
      f("quality", "Qualidade (1–10)", "ad_group_criterion.quality_info.quality_score", "number"), adGroup, campaign,
    ],
  },
  searchTerms: {
    resource: "campaign_search_term_view",
    dimensions: [f("term", "Termo pesquisado", "campaign_search_term_view.search_term"), channel, campaign],
  },
  auction: {
    resource: "campaign", dimensions: [campaign, channel], order: "metrics.search_impression_share",
    metrics: [
      f("impressionShare", "Parcela de impressões", "metrics.search_impression_share", "percent"),
      f("lostBudget", "Perda por orçamento", "metrics.search_budget_lost_impression_share", "percent"),
      f("lostRank", "Perda por classificação", "metrics.search_rank_lost_impression_share", "percent"),
      f("top", "Parcela no topo", "metrics.search_top_impression_share", "percent"),
      f("absoluteTop", "Parcela no 1º lugar", "metrics.search_absolute_top_impression_share", "percent"),
    ],
  },
  bidding: {
    resource: "campaign", dimensions: [
      campaign, channel, f("status", "Status atual", "campaign.status"),
      f("bidStrategy", "Estratégia atual", "campaign.bidding_strategy_type"),
      f("budget", "Orçamento diário atual", "campaign_budget.amount_micros", "currency", 1_000_000),
    ],
  },
  adGroups: { resource: "ad_group", dimensions: [adGroup, f("status", "Status", "ad_group.status"), campaign] },
  ads: {
    resource: "ad_group_ad", dimensions: [
      f("ad", "Anúncio", "ad_group_ad.ad.name"), f("adId", "ID do anúncio", "ad_group_ad.ad.id"),
      f("type", "Formato", "ad_group_ad.ad.type"), adGroup, campaign,
    ],
  },
  assets: {
    resource: "asset_group", dimensions: [
      f("assetGroup", "Grupo de recursos", "asset_group.name"), f("status", "Status", "asset_group.status"),
      f("strength", "Qualidade dos recursos", "asset_group.ad_strength"), campaign,
    ],
  },
  products: {
    resource: "shopping_performance_view", dimensions: [
      f("product", "Produto", "segments.product_title"), f("productId", "ID do produto", "segments.product_item_id"),
      f("brand", "Marca no feed", "segments.product_brand"), campaign,
    ],
  },
  devices: { resource: "campaign", dimensions: [f("device", "Dispositivo", "segments.device"), campaign] },
  networks: { resource: "campaign", dimensions: [f("network", "Rede", "segments.ad_network_type"), campaign] },
  hours: { resource: "campaign", dimensions: [f("hour", "Hora", "segments.hour", "number"), f("weekday", "Dia da semana", "segments.day_of_week"), campaign] },
  age: { resource: "age_range_view", dimensions: [f("age", "Faixa etária", "ad_group_criterion.age_range.type"), adGroup, campaign] },
  gender: { resource: "gender_view", dimensions: [f("gender", "Gênero", "ad_group_criterion.gender.type"), adGroup, campaign] },
  geography: {
    resource: "geographic_view",
    dimensions: [{ key: "location", label: "Região ou país", type: "text" }, f("locationType", "Tipo de localização", "geographic_view.location_type"), campaign],
    extras: [f("region", "Região", "segments.geo_target_region"), f("country", "País", "geographic_view.country_criterion_id")],
  },
  audiences: {
    resource: "ad_group_audience_view",
    dimensions: [f("audience", "Segmento de público", "ad_group_criterion.display_name"), f("audienceType", "Tipo de segmento", "ad_group_criterion.type"), adGroup, campaign],
  },
  placements: {
    resource: "performance_max_placement_view",
    dimensions: [
      f("placement", "Local de exibição", "performance_max_placement_view.display_name"),
      f("placementType", "Tipo de local", "performance_max_placement_view.placement_type"),
      f("destination", "Endereço publicado", "performance_max_placement_view.placement"), campaign,
    ],
    metrics: [impressions], order: "metrics.impressions",
  },
  conversions: {
    resource: "campaign",
    dimensions: [f("action", "Ação de conversão", "segments.conversion_action_name"), f("category", "Categoria", "segments.conversion_action_category"), campaign],
    metrics: [conversions, value, f("allConversions", "Todas as conversões", "metrics.all_conversions", "number"),
      f("allValue", "Valor de todas as conversões", "metrics.all_conversions_value", "currency")],
    order: "metrics.all_conversions",
  },
  landingPages: {
    resource: "landing_page_view", dimensions: [f("page", "Página de destino", "landing_page_view.unexpanded_final_url"), campaign],
  },
} satisfies Record<string, View>;

type ApiInsightView = keyof typeof views;
export type GoogleAdsInsightView = ApiInsightView | "auctionDomains";
export const googleAdsInsightViews: readonly GoogleAdsInsightView[] = [
  ...Object.keys(views) as ApiInsightView[], "auctionDomains",
];
type InsightResult = GoogleAdsInsightSnapshot & { currency: string; fetchedAt: string | null };
const enumLabels: Record<string, string> = {
  ENABLED: "Ativa", PAUSED: "Pausada", REMOVED: "Removida", EXACT: "Exata", PHRASE: "Frase", BROAD: "Ampla",
  MONDAY: "Segunda", TUESDAY: "Terça", WEDNESDAY: "Quarta", THURSDAY: "Quinta", FRIDAY: "Sexta", SATURDAY: "Sábado", SUNDAY: "Domingo",
  SEARCH: "Pesquisa", SEARCH_PARTNERS: "Parceiros de pesquisa", PERFORMANCE_MAX: "Performance Max",
  DISPLAY: "Display", CONTENT: "Display", SHOPPING: "Shopping", CROSS_NETWORK: "Multirrede",
  YOUTUBE_SEARCH: "Pesquisa no YouTube", YOUTUBE_WATCH: "Vídeos do YouTube",
  MOBILE: "Celular", DESKTOP: "Computador", TABLET: "Tablet", CONNECTED_TV: "TV conectada",
  MALE: "Masculino", FEMALE: "Feminino", PURCHASE: "Compra", PAGE_VIEW: "Visualização de página", BEGIN_CHECKOUT: "Início de checkout",
  LOCATION_OF_PRESENCE: "Presença", AREA_OF_INTEREST: "Interesse",
  RESPONSIVE_SEARCH_AD: "Responsivo de pesquisa", RESPONSIVE_DISPLAY_AD: "Responsivo de display",
  MAXIMIZE_CONVERSION_VALUE: "Maximizar valor de conversão", MAXIMIZE_CONVERSIONS: "Maximizar conversões",
  TARGET_ROAS: "ROAS desejado", TARGET_CPA: "CPA desejado", MANUAL_CPC: "CPC manual",
  POOR: "Baixa", AVERAGE: "Média", GOOD: "Boa", EXCELLENT: "Excelente",
  GOOGLE_PRODUCTS: "Propriedades do Google", WEBSITE: "Site", MOBILE_APPLICATION: "Aplicativo",
  USER_LIST: "Lista de usuários", USER_INTEREST: "Interesse do usuário", COMBINED_AUDIENCE: "Público combinado",
  OTHER: "Outro", UNKNOWN: "Não informado", UNDETERMINED: "Não informado", UNSPECIFIED: "Não informado",
};
const enumKeys = new Set(["match", "status", "channel", "bidStrategy", "type", "strength", "device", "network", "weekday", "age",
  "gender", "locationType", "placementType", "category", "audienceType"]);

function fromField(raw: Record<string, unknown>, name: string) {
  let value: unknown = raw;
  for (const key of name.split(".")) {
    if (!value || typeof value !== "object") return undefined;
    const part = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function normalized(raw: Record<string, unknown>, column: Field) {
  if (!column.field) return null;
  const value = fromField(raw, column.field);
  if (value == null || value === "") return null;
  if (column.type !== "text") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric / (column.scale ?? 1) : null;
  }
  if (typeof value !== "string" && typeof value !== "number") return null;
  const label = String(value);
  if (column.key === "age" && label.startsWith("AGE_RANGE_")) return label.slice(10).replace("_", "–");
  return enumKeys.has(column.key) ? enumLabels[label] ?? label : label;
}

function ratio(numerator: unknown, denominator: unknown) {
  return typeof numerator === "number" && typeof denominator === "number" && denominator > 0 ? numerator / denominator : null;
}

async function resolveGeography(ids: GoogleAdsAccountIds, rows: Row[]) {
  const targets = rows.map((row) => {
    if (typeof row.region === "string" && /^geoTargetConstants\/\d+$/.test(row.region)) return row.region;
    if (/^\d+$/.test(String(row.country))) return "geoTargetConstants/" + row.country;
    return null;
  });
  const unique = Array.from(new Set(targets.filter((name): name is string => Boolean(name))));
  const names = new Map<string, string>();
  for (let offset = 0; offset < unique.length; offset += 250) {
    const filter = unique.slice(offset, offset + 250).map((name) => "'" + name + "'").join(",");
    const query = "SELECT geo_target_constant.resource_name, geo_target_constant.canonical_name FROM geo_target_constant WHERE geo_target_constant.resource_name IN (" + filter + ")";
    for (const row of await searchGoogleAds(ids, query, looseRow)) {
      const key = fromField(row, "geo_target_constant.resource_name");
      const name = fromField(row, "geo_target_constant.canonical_name");
      if (typeof key === "string" && typeof name === "string") names.set(key, name);
    }
  }
  for (const [index, row] of rows.entries()) {
    const target = targets[index];
    row.location = target ? names.get(target) ?? target.replace("geoTargetConstants/", "Localização ") : null;
    delete row.region;
    delete row.country;
  }
}

async function readView(ids: GoogleAdsAccountIds, dates: GoogleAdsDates, viewName: ApiInsightView): Promise<GoogleAdsInsightSnapshot> {
  const view: View = views[viewName];
  const metrics = view.metrics ?? performance;
  const fields = [...view.dimensions, ...metrics, campaignId, ...(view.extras ?? [])];
  const columns = [...view.dimensions, ...metrics].map(({ key, label, type }) => ({ key, label, type }));
  const selected = Array.from(new Set(fields.flatMap(({ field }) => field ? [field] : [])));
  const query = "SELECT " + selected.join(", ") + " FROM " + view.resource +
    " WHERE segments.date BETWEEN '" + dates.dateFrom + "' AND '" + dates.dateTo + "'" +
    " ORDER BY " + (view.order ?? "metrics.cost_micros") + " DESC LIMIT " + batchLimit;
  let raw: Record<string, unknown>[];
  try {
    raw = await searchGoogleAds(ids, query, looseRow);
  } catch (error) {
    if (error instanceof GoogleAdsError && /UNRECOGNIZED_FIELD|PROHIBITED_|NOT_SUPPORTED|NOT_AVAILABLE|UNSUPPORTED|RESOURCE_NOT_ACCESSIBLE|NO_PERMISSION_TO_ACCESS_FIELD/.test(error.message)) {
      return { columns, rows: [], limited: false, state: "unavailable" };
    }
    throw error;
  }
  const rows = raw.map((record) => {
    const row = Object.fromEntries(fields.map((item) => [item.key, normalized(record, item)])) as Row;
    if (!view.metrics) {
      const hasTraffic = [row.impressions, row.clicks, row.spend].some((item) => typeof item === "number");
      if (hasTraffic) {
        row.impressions ??= 0;
        row.clicks ??= 0;
        row.spend ??= 0;
        row.conversions ??= 0;
        row.value ??= 0;
      }
      row.ctr = ratio(row.clicks, row.impressions);
      row.cpc = ratio(row.spend, row.clicks);
      row.cpa = ratio(row.spend, row.conversions);
      row.roas = ratio(row.value, row.spend);
    }
    if (viewName === "ads" && !row.ad) row.ad = row.adId ? "Anúncio " + row.adId : null;
    return row;
  });
  if (viewName === "geography") await resolveGeography(ids, rows);
  return { columns, rows, limited: raw.length === batchLimit, state: "ready" };
}

export async function getGoogleAdsInsight(clientId: string, dates: GoogleAdsDates, view: GoogleAdsInsightView, refresh = false): Promise<InsightResult> {
  const count = (Date.parse(dates.dateTo) - Date.parse(dates.dateFrom)) / 86_400_000 + 1;
  if (!Number.isInteger(count) || count < 1 || count > 366) throw new GoogleAdsError("Selecione um período de 1 a 366 dias.", 400);
  const [connection] = await db.select().from(connections).where(eq(connections.clientId, clientId));
  if (!connection) throw new GoogleAdsError("Conecte a conta Google Ads deste cliente.", 409);
  const [cached] = await db.select().from(snapshots).where(and(
    eq(snapshots.clientId, clientId), eq(snapshots.view, view),
    eq(snapshots.dateFrom, dates.dateFrom), eq(snapshots.dateTo, dates.dateTo),
  ));
  if (view === "auctionDomains") {
    return {
      ...(cached?.data ?? { columns: [], rows: [], limited: false, state: "ready" }),
      currency: connection.currency,
      fetchedAt: cached?.fetchedAt.toISOString() ?? null,
    };
  }
  if (cached && (!googleAdsConfigured() || (!refresh && Date.now() - cached.fetchedAt.getTime() < staleAfter))) {
    return { ...cached.data, currency: connection.currency, fetchedAt: cached.fetchedAt.toISOString() };
  }
  const fetchedAt = new Date();
  const data = await readView(connection, dates, view);
  await db.insert(snapshots).values({ clientId, view, ...dates, data, fetchedAt })
    .onConflictDoUpdate({
      target: [snapshots.clientId, snapshots.view, snapshots.dateFrom, snapshots.dateTo],
      set: { data: sql`excluded.data`, fetchedAt: sql`excluded.fetched_at` },
      setWhere: lt(snapshots.fetchedAt, sql`excluded.fetched_at`),
    });
  return { ...data, currency: connection.currency, fetchedAt: fetchedAt.toISOString() };
}
