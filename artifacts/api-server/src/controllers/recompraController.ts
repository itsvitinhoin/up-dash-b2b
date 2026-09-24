import type { Request, Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, clientsTable } from "@workspace/db";
import { DATE_ONLY_RE, coerceDateQuery, dateRange, queryDateOnly, requireClient } from "../lib/httpQuery";
import { cached } from "../lib/queryCache";
import {
  classifyRecompra,
  classifyRecompraMonthly,
  fetchRecompraHistoryInsights,
  aggregateBlocks,
  buildDetailRows,
  buildSellerRows,
  type RecompraFilters,
  type RecompraTipoFilter,
} from "../services/recompra-analytics";

const RECOMPRA_CACHE_TTL_MS = 5 * 60 * 1000;

// Fase 3 (ver plano salvo): Status/Estado/Vendedora/Tipo/Origem já filtram
// de verdade. Tipo="anuncios-*" exige `upZeroApiKey` do client -- sem
// chave configurada, `classifyRecompra` degrada com `attributionUnavailable`
// em vez de falhar (client sem UpZero ainda pode usar Tipo=ERP/E-commerce).
// `dataset` pode ser null -- diferente do /erp/*, Recompra funciona mesmo
// sem ERP configurado (roda só com o lado site nesse caso).
//
// Fase Vesti (22/09/2026): `vestiDataset` ativa sempre que o client é
// commercePlatform=VESTI -- ~45 dos ~60 clientes ativos são Vesti (venda
// real em dashboard_vendas_view, BigQuery, não em Postgres/pedidos_erp).
// Fase 2 (mesmo dia): o único client Vesti que também tem erpDataset
// (Vogabox) deixou de ser excluído -- validado empiricamente que as duas
// fontes se sobrepõem de verdade (77% de cliente em comum, pedidos
// "gêmeos" reais), então `findRecompraCandidates` agora faz uma ponte de
// identidade via documento entre pedidos_erp e clientes_vesti antes de
// mesclar os dois lados, reaproveitando a dedup mesmo-dia-mesmo-valor já
// existente -- ver plano salvo, "greedy-skipping-reef", Fase 2.
async function resolveRecompraContext(
  req: Request,
  res: Response,
): Promise<{ clientId: string; dataset: string | null; vestiDataset: string | null; upZeroApiKey: string | null } | null> {
  const clientId = requireClient(req, res);
  if (!clientId) return null;
  const [row] = await db
    .select({
      erpDataset: clientsTable.erpDataset,
      upZeroApiKey: clientsTable.upZeroApiKey,
      commercePlatform: clientsTable.commercePlatform,
      bigqueryDataset: clientsTable.bigqueryDataset,
    })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  const dataset = row?.erpDataset ?? null;
  const vestiDataset = row?.commercePlatform === "VESTI" ? row?.bigqueryDataset ?? null : null;
  return { clientId, dataset, vestiDataset, upZeroApiKey: row?.upZeroApiKey ?? null };
}

async function parsedDateRange(req: Request, res: Response): Promise<{ dateFromOnly: string; dateToOnly: string } | null> {
  const rawQuery = req.query as Record<string, unknown>;
  const parsed = z
    .object({ dateFrom: z.date().optional(), dateTo: z.date().optional() })
    .safeParse(coerceDateQuery(rawQuery));
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return null;
  }
  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  return {
    dateFromOnly: queryDateOnly(rawQuery, "dateFrom", from),
    dateToOnly: queryDateOnly(rawQuery, "dateTo", to),
  };
}

const RECOMPRA_TIPO_VALUES = ["erp", "ecommerce", "anuncios-todos", "anuncios-ecommerce", "anuncios-erp"] as const;

const GetRecompraFiltersQueryParams = z.object({
  status: z.enum(["solicitado", "pago", "espera", "cancelado"]).default("pago"),
  tipo: z.enum(RECOMPRA_TIPO_VALUES).default("erp"),
  estado: z.coerce.string().trim().optional(),
  vendedora: z.coerce.string().trim().optional(),
  origem: z.coerce.string().trim().optional(),
});

