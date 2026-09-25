// Regra `onlyAttributed` do dashboard legado (C:\trabalho\backend-dash),
// variante da tela Retenção (dashboardPerformanceService.ts:4454-4531).
// Extraída de recompra-analytics.ts em 23/09/2026 (Fase 4) -- até então só
// a Recompra usava a regra completa (as duas fontes + barreira de data);
// fetchVestiAttributedCustomers/fetchVestiMarketingData/fetchVestiUtmData
// (vestiAnalytics.ts) e matchErpDocumentsWithVestiAttribution
// (erpAnalytics.ts) faziam cada uma sua própria versão incompleta. Ver
// C:\Users\MarceloH\.claude\plans\greedy-fluttering-cupcake.md, Fase 4.
//
// Um pedido é atribuído se o documento do cliente (só dígitos) está:
//   1) em clientes_vesti com utm_source LIKE '%up_agency%' (cadastro via
//      link da agência), sem gate de data; OU
//   2) em clientes_atribuidos_consolidados.cnpj (tocado por anúncio,
//      consolidado por um job externo) E a data do pedido é >= data de
//      início da marca. Sem data de início, o gate não se aplica.
// Documento nulo ou vazio nunca é atribuído (no SQL legado, NULL IN (...)
// é falso). O legado tem outras variantes em outras telas (Resumo/Clientes
// exigem o consolidado e usam up_agency só pra dispensar a data); a
// Recompra (e agora as outras 3 telas) usa esta.
//
// Data de início: cópia fiel de backend-dash/src/jobs/fillAttributionStartDate.ts,
// que é de onde vêm os valores gravados em User.attributionStartDate no
// banco do legado (o up-dash-b2b não acessa esse banco). Mesma resolução:
// "DATA DE INICIO DA MARCA" usa data_inicio; senão, a data UTC de
// consideredDate cortada em YYYY-MM-DD, como toISODateOnly em
// backend-dash/src/utils/attributionStartDate.ts. Dataset fora da lista não
// tem gate, igual ao legado quando o User não tem ga4Tid. Se a data mudar
// pelo admin do backend-dash, esta lista precisa ser atualizada à mão.
// Conferida contra o banco de produção do legado em 23/09/2026 (database
// "vesti-database"): as 24 linhas do job batem exatamente, e a
// "banoffe_brand" foi cadastrada direto pelo admin (fora do job).
import { bigquery, vestiTable } from "../lib/bigquery";

export const ATTRIBUTION_START_ROWS: Array<{ dataset: string; dataInicio: string; consideredDate: string }> = [
  { dataset: "vn11", dataInicio: "2025-06-05", consideredDate: "2025-08-29 16:41:59.165000 UTC" },
  { dataset: "tuba_plus", dataInicio: "2026-03-09", consideredDate: "2025-08-29 16:41:59.165000 UTC" },
  { dataset: "obzee", dataInicio: "2024-09-10", consideredDate: "2025-08-29 16:41:59.165000 UTC" },
  { dataset: "milalai", dataInicio: "2026-02-27", consideredDate: "2025-08-29 16:41:59.165000 UTC" },
  { dataset: "cocci", dataInicio: "2026-02-03", consideredDate: "2025-08-29 16:41:59.165000 UTC" },
  { dataset: "lipcem", dataInicio: "2025-06-13", consideredDate: "2025-08-29 16:41:59.165000 UTC" },
  { dataset: "afetto", dataInicio: "2026-02-12", consideredDate: "2025-08-29 16:41:59.165000 UTC" },
  { dataset: "aurami", dataInicio: "2025-10-21", consideredDate: "2025-08-29 16:41:59.165000 UTC" },
  { dataset: "sessi", dataInicio: "2026-02-19", consideredDate: "2025-08-29 16:41:59.165000 UTC" },
  { dataset: "estime", dataInicio: "2024-09-05", consideredDate: "2025-08-29 16:41:59.165000 UTC" },
  { dataset: "mazarin", dataInicio: "2026-05-15", consideredDate: "DATA DE INICIO DA MARCA" },
  { dataset: "namine", dataInicio: "2026-05-25", consideredDate: "2026-06-03 19:31:42.358000 UTC" },
  { dataset: "venoro", dataInicio: "2026-03-03", consideredDate: "DATA DE INICIO DA MARCA" },
  { dataset: "hirus", dataInicio: "2025-09-19", consideredDate: "DATA DE INICIO DA MARCA" },
  { dataset: "sline", dataInicio: "2025-01-31", consideredDate: "2025-08-29 16:41:59.165000 UTC" },
  { dataset: "coqueta", dataInicio: "2023-08-28", consideredDate: "2025-08-29 16:42:13.544000 UTC" },
  { dataset: "fiore", dataInicio: "2025-05-23", consideredDate: "2025-08-29 16:43:37.377000 UTC" },
  { dataset: "doce_deleite", dataInicio: "2025-08-01", consideredDate: "2025-08-29 16:41:59.165000 UTC" },
  { dataset: "adama", dataInicio: "2024-03-19", consideredDate: "2025-08-29 16:41:59.165000 UTC" },
  { dataset: "vogabox", dataInicio: "2025-09-22", consideredDate: "DATA DE INICIO DA MARCA" },
  { dataset: "bluebeni", dataInicio: "2025-05-09", consideredDate: "2025-08-29 16:53:44.370000 UTC" },
  { dataset: "le_ricard", dataInicio: "2024-05-07", consideredDate: "2025-08-29 16:42:08.055000 UTC" },
  { dataset: "charisma", dataInicio: "2025-06-09", consideredDate: "2025-08-29 16:41:58.474000 UTC" },
  { dataset: "incentive", dataInicio: "2023-08-08", consideredDate: "2025-08-29 16:44:41.041000 UTC" },
  // Fora do job: cadastrada direto pelo admin do backend-dash (User.
  // attributionStartDate = 2026-09-18).
  { dataset: "banoffe_brand", dataInicio: "2026-09-18", consideredDate: "DATA DE INICIO DA MARCA" },
];

