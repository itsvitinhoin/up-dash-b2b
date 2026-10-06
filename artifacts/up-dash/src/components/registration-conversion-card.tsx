import { format } from "date-fns";
import { TrendingUp } from "lucide-react";
import { useGetFunnel } from "@workspace/api-client-react";
import { SummaryKpiCard } from "@/pages/customers";
import { useAuth } from "@/lib/auth";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { queryOpts } from "@/lib/query-opts";
import { formatPercentage } from "@/lib/formatters";

export function RegistrationConversionCard() {
  const { user, selectedClientId, selectedDashboardMode } = useAuth();
  const { dateRange, filters } = useDashboardFilters();
  const enabled =
    user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);
  const query = useGetFunnel(
    {
      clientId:
        user?.role === "ADMIN" ? selectedClientId || undefined : undefined,
      dateFrom: format(dateRange.from, "yyyy-MM-dd"),
      dateTo: format(dateRange.to, "yyyy-MM-dd"),
      utmSource: filters.utmSource || undefined,
      utmMedium: filters.utmMedium || undefined,
      utmCampaign: filters.utmCampaign || undefined,
    },
    { query: queryOpts({ enabled, placeholderData: (previous) => previous }) },
  );
  return (
    <SummaryKpiCard
      label="Conversão dos Aprovados"
      icon={TrendingUp}
      loading={query.isLoading}
      value={
        query.data && selectedDashboardMode !== "B2C"
          ? formatPercentage(query.data.overallConversion)
          : "—"
      }
    />
  );
}
