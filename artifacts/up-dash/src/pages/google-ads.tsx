import { AdsNavigation } from "@/components/ads-navigation";
import { GoogleAdsReport } from "@/components/google-ads-report";
import { useAuth } from "@/lib/auth";
import { localDateToDateOnly } from "@/lib/dashboard-context-url";
import { useDashboardFilters } from "@/lib/dashboard-filters";

export default function GoogleAdsPage() {
  const { user, selectedClientId } = useAuth();
  const { dateRange } = useDashboardFilters();
  const admin = user?.role === "ADMIN";
  const workspaceId = admin ? selectedClientId : user?.clientId;

  return (
    <div className="space-y-6" data-testid="google-ads-page">
      <AdsNavigation active="google" />
      {workspaceId && (
        <GoogleAdsReport
          key={workspaceId}
          workspaceId={workspaceId}
          dateFrom={localDateToDateOnly(dateRange.from)}
          dateTo={localDateToDateOnly(dateRange.to)}
          admin={admin}
        />
      )}
    </div>
  );
}