export function resolveAttributionStartDate(dataset: string): string | null {
  const row = ATTRIBUTION_START_ROWS.find((r) => r.dataset === dataset);
  if (!row) return null;
  const date = row.consideredDate === "DATA DE INICIO DA MARCA"
    ? new Date(`${row.dataInicio}T00:00:00Z`)
    : new Date(row.consideredDate.replace(" ", "T").replace(" UTC", "Z"));
  return date.toISOString().slice(0, 10);
}

export type VestiAttributionSets = {
  upAgencyDocs: Set<string>;
  consolidatedDocs: Set<string>;
  startDate: string | null; // YYYY-MM-DD
};

export async function fetchVestiAttributionSets(vestiDataset: string): Promise<VestiAttributionSets> {
  const clientesVesti = vestiTable(vestiDataset, "clientes_vesti");
  const consolidados = vestiTable(vestiDataset, "clientes_atribuidos_consolidados");
  const [upAgencyRows, consolidatedRows] = await Promise.all([
    bigquery
      .query({
        query: `
          SELECT DISTINCT doc FROM (
            SELECT TRIM(REGEXP_REPLACE(CAST(document AS STRING), r'\\D', '')) AS doc
            FROM ${clientesVesti}
            WHERE utm_source LIKE '%up_agency%'
          )
          WHERE doc IS NOT NULL AND doc != ''
        `,
      })
      .then(([rows]) => rows as Array<{ doc: string }>)
      .catch((err: unknown) => {
        // Achado 25/09/2026: cliente ERP puro (ex: MX Fashion) não tem a
        // tabela clientes_vesti nesse dataset -- só validado ao vivo antes
        // com Le Ricard/Vogabox (que têm Vesti). Sem este catch, o erro do
        // BigQuery ("table not found") derrubava o Promise.all inteiro e
        // quebrava a tela de Performance com 500 pra qualquer client ERP.
        console.warn("[vesti-attribution] clientes_vesti indisponível:", err instanceof Error ? err.message : err);
        return [] as Array<{ doc: string }>;
      }),
    bigquery
      .query({
        query: `
          SELECT DISTINCT doc FROM (
            SELECT TRIM(REGEXP_REPLACE(CAST(cnpj AS STRING), r'\\D', '')) AS doc
            FROM ${consolidados}
          )
          WHERE doc IS NOT NULL AND doc != ''
        `,
      })
      .then(([rows]) => rows as Array<{ doc: string }>)
      .catch((err: unknown) => {
        // Dataset sem o pipeline de atribuição da agência não tem essa
        // tabela; conta como "nenhum cliente consolidado", não como erro.
        console.warn("[vesti-attribution] clientes_atribuidos_consolidados indisponível:", err instanceof Error ? err.message : err);
        return [] as Array<{ doc: string }>;
      }),
  ]);
  return {
    upAgencyDocs: new Set(upAgencyRows.map((r) => r.doc)),
    consolidatedDocs: new Set(consolidatedRows.map((r) => r.doc)),
    startDate: resolveAttributionStartDate(vestiDataset),
  };
}

export function isOnlyAttributed(doc: string | null, orderDate: Date | string, sets: VestiAttributionSets): boolean {
  if (!doc) return false;
  if (sets.upAgencyDocs.has(doc)) return true;
  if (!sets.consolidatedDocs.has(doc)) return false;
  const dateStr = typeof orderDate === "string" ? orderDate.slice(0, 10) : orderDate.toISOString().slice(0, 10);
  return sets.startDate === null || dateStr >= sets.startDate;
}
