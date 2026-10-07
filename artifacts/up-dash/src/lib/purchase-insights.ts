import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { useDashboardFilters } from "@/lib/dashboard-filters";
export type BaseEvolutionStep = { label: string; customers: number; basePct: number | null; continuationPct: number | null; revenue: number; accumulatedRevenue: number };
export type ConversionVelocity = { sampleSize: number; cohortSize: number; missingApproval: number; invalidChronology: number; buckets: { label: string; customers: number; pct: number | null }[]; firstWeekCount: number; firstWeekPct: number | null; within30Count: number; within30Pct: number | null; medianDays: number | null; averageDays: number | null };
export type MonthlyCohort = { rows: { month: string; customers: number; retention: (number | null)[] }[]; observedThrough: string };
export type PurchaseInsights = { monthlyCohort?: MonthlyCohort; funnel: { compra: string; clientes: number; retencao: number }[]; cohort: { mes: string; clientes: number; d30: number | null; d60: number | null; d90: number | null; d180: number | null; hoje: number | null }[]; baseEvolution?: BaseEvolutionStep[]; conversionVelocity?: ConversionVelocity; period?: { dateFrom: string; dateTo: string } };
export function usePurchaseInsights() {
  const { user, selectedClientId } = useAuth();
  const { dateRange } = useDashboardFilters();
  const clientId = user?.role === "ADMIN" ? selectedClientId : user?.clientId;
  const dateFrom = format(dateRange.from, "yyyy-MM-dd"), dateTo = format(dateRange.to, "yyyy-MM-dd");
  const params = new URLSearchParams({ dateFrom, dateTo });
  if (clientId) params.set("clientId", clientId);
  return useQuery<PurchaseInsights>({ queryKey: ["recompra-history-insights", clientId, dateFrom, dateTo], queryFn: () => customFetch(`/api/analytics/recompra/history-insights?${params}`), enabled: Boolean(clientId), staleTime: 120_000, refetchOnWindowFocus: false });
}