function parsedFilters(req: Request, res: Response): RecompraFilters | null {
  const parsed = GetRecompraFiltersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return null;
  }
  return {
    status: parsed.data.status,
    tipo: parsed.data.tipo as RecompraTipoFilter,
    estado: parsed.data.estado || undefined,
    vendedora: parsed.data.vendedora || undefined,
    origem: parsed.data.origem || undefined,
  };
}

function filtersCacheKey(filters: RecompraFilters): string {
  return `${filters.status}:${filters.tipo}:${filters.estado ?? ""}:${filters.vendedora ?? ""}:${filters.origem ?? ""}`;
}

export async function getDashboard(req: Request, res: Response): Promise<void> {
  const ctx = await resolveRecompraContext(req, res);
  if (!ctx) return;
  const period = await parsedDateRange(req, res);
  if (!period) return;
  const filters = parsedFilters(req, res);
  if (!filters) return;

  // Fase 5 (23/09/2026): troca de `fetchBlocksCached` (rodava
  // `classifyRecompra` sozinha) pra `fetchClassificationsCached` -- mesma
  // função/cache key que /detail e /sellers já usam, elimina uma chamada
  // duplicada a `classifyRecompra` que /dashboard fazia isolada. `blocks`
  // (via `aggregateBlocks`) já inclui `intervalBuckets` (gráfico "Intervalo
  // entre compras", segue P1/P2 igual ao resto dos blocos).
  const { classifications, unmatchedErpCount, attributionUnavailable } = await fetchClassificationsCached(ctx, period.dateFromOnly, period.dateToOnly, filters);
  const blocks = aggregateBlocks(classifications, unmatchedErpCount, attributionUnavailable);

  // Comparação P1xP2 (opcional): P2 é um recorte independente escolhido
  // pelo usuário no front (ComparisonPeriodPicker), não necessariamente o
  // período anterior de mesma duração -- por isso vem explícito na query,
  // não calculado aqui. Usa os mesmos filtros Status/Estado/Vendedora de P1.
  const compareDateFromRaw = req.query.compareDateFrom;
  const compareDateToRaw = req.query.compareDateTo;
  const hasCompare =
    typeof compareDateFromRaw === "string" && DATE_ONLY_RE.test(compareDateFromRaw) &&
    typeof compareDateToRaw === "string" && DATE_ONLY_RE.test(compareDateToRaw);

  const blocksP2 = hasCompare
    ? await fetchClassificationsCached(ctx, compareDateFromRaw as string, compareDateToRaw as string, filters).then(
        (r) => aggregateBlocks(r.classifications, r.unmatchedErpCount, r.attributionUnavailable),
      )
    : null;

  res.json({
    period: { from: period.dateFromOnly, to: period.dateToOnly },
    comparisonPeriod: hasCompare ? { from: compareDateFromRaw, to: compareDateToRaw } : null,
    blocks,
    blocksP2,
  });
}

const GetRecompraDetailQueryParams = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(5000).default(25),
});

async function fetchClassificationsCached(
  ctx: { clientId: string; dataset: string | null; vestiDataset: string | null; upZeroApiKey: string | null },
  dateFrom: string,
  dateTo: string,
  filters: RecompraFilters,
) {
  return cached(
    `recompra:classifications:${ctx.clientId}:${ctx.dataset ?? "no-erp"}:${ctx.vestiDataset ?? "no-vesti"}:${dateFrom}:${dateTo}:${filtersCacheKey(filters)}`,
    RECOMPRA_CACHE_TTL_MS,
    async () =>
      classifyRecompra({
        clientId: ctx.clientId,
        dataset: ctx.dataset,
        vestiDataset: ctx.vestiDataset,
        upZeroApiKey: ctx.upZeroApiKey,
        dateFrom,
        dateTo,
        filters,
      }),
  );
}

