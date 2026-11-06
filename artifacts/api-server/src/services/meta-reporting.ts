import {
  saoPauloDateOnlyStart,
  saoPauloDateOnlyEnd,
  saoPauloDateOnly,
} from "../lib/reporting-period";

export const REPORTING_TIME_ZONE = "America/Sao_Paulo";

function localParts(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map(({ type, value }) => [type, value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

export function accountHourInstant(
  date: string,
  hour: number,
  timeZone: string,
): Date {
  const target = Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
  let instant = target;
  for (let i = 0; i < 4; i++) {
    const p = localParts(new Date(instant), timeZone);
    const represented = Date.parse(
      `${p.date}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}:${String(p.second).padStart(2, "0")}Z`,
    );
    if (represented === target) return new Date(instant);
    instant += target - represented;
  }
  throw new Error(
    "Não foi possível alinhar a hora da conta Meta ao relatório.",
  );
}

export function metaReportingWindow(
  since: string,
  until: string,
  accountTimeZone: string,
) {
  const from = saoPauloDateOnlyStart(since);
  const to = saoPauloDateOnlyEnd(until);
  if (
    !Number.isFinite(from.getTime()) ||
    !Number.isFinite(to.getTime()) ||
    from > to
  )
    throw new Error("Período de mídia inválido.");
  const first = localParts(from, accountTimeZone);
  const last = localParts(to, accountTimeZone);
  // Hourly Insights cannot precisely split a partial hour: report unavailable instead of estimating.
  if (first.minute !== 0 || last.minute !== 59)
    throw new Error(
      "O fuso da conta Meta exige um recorte menor que uma hora, indisponível neste relatório.",
    );
  return {
    from,
    to,
    since: first.date,
    until: last.date,
    hourly:
      first.hour !== 0 ||
      last.hour !== 23 ||
      first.date !== since ||
      last.date !== until,
  };
}

export type AdditiveInsight = {
  ad_id?: string;
  ad_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  date_start: string;
  date_stop: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  inline_link_clicks?: string;
  hourly_stats_aggregated_by_advertiser_time_zone?: string;
  actions?: { action_type?: string; value?: string }[];
  action_values?: { action_type?: string; value?: string }[];
};

export function spendCents(value: unknown): number {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value))
    throw new Error("O Meta não retornou um valor de investimento válido.");
  const cents = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(cents))
    throw new Error("Investimento Meta fora do intervalo suportado.");
  return cents;
}

/** One delivery dataset feeds the card, daily series, campaign rows and ad rows. */
export function aggregateMetaInsights(
  rows: AdditiveInsight[],
  since: string,
  until: string,
  accountTimeZone: string,
) {
  const window = metaReportingWindow(since, until, accountTimeZone);
  const included = rows.flatMap((row) => {
    let date = row.date_start;
    if (window.hourly) {
      const match = /^(\d{2}):00:00 - \d{2}:59:59$/.exec(
        row.hourly_stats_aggregated_by_advertiser_time_zone ?? "",
      );
      if (!match || Number(match[1]) > 23)
        throw new Error("Leitura horária do Meta incompleta.");
      const instant = accountHourInstant(
        row.date_start,
        Number(match[1]),
        accountTimeZone,
      );
      if (instant < window.from || instant > window.to) return [];
      date = saoPauloDateOnly(instant);
    }
    if (date < since || date > until) return [];
    spendCents(row.spend);
    if (!row.ad_id || !row.campaign_id)
      throw new Error(
        "O Meta retornou investimento sem identificação de anúncio/campanha.",
      );
    return [{ ...row, date_start: date, date_stop: date }];
  });
  const group = (key: (row: AdditiveInsight) => string) => {
    const groups = new Map<string, AdditiveInsight>();
    for (const row of included) {
      const id = key(row);
      let total = groups.get(id);
      if (!total) {
        total = {
          ...row,
          spend: "0",
          impressions: "0",
          clicks: "0",
          inline_link_clicks: "0",
          actions: [],
          action_values: [],
        };
        groups.set(id, total);
      }
      total.spend = (
        (spendCents(total.spend) + spendCents(row.spend)) /
        100
      ).toFixed(2);
      for (const field of [
        "impressions",
        "clicks",
        "inline_link_clicks",
      ] as const) {
        total[field] = String(
          Number(total[field] ?? 0) +
            Number(
              row[field] ??
                (field === "inline_link_clicks" ? row.clicks : 0) ??
                0,
            ),
        );
      }
      for (const field of ["actions", "action_values"] as const) {
        const merged = new Map(
          (total[field] ?? []).map((action) => [
            action.action_type,
            Number(action.value ?? 0),
          ]),
        );
        for (const action of row[field] ?? [])
          merged.set(
            action.action_type,
            (merged.get(action.action_type) ?? 0) + Number(action.value ?? 0),
          );
        total[field] = [...merged].map(([action_type, value]) => ({
          action_type,
          value: String(value),
        }));
      }
      if (row.date_start < total.date_start) total.date_start = row.date_start;
      if (row.date_stop > total.date_stop) total.date_stop = row.date_stop;
    }
    return [...groups.values()];
  };
  return {
    daily: group((row) => row.date_start).sort((a, b) =>
      a.date_start.localeCompare(b.date_start),
    ),
    ads: group((row) => row.ad_id!),
    campaigns: group((row) => row.campaign_id!).map((row) => ({
      ...row,
      ad_id: undefined,
      ad_name: undefined,
    })),
  };
}
