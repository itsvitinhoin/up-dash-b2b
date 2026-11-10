import { diffDays, saoPauloDate } from "./ga4-daily-rules";

// Regras puras da verificacao "o GA4 esta chegando?" (sem banco nem rede), testaveis isoladamente.
//
// Por que existe: em 03/11/2026 o ga4_daily deixou de rodar (uma imagem sem ele sobrescreveu :latest) e ninguem viu;
// o Google Ads ficou 74 dias parado do mesmo jeito. Quem falha em silencio so e percebido quando alguem olha o numero.
//
// Duas severidades, de proposito:
//  - problem: algo que JA funcionou parou, ou o job nao esta rodando -> o job de verificacao sai com erro (vira alerta).
//  - warning: pendencia de implantacao (cliente cadastrado que nunca conseguiu ler: falta o acesso da conta da agencia
//    no GA4) -> aparece no log, mas nao dispara alerta, senao o alerta ficaria vermelho para sempre e ninguem mais olharia.
//
// Trafego (06-09/11/2026): sincronizar nao basta. O Sooe ficou 3 semanas gravando ZEROS porque a marca trocou de propriedade
// do GA4 em 15/10 e ninguem percebeu; Vn11 e Obzee foram cadastrados com uma propriedade que nunca recebeu visitas. Zero
// gravado nao e dado: parece uma loja parada. Por isso o alerta olha tambem se a propriedade AINDA recebe sessoes, com a mesma
// regra de nao ficar vermelho para sempre: so e PROBLEMA enquanto e novidade (cadastro recente, ou parou ha pouco);
// depois que vira conhecido (ex.: Vn11, parado desde dez/2025) passa a aviso.
//
// Origem do trafego (10/11/2026): up_global.ga4_traffic_daily e gravada de forma ISOLADA (se ela falha, o diario e os produtos seguem em
// dia e o job termina "done"). Sem olhar a propria tabela, uma falha so dela ficaria invisivel: o numero de visitas e o de produtos
// continuariam chegando, e a tabela de onde veio cada venda pararia de andar. O job deixa em sync_jobs.result.trafficTo o ultimo dia
// gravado com sucesso; aqui se olha QUANDO foi a ultima gravacao. Mesma regra de nao ficar vermelho para sempre: depois de
// stoppedAlertDays vira aviso (ja e conhecido).

/** Conta que precisa ser Leitor da propriedade (a que o job usa para ler; a conta de servico e so reserva). */
export const GA4_AGENCY_READER = "upagency.oficial@gmail.com";

export type Ga4FreshnessKind =
  | "job_parado" // ninguem tentou o GA4 recentemente
  | "parou_de_atualizar" // ja sincronizou antes, mas nao tem sincronizacao recente (ex.: perdeu o acesso)
  | "nunca_sincronizou" // cadastrado e nunca leu (pendencia, normalmente acesso no GA4)
  | "sem_trafego_novo" // cadastrado ha pouco e sem visita nenhuma recente: quase sempre o ID da propriedade esta errado
  | "parou_trafego" // tinha visitas e parou ha pouco: o site pode ter trocado de GA4
  | "sem_trafego" // sem visitas ha bastante tempo (pendencia ja conhecida)
  | "origem_trafego_parada" // o GA4 sincroniza em dia, mas a origem do trafego (ga4_traffic_daily) nao esta sendo gravada
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
  /** Quantos dias o cliente tem guardados em ga4_daily_metrics. Sem isso (ou 0) a regra de trafego nao julga: o backfill ainda nao terminou. */
  storedDays?: number;
  /** Primeira vez que algo foi guardado para o cliente (MIN(synced_at)): aproxima "quando foi cadastrado". */
  firstSyncedAt?: Date | null;
  /** Ultimo dia (YYYY-MM-DD) com sessoes > 0 entre os dias guardados; null = nenhum dia teve visita. */
  lastTrafficDay?: string | null;
  /**
   * Quando a origem do trafego (up_global.ga4_traffic_daily) foi gravada com sucesso pela ultima vez: o ga4_daily terminou e deixou
   * sync_jobs.result.trafficTo. null = nunca. undefined = nao deu para ler (a regra nao julga).
   */
  trafficOriginLastOkAt?: Date | null;
  /** Erro da origem do trafego na rodada concluida mais recente (sync_jobs.result.trafficError); null = nenhum registrado. */
  trafficOriginError?: string | null;
};