export async function getDetail(req: Request, res: Response): Promise<void> {
  const ctx = await resolveRecompraContext(req, res);
  if (!ctx) return;
  const period = await parsedDateRange(req, res);
  if (!period) return;
  const filters = parsedFilters(req, res);
  if (!filters) return;
  const queryParsed = GetRecompraDetailQueryParams.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: queryParsed.error.message, status: 400 });
    return;
  }
  const { page, limit } = queryParsed.data;

  const { classifications, attributionUnavailable } = await fetchClassificationsCached(ctx, period.dateFromOnly, period.dateToOnly, filters);
  // Ordenado por faturamento no período, maior primeiro -- mesma convenção
  // da tabela de vendedora do PDF (seção 17), útil aqui também pra a linha
  // mais relevante aparecer primeiro.
  const allRows = buildDetailRows(classifications).sort((a, b) => b.faturamentoNoPeriodo - a.faturamentoNoPeriodo);

  const start = (page - 1) * limit;
  res.json({
    period: { from: period.dateFromOnly, to: period.dateToOnly },
    rows: allRows.slice(start, start + limit),
    total: allRows.length,
    page,
    limit,
    attributionUnavailable,
  });
}

// PDF seção 17: reage a Tipo/Status/Origem/Estado/Vendedora/P1 -- não
// recebe P2 (seção 19/20).
export async function getSellers(req: Request, res: Response): Promise<void> {
  const ctx = await resolveRecompraContext(req, res);
  if (!ctx) return;
  const period = await parsedDateRange(req, res);
  if (!period) return;
  const filters = parsedFilters(req, res);
  if (!filters) return;

  const { classifications, attributionUnavailable } = await fetchClassificationsCached(ctx, period.dateFromOnly, period.dateToOnly, filters);
  const rows = buildSellerRows(classifications);

  res.json({
    period: { from: period.dateFromOnly, to: period.dateToOnly },
    rows,
    total: rows.length,
    attributionUnavailable,
  });
}

// Fase 5 (23/09/2026) -- gráficos "Resultado de recompra"/"Volume de
// recompra"/"Recorrentes×Reativados": sempre os últimos 12 meses corridos
// até hoje, reage a Status/Tipo/Origem/Estado/Vendedora igual aos Blocos,
// mas NÃO recebe dateFrom/dateTo (decisão do usuário: janela fixa,
// independente do período (P1) escolhido no topo) nem P2 (não tem um "P2"
// natural pra uma janela já fixa).
export async function getMonthlyTrend(req: Request, res: Response): Promise<void> {
  const ctx = await resolveRecompraContext(req, res);
  if (!ctx) return;
  const filters = parsedFilters(req, res);
  if (!filters) return;

  const { buckets, attributionUnavailable } = await cached(
    `recompra:monthly-trend:${ctx.clientId}:${ctx.dataset ?? "no-erp"}:${ctx.vestiDataset ?? "no-vesti"}:${filtersCacheKey(filters)}`,
    RECOMPRA_CACHE_TTL_MS,
    () =>
      classifyRecompraMonthly({
        clientId: ctx.clientId,
        dataset: ctx.dataset,
        vestiDataset: ctx.vestiDataset,
        upZeroApiKey: ctx.upZeroApiKey,
        filters,
      }),
  );

  res.json({ months: buckets, attributionUnavailable });
}

// Fase 5 (23/09/2026) -- Coorte + Funil de retenção: "visão geral", sem os
// filtros Status/Tipo/Origem/Estado/Vendedora da página (decisão do
// usuário) -- usam a mesma definição de "compra positiva" que o histórico
// já usa em todo o resto do arquivo. As duas vêm da mesma busca cara
// (fetchRecompraHistoryInsights), então dividem a mesma chave de cache.
export async function getHistoryInsights(req: Request, res: Response): Promise<void> {
  const ctx = await resolveRecompraContext(req, res);
  if (!ctx) return;

  const insights = await cached(
    `recompra:history-insights:${ctx.clientId}:${ctx.dataset ?? "no-erp"}:${ctx.vestiDataset ?? "no-vesti"}`,
    RECOMPRA_CACHE_TTL_MS,
    () =>
      fetchRecompraHistoryInsights({
        clientId: ctx.clientId,
        dataset: ctx.dataset,
        vestiDataset: ctx.vestiDataset,
      }),
  );

  res.json(insights);
}
