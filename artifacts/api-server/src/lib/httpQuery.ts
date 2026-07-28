import type { Request, Response } from "express";
import { resolveClientId } from "../middlewares/auth";

// Helpers de data/paginação usados por várias rotas de analytics (e agora
// pelos controllers Vesti). Movidos de routes/analytics.ts pra cá pra não
// forçar controllers a importar de dentro de routes/.

export const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function addDaysToDateOnly(value: string, days: number): string {
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function saoPauloDateOnlyStart(value: string): Date {
  return new Date(`${value}T03:00:00.000Z`);
}

export function saoPauloDateOnlyEnd(value: string): Date {
  return new Date(`${addDaysToDateOnly(value, 1)}T02:59:59.999Z`);
}

export function saoPauloDateOnly(value: Date): string {
  return new Date(value.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function queryDateOnly(
  query: Record<string, unknown>,
  key: "dateFrom" | "dateTo",
  fallback: Date,
): string {
  const raw = typeof query[key] === "string" ? query[key] : null;
  return raw && DATE_ONLY_RE.test(raw) ? raw : saoPauloDateOnly(fallback);
}

// Orval generates `zod.date()` for date-time format params, but query strings
// arrive as strings. Coerce the relevant query fields before validation.
export function coerceDateQuery(query: Record<string, unknown>): Record<string, unknown> {
  const out = { ...query };
  for (const key of ["dateFrom", "dateTo", "date"]) {
    const v = out[key];
    if (typeof v === "string" && v.length > 0) {
      if (DATE_ONLY_RE.test(v)) {
        out[key] = key === "dateTo" ? saoPauloDateOnlyEnd(v) : saoPauloDateOnlyStart(v);
        continue;
      }
      const parsed = new Date(v);
      if (!Number.isNaN(parsed.getTime())) {
        out[key] = parsed;
      }
    }
  }
  return out;
}

export function dateRange(
  from: Date | undefined,
  to: Date | undefined,
): { from: Date; to: Date } {
  const now = new Date();
  const defaultTo = to ?? now;
  const defaultFrom = from ?? new Date(defaultTo.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: defaultFrom, to: defaultTo };
}

export function requireClient(req: Request, res: Response): string | null {
  const clientId = resolveClientId(req);
  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "clientId query parameter is required for admin users",
      status: 400,
    });
    return null;
  }
  return clientId;
}