export type Ga4FreshnessOptions = {
  now?: Date;
  /** O job roda de hora em hora; 6 deixa passar uma ou outra rodada com problema passageiro. */
  maxAgeHours?: number;
  /** false = BigQuery desligado (GA4_BIGQUERY=0): nao cobra o BigQuery. */
  bigQueryEnabled: boolean;
  /** false = nao foi possivel ler o BigQuery nesta verificacao. */
  bigQueryReadable?: boolean;
  /** Dias seguidos sem nenhuma sessao para considerar a propriedade parada (padrao 7). */
  noTrafficDays?: number;
  /** Ate quantos dias depois de parar ainda e PROBLEMA; depois vira aviso, porque ja e conhecido (padrao 21). */
  stoppedAlertDays?: number;
  /** Por quantos dias um cliente recem-cadastrado e sem visitas e PROBLEMA (padrao 3). */
  newClientDays?: number;
};

export const DEFAULT_MAX_AGE_HOURS = 6;
export const DEFAULT_NO_TRAFFIC_DAYS = 7;
export const DEFAULT_STOPPED_ALERT_DAYS = 21;
export const DEFAULT_NEW_CLIENT_DAYS = 3;

function positiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function hoursSince(date: Date, now: Date): number {
  return (now.getTime() - date.getTime()) / 3_600_000;
}

function short(text: string | null, max = 140): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

// "A propriedade ainda recebe visitas?" Olha so os dias guardados (Postgres). Devolve null quando esta tudo bem ou quando ainda
// nao da para julgar (sem historico guardado: o backfill de 400 dias ainda nao terminou).
function trafficFinding(
  c: Ga4ClientHealthInput,
  now: Date,
  today: string,
  cfg: { noTrafficDays: number; stoppedAlertDays: number; newClientDays: number },
): Omit<Ga4FreshnessFinding, "clientId" | "clientName"> | null {
  if (!c.storedDays || c.storedDays <= 0) return null;

  // Dias desde a ultima visita (0 = hoje). null = nenhum dia guardado teve visita.
  const quietDays = c.lastTrafficDay ? diffDays(c.lastTrafficDay, today) : null;
  if (quietDays !== null && quietDays < cfg.noTrafficDays) return null;

  const last = c.lastTrafficDay ? ` (ultimo dia com visitas: ${c.lastTrafficDay})` : " (nenhum dia guardado teve visitas)";
  const newlyRegistered = c.firstSyncedAt ? hoursSince(c.firstSyncedAt, now) <= cfg.newClientDays * 24 : false;

  if (newlyRegistered) {
    return {
      severity: "problem",
      kind: "sem_trafego_novo",
      message: `${c.clientName}: propriedade ${c.propertyId} recem-cadastrada e sem visitas nos ultimos ${cfg.noTrafficDays} dias${last}. Quase sempre e o ID da propriedade errado: confira o G-... da etiqueta do site do cliente e a propriedade que tem esse G-... .`,
    };
  }
  if (quietDays !== null && quietDays <= cfg.stoppedAlertDays) {
    return {
      severity: "problem",
      kind: "parou_trafego",
      message: `${c.clientName}: a propriedade ${c.propertyId} parou de receber visitas ha ${quietDays} dias${last}. O site pode ter trocado de GA4: confira o G-... da etiqueta do site e troque a propriedade do cliente.`,
    };
  }
  return {
    severity: "warning",
    kind: "sem_trafego",
    message: `${c.clientName}: a propriedade ${c.propertyId} esta sem visitas${quietDays !== null ? ` ha ${quietDays} dias` : ""}${last}. Os numeros guardados dela sao zeros, nao dados: acerte a propriedade ou tire o cliente do GA4.`,
  };
}

