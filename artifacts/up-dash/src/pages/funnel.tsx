import { useState } from "react";
import { subDays, format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useGetFunnel } from "@workspace/api-client-react";
import { DateRangePicker, DateRange } from "@/components/date-range-picker";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, RefreshCw, Lightbulb, ArrowDownRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPercentage, formatNumber } from "@/lib/formatters";
import { Badge } from "@/components/ui/badge";

export default function FunnelPage() {
  const { selectedClientId, user } = useAuth();
  const [dateRange, setDateRange] = useState<DateRange>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;

  const { data, isLoading, isError, refetch } = useGetFunnel(
    {
      clientId,
      dateFrom: format(dateRange.from, "yyyy-MM-dd"),
      dateTo: format(dateRange.to, "yyyy-MM-dd"),
    },
    {
      query: queryOpts({
        enabled: user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId),
      }),
    }
  );

  return (
    <div className="space-y-6" data-testid="page-funnel">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Conversion Funnel</h1>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            Failed to load funnel data.
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : isLoading ? (
        <div className="space-y-6">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      ) : data ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card className="bg-primary text-primary-foreground border-none overflow-hidden relative">
              <div className="absolute right-0 top-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/4 blur-3xl pointer-events-none"></div>
              <CardContent className="p-8 sm:p-12" data-testid="funnel-hero">
                <div className="space-y-2 relative z-10">
                  <h2 className="text-primary-foreground/80 text-lg font-medium">Overall Conversion Rate</h2>
                  <p className="text-5xl sm:text-7xl font-bold tracking-tighter">
                    {formatPercentage(data.overallConversion)}
                  </p>
                  <p className="text-primary-foreground/70 text-sm mt-4 max-w-md">
                    From total leads to approved purchases in the selected period.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6 sm:p-8">
                <div className="space-y-0 relative">
                  {data.steps.map((step, index) => {
                    const maxCount = data.steps[0].count;
                    const widthPercent = (step.count / maxCount) * 100;
                    const isLast = index === data.steps.length - 1;

                    return (
                      <div key={step.step} className="relative">
                        <div className="flex flex-col sm:flex-row sm:items-center py-4 gap-4">
                          <div className="w-32 flex-shrink-0">
                            <h3 className="font-semibold text-foreground">{step.label}</h3>
                            <p className="text-sm text-muted-foreground">{formatNumber(step.count)}</p>
                          </div>
                          
                          <div className="flex-1 flex items-center gap-4 h-12">
                            <div className="h-full bg-muted rounded-r-md relative overflow-hidden w-full max-w-md">
                              <div 
                                className="h-full bg-primary/80 transition-all duration-1000 ease-in-out"
                                style={{ width: `${widthPercent}%` }}
                              />
                            </div>
                            {index > 0 && (
                              <Badge variant="secondary" className="whitespace-nowrap">
                                {formatPercentage(step.conversionRate)} cvr
                              </Badge>
                            )}
                          </div>
                        </div>

                        {!isLast && (
                          <div className="absolute -bottom-4 left-16 sm:left-36 z-10 flex items-center gap-1 text-xs font-medium text-destructive bg-background px-2 py-1 rounded-full border shadow-sm">
                            <ArrowDownRight className="h-3 w-3" />
                            {formatPercentage(data.steps[index+1].dropOffRate)} drop
                          </div>
                        )}
                        
                        {!isLast && <div className="h-8 border-l-2 border-dashed border-muted ml-16 sm:ml-[140px]" />}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-1 space-y-4">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-amber-500" />
              Key Insights
            </h3>
            {data.insights.length > 0 ? (
              data.insights.map((insight, i) => (
                <Alert key={i} className="bg-card">
                  <AlertDescription className="text-sm leading-relaxed text-muted-foreground">
                    {insight}
                  </AlertDescription>
                </Alert>
              ))
            ) : (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground text-sm">
                  Not enough data to generate insights for this period.
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
