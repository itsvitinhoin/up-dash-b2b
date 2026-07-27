export type DashboardModeValue = "B2B" | "B2C";

export interface DashboardUrlContext {
  clientId: string | null;
  dashboardMode: DashboardModeValue | null;
  dateFrom: string | null;
  dateTo: string | null;
}

export const DASHBOARD_CONTEXT_QUERY_KEYS = [
  "clientId",
  "mode",
  "dashboardMode",
  "dateFrom",
  "dateTo",
] as const;

function trimmedValue(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function isDateOnly(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function parseDashboardUrlContext(search: string): DashboardUrlContext {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const rawMode = trimmedValue(params.get("mode") ?? params.get("dashboardMode"));
  const dashboardMode = rawMode === "B2B" || rawMode === "B2C" ? rawMode : null;
  const rawFrom = trimmedValue(params.get("dateFrom"));
  const rawTo = trimmedValue(params.get("dateTo"));
  const validRange = isDateOnly(rawFrom) && isDateOnly(rawTo) && rawFrom <= rawTo;

  return {
    clientId: trimmedValue(params.get("clientId")),
    dashboardMode,
    dateFrom: validRange ? rawFrom : null,
    dateTo: validRange ? rawTo : null,
  };
}

export function mergeDashboardUrlContext(
  search: string,
  context: Partial<DashboardUrlContext>,
): URLSearchParams {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);

  if (Object.prototype.hasOwnProperty.call(context, "clientId")) {
    if (context.clientId) params.set("clientId", context.clientId);
    else params.delete("clientId");
  }

  if (Object.prototype.hasOwnProperty.call(context, "dashboardMode")) {
    params.delete("dashboardMode");
    if (context.dashboardMode) params.set("mode", context.dashboardMode);
    else params.delete("mode");
  }

  if (Object.prototype.hasOwnProperty.call(context, "dateFrom")) {
    if (context.dateFrom) params.set("dateFrom", context.dateFrom);
    else params.delete("dateFrom");
  }

  if (Object.prototype.hasOwnProperty.call(context, "dateTo")) {
    if (context.dateTo) params.set("dateTo", context.dateTo);
    else params.delete("dateTo");
  }

  return params;
}

export function dateOnlyToLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function localDateToDateOnly(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