function stamp(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// "A origem do trafego esta sendo gravada?" Devolve null quando esta tudo bem ou quando ainda nao da para julgar (nao foi possivel
// ler, ou o cliente e novo demais para dizer "ha quanto tempo": sem ultima gravacao e sem inicio de historico).
function trafficOriginFinding(
  c: Ga4ClientHealthInput,
  now: Date,
  cfg: { maxAge: number; stoppedAlertDays: number },
): Omit<Ga4FreshnessFinding, "clientId" | "clientName"> | null {
  if (c.trafficOriginLastOkAt === undefined) return null;
  // Referencia: a ultima gravacao. Se nunca gravou, o comeco do historico do cliente: ate maxAge horas depois dele ainda e a primeira
  // rodada (ou uma falha passageira), e nao um problema.
  const reference = c.trafficOriginLastOkAt ?? c.firstSyncedAt ?? null;
  if (!reference) return null;
  const ageHours = hoursSince(reference, now);
  if (ageHours <= cfg.maxAge) return null;

  const where = c.trafficOriginLastOkAt
    ? `nao e gravada ha ${Math.floor(ageHours)}h (ultima gravacao: ${stamp(reference)})`
    : `nunca foi gravada (o cliente sincroniza o GA4 desde ${stamp(reference)})`;
  const known = ageHours / 24 > cfg.stoppedAlertDays;
  const why = c.trafficOriginError
    ? `Ultimo erro: ${short(c.trafficOriginError)}.`
    : "Nenhum erro registrado: a rodada pode nem ter tentado (BigQuery fora do ar naquela rodada).";
  return {
    severity: known ? "warning" : "problem",
    kind: "origem_trafego_parada",
    message: `${c.clientName}: a origem do trafego (up_global.ga4_traffic_daily) ${where}, embora o resto do GA4 sincronize em dia${known ? " (ja e conhecido)" : ""}. ${why} Procure "[ga4-daily] origem do trafego nao gravada" no log do upzero-sync-job-hourly e sync_jobs.result.trafficError.`,
  };
}

export function evaluateGa4Freshness(
  clients: Ga4ClientHealthInput[],
  options: Ga4FreshnessOptions,
): { findings: Ga4FreshnessFinding[]; healthy: number; total: number } {
  const now = options.now ?? new Date();
  const maxAge = options.maxAgeHours && options.maxAgeHours > 0 ? options.maxAgeHours : DEFAULT_MAX_AGE_HOURS;
  const trafficCfg = {
    noTrafficDays: positiveOr(options.noTrafficDays, DEFAULT_NO_TRAFFIC_DAYS),
    stoppedAlertDays: positiveOr(options.stoppedAlertDays, DEFAULT_STOPPED_ALERT_DAYS),
    newClientDays: positiveOr(options.newClientDays, DEFAULT_NEW_CLIENT_DAYS),
  };
  const today = saoPauloDate(now);
  const findings: Ga4FreshnessFinding[] = [];
  const unhealthy = new Set<string>();
  // Cliente sem visitas (aviso ou problema) nao conta como saudavel: sincroniza, mas os numeros dele sao zeros.
  const quiet = new Set<string>();

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
        message: `${c.clientName} (propriedade ${c.propertyId}) nunca sincronizou o GA4${c.lastError ? `: ${short(c.lastError)}` : ""}. Provavel falta de acesso: a conta ${GA4_AGENCY_READER} precisa ser Leitor da propriedade (ou o ID da propriedade esta errado).`,
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

    let bigQueryProblem = false;
    if (options.bigQueryEnabled && options.bigQueryReadable !== false) {
      if (!c.bigQueryLastDay) {
        bigQueryProblem = true;
        add({
          ...base,
          severity: "problem",
          kind: "bigquery_sem_dados",
          message: `${c.clientName}: sincroniza no Postgres mas nao tem nenhuma linha em up_global.ga4_daily.`,
        });
      } else if (diffDays(c.bigQueryLastDay, today) > 1) {
        bigQueryProblem = true;
        add({
          ...base,
          severity: "problem",
          kind: "bigquery_atrasado",
          message: `${c.clientName}: o BigQuery esta ate ${c.bigQueryLastDay} (hoje e ${today}); o Postgres esta em dia.`,
        });
      }

      // A origem do trafego e uma tabela a parte, gravada de forma isolada: o diario pode estar em dia e ela nao. Nao empilha em cima de
      // um problema do BigQuery do mesmo cliente (a causa e a mesma) nem quando o BigQuery nao pode ser lido (ja e UM problema do job).
      if (!bigQueryProblem) {
        const origin = trafficOriginFinding(c, now, { maxAge, stoppedAlertDays: trafficCfg.stoppedAlertDays });
        if (origin) {
          add({ ...base, ...origin });
          quiet.add(c.clientId);
        }
      }
    }

    // Sincronizou em dia; agora: a propriedade ainda recebe visitas?
    const traffic = trafficFinding(c, now, today, trafficCfg);
    if (traffic) {
      add({ ...base, ...traffic });
      quiet.add(c.clientId);
    }
  }

  const total = clients.length;
  const healthy = clients.filter((c) => c.lastDoneAt && !unhealthy.has(c.clientId) && !quiet.has(c.clientId)).length;
  return { findings, healthy, total };
}
