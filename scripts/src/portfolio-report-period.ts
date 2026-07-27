export const REPORT_TIMEZONE = "America/Sao_Paulo";

export interface AutomaticReportPeriod {
  reportDate: string;
  dateFrom: string | null;
  dateTo: string | null;
  periodType: "daily" | "weekend" | "skip";
  skip: boolean;
  reason: string | null;
}

function dateOnlyInTimeZone(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return `${map.get("year")}-${map.get("month")}-${map.get("day")}`;
}

function weekdayInTimeZone(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(value);
}

function addDays(value: string, amount: number): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

export function computeAutomaticReportPeriod(
  now = new Date(),
  timeZone = REPORT_TIMEZONE,
): AutomaticReportPeriod {
  const reportDate = dateOnlyInTimeZone(now, timeZone);
  const weekday = weekdayInTimeZone(now, timeZone);

  if (weekday === "Sat" || weekday === "Sun") {
    return {
      reportDate,
      dateFrom: null,
      dateTo: null,
      periodType: "skip",
      skip: true,
      reason: "Relatórios automáticos não são gerados aos sábados ou domingos.",
    };
  }

  if (weekday === "Mon") {
    return {
      reportDate,
      dateFrom: addDays(reportDate, -3),
      dateTo: addDays(reportDate, -1),
      periodType: "weekend",
      skip: false,
      reason: null,
    };
  }

  const yesterday = addDays(reportDate, -1);
  return {
    reportDate,
    dateFrom: yesterday,
    dateTo: yesterday,
    periodType: "daily",
    skip: false,
    reason: null,
  };
}
