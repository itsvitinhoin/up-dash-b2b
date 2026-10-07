import { useLocation } from "wouter";
import { createContext, useContext, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
export type MetricComparisonData = { current: number | null | undefined; previous: number | null | undefined; format?: (value: number) => string; source?: string };
const MetricDataContext = createContext<{ source?: string; comparisons: Record<string, MetricComparisonData> }>({ comparisons: {} });
export function MetricDataProvider({ source, comparisons, children }: { source: string; comparisons: Record<string, MetricComparisonData>; children: ReactNode }) {
  return <MetricDataContext.Provider value={{ source, comparisons }}>{children}</MetricDataContext.Provider>;
}
export function useMetricData(key: string) {
  const context = useContext(MetricDataContext);
  const [path] = useLocation();
  const { tx } = useI18n();
  const reportSource = path.startsWith("/erp") ? "ERP conectado" : path.startsWith("/whatsapp") ? "WhatsApp · conversas e atendimento" : path.startsWith("/performance/anuncios") || path.startsWith("/marketing") ? "Meta Ads · Google Ads · UP Zero" : path.startsWith("/performance") ? "ERP · Ecommerce · mídia" : path.startsWith("/stock") || path.includes("produt") ? "Ecommerce · catálogo e estoque" : path.includes("cliente") || path.includes("clients") || path.includes("customer") || path.includes("rfm") || path.includes("funnel") || path.includes("utm") || path.includes("journey") ? "Ecommerce · cadastros e eventos" : path.startsWith("/admin") || path.includes("extraction") || path.includes("orchestrator") ? "Registros do UP Dash" : "Ecommerce · dados conectados do relatório";
  return { ...context.comparisons[key], source: tx(context.comparisons[key]?.source ?? context.source ?? reportSource) };
}

export function metricBindings<T extends object>(current: T | undefined, previous: T | undefined, fields: Record<string, { field: keyof T; format?: (value: number) => string }>): Record<string, MetricComparisonData> {
  return Object.fromEntries(Object.entries(fields).map(([key, config]) => {
    const value = current?.[config.field], prior = previous?.[config.field];
    return [key, { current: typeof value === "number" ? value : null, previous: typeof prior === "number" ? prior : undefined, format: config.format }];
  }));
}
