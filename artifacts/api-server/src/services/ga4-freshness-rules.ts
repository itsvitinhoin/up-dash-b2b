import { diffDays, saoPauloDate } from "./ga4-daily-rules";

// Regras puras da verificacao "o GA4 esta chegando?" (sem banco nem rede), testaveis isoladamente.
//
// Por que existe: em 03/11/2026 o ga4_daily deixou de rodar (uma imagem sem ele sobrescreveu :latest) e ninguem viu;
// o Google Ads ficou 74 dias parado do mesmo jeito. Quem falha em silencio so e percebido quando alguem olha o numero.
//
// Duas severidades, de proposito:
//  - problem: algo que JA funcionou parou, ou o job nao esta rodando -> o job de verificacao sai com erro (vira alerta).
//  - warning: pendencia de implantacao (cliente cadastrado que nunca conseguiu ler: falta o acesso da conta de servico
//    no GA4) -> aparece no log, mas nao dispara alerta, senao o alerta ficaria vermelho para sempre e ninguem mais olharia.

export type Ga4FreshnessKind =
  | "job_parado" // ninguem tentou o GA4 recentemente
  | "parou_de_atualizar" // ja sincronizou antes, mas nao tem sincronizacao recente (ex.: perdeu o acesso)
  | "nunca_sincronizou" // cadastrado e nunca leu (pendencia, normalmente acesso no GA4)
  | "bigquery_atrasado" // o Postgres esta em dia mas o BigQuery nao
  | "bigquery_sem_dados" // sincronizou no Postgres e nada chegou ao BigQuery
  | "bigquery_indisponivel"; // nao deu para ler o BigQuery, entao nao da para garantir

export type Ga4FreshnessFinding = {
  severity: "problem" | "warning";
  kind: Ga4FreshnessKind;
  clientId: string | null;
  clientName: string | null;
  message: string;
};

export type Ga4ClientHealthInput = {
  clientId: string;
  clientName: string;
  propertyId: string;
  /** Ultima vez que um ga4_daily terminou com sucesso para o cliente (qualquer data). */
  lastDoneAt: Date | null;
  /** Ultima tentativa (qualquer status) e como terminou. */
  lastRunAt: Date | null;
  lastRunStatus: string | null;
  lastError: string | null;
  /** Ultimo dia que o cliente tem em up_global.ga4_daily; null = nenhuma linha. */
  bigQueryLastDay: string | null;
};

export type Ga4FreshnessOptions = {
  now?: Date;
  /** O job roda de hora em hora; 6 deixa passar uma ou outra rodada com problema passageiro. */
  maxAgeHours?: number;
  /** false = BigQuery desligado (GA4_BIGQUERY=0): nao cobra o BigQuery. */
  bigQueryEnabled: boolean;
  /** false = nao foi possivel ler o BigQuery nesta verificacao. */
  bigQueryReadable?: boolean;
};

export const DEFAULT_MAX_AGE_HOURS = 6;

function hoursSince(date: Date, now: Date): number {
  return (now.getTime() - date.getTime()) / 3_600_000;
}

function short(text: string | null, max = 140): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function evaluateGa4Freshness(
  clients: Ga4ClientHealthInput[],
  options: Ga4FreshnessOptions,
): { findings: Ga4FreshnessFinding[]; healthy: number; total: number } {
  const now = options.now ?? new Date();
  const maxAge = options.maxAgeHours && options.maxAgeHours > 0 ? options.maxAgeHours : DEFAULT_MAX_AGE_HOURS;
  const today = saoPauloDate(now);
  const findings: Ga4FreshnessFinding[] = [];
  const unhealthy = new Set<string>();

  const add = (finding: Ga4FreshnessFinding) => {
    findings.push(finding);
    if (finding.severity === "problem" && finding.clientId) unhealthy.add(finding.clientId);
  };

  if (clients.length === 0) return { findings, healthy: 0, total: 0 };

  // 1) O job inteiro: se NINGUEM tentou o GA4 recentemente, o problema e o job, nao os clientes. Um aviso so, nao N.
  const anyRecentRun = clients.some((c) => c.lastRunAt && hoursSince(c.lastRunAt, now) <= maxAge);
  if (!anyRecentRun) {
    findings.push({
      severity: "problem",
      kind: "job_parado",
      clientId: null,
      clientName: null,
      message: `Nenhum cliente teve o GA4 sincronizado nas ultimas ${maxAge}h (${clients.length} cadastrados). O ga4_daily nao esta rodando: confira a imagem de upzero-sync-job-hourly (:latest) e o agendador.`,
    });
    return { findings, healthy: 0, total: clients.length };
  }

  if (options.bigQueryEnabled && options.bigQueryReadable === false) {
    findings.push({
      severity: "problem",
      kind: "bigquery_indisponivel",
      clientId: null,
      clientName: null,
      message: "Nao consegui ler up_global.ga4_daily para conferir o BigQuery.",
    });
  }

  // 2) Cada cliente.
  for (const c of clients) {
    const base = { clientId: c.clientId, clientName: c.clientName };

    if (!c.lastDoneAt) {
      add({
        ...base,
        severity: "warning",
        kind: "nunca_sincronizou",
        message: `${c.clientName} (propriedade ${c.propertyId}) nunca sincronizou o GA4${c.lastError ? `: ${short(c.lastError)}` : ""}. Provavel falta de acesso: a conta de servico precisa ser Leitor da propriedade.`,
      });
      continue;
    }

    const stale = hoursSince(c.lastDoneAt, now) > maxAge;
    if (stale) {
      add({
        ...base,
        severity: "problem",
        kind: "parou_de_atualizar",
        message: `${c.clientName}: ultimo GA4 sincronizado ha ${Math.floor(hoursSince(c.lastDoneAt, now))}h${c.lastRunStatus === "failed" && c.lastError ? `; ultima tentativa falhou: ${short(c.lastError)}` : ""}.`,
      });
      continue; // ja e problema; nao empilhar o do BigQuery
    }

    if (options.bigQueryEnabled && options.bigQueryReadable !== false) {
      if (!c.bigQueryLastDay) {
        add({
          ...base,
          severity: "problem",
          kind: "bigquery_sem_dados",
          message: `${c.clientName}: sincroniza no Postgres mas nao tem nenhuma linha em up_global.ga4_daily.`,
        });
      } else if (diffDays(c.bigQueryLastDay, today) > 1) {
        add({
          ...base,
          severity: "problem",
          kind: "bigquery_atrasado",
          message: `${c.clientName}: o BigQuery esta ate ${c.bigQueryLastDay} (hoje e ${today}); o Postgres esta em dia.`,
        });
      }
    }
  }

  const total = clients.length;
  const healthy = clients.filter((c) => c.lastDoneAt && !unhealthy.has(c.clientId)).length;
  return { findings, healthy, total };
}
