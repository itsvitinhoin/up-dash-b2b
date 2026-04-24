import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useGetGeography } from "@workspace/api-client-react";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, RefreshCw, Download, MapPin } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { exportRowsAsCsv } from "@/lib/csv-export";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts";

export default function GeographyPage() {
  const { selectedClientId, user } = useAuth();
  const { dateRange } = useDashboardFilters();

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;

  const { data, isLoading, isError, refetch } = useGetGeography(
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

  // Take top 10 for charts
  const topStates = [...(data?.states || [])].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  const topCities = [...(data?.cities || [])].sort((a, b) => b.revenue - a.revenue).slice(0, 10);

  const handleExport = () => {
    if (!data) return;
    const states = data.states ?? [];
    const cities = data.cities ?? [];
    const rows = [
      ...states.map((s) => ({ kind: "state", name: s.state, state: s.state, customers: s.customers, orders: s.orders, revenue: s.revenue })),
      ...cities.map((c) => ({ kind: "city", name: c.city, state: c.state, customers: 0, orders: c.orders, revenue: c.revenue })),
    ];
    exportRowsAsCsv(
      `geography-${new Date().toISOString().slice(0, 10)}.csv`,
      rows,
      [
        { header: "kind", accessor: (r) => r.kind },
        { header: "name", accessor: (r) => r.name },
        { header: "state", accessor: (r) => r.state },
        { header: "customers", accessor: (r) => r.customers },
        { header: "orders", accessor: (r) => r.orders },
        { header: "revenue", accessor: (r) => r.revenue },
      ],
    );
  };

  return (
    <div className="space-y-6" data-testid="page-geography">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={!data}
          data-testid="geography-export"
        >
          <Download className="h-4 w-4 mr-1.5" />
          Export CSV
        </Button>
      </div>
      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            Failed to load geography data.
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <Tabs defaultValue="state" className="w-full">
          <TabsList className="grid w-full sm:w-[400px] grid-cols-2 mb-6">
            <TabsTrigger value="state">By State</TabsTrigger>
            <TabsTrigger value="city">By City</TabsTrigger>
          </TabsList>
          
          <TabsContent value="state" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Top States by Revenue</CardTitle>
                </CardHeader>
                <CardContent className="h-[400px]">
                  {isLoading ? (
                    <Skeleton className="h-full w-full" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topStates} layout="vertical" margin={{ left: 10, right: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                        <XAxis type="number" tickFormatter={(val) => `R$${(val/1000).toFixed(0)}k`} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                        <YAxis dataKey="state" type="category" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip 
                          formatter={(value: number) => formatCurrency(value)}
                          contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                        />
                        <Bar dataKey="revenue" fill="hsl(var(--chart-4))" radius={[0, 4, 4, 0]} barSize={20} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>State</TableHead>
                        <TableHead className="text-right">Customers</TableHead>
                        <TableHead className="text-right">Orders</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoading ? (
                        Array.from({ length: 5 }).map((_, i) => (
                          <TableRow key={i}>
                            <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                          </TableRow>
                        ))
                      ) : data?.states.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="p-0">
                            <EmptyState
                              icon={MapPin}
                              title="No regional sales yet"
                              description="Once orders ship to customers, you'll see a state-by-state breakdown here."
                              className="m-4 border-0 bg-transparent"
                            />
                          </TableCell>
                        </TableRow>
                      ) : (
                        [...(data?.states || [])].sort((a, b) => b.revenue - a.revenue).map((state) => (
                          <TableRow key={state.state}>
                            <TableCell className="font-medium">{state.state}</TableCell>
                            <TableCell className="text-right">{formatNumber(state.customers)}</TableCell>
                            <TableCell className="text-right">{formatNumber(state.orders)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(state.revenue)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </div>
          </TabsContent>
          
          <TabsContent value="city" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Top Cities by Revenue</CardTitle>
                </CardHeader>
                <CardContent className="h-[400px]">
                  {isLoading ? (
                    <Skeleton className="h-full w-full" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topCities} layout="vertical" margin={{ left: 60, right: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                        <XAxis type="number" tickFormatter={(val) => `R$${(val/1000).toFixed(0)}k`} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                        <YAxis dataKey="city" type="category" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip 
                          formatter={(value: number) => formatCurrency(value)}
                          labelFormatter={(label, payload) => {
                            const state = payload?.[0]?.payload?.state;
                            return `${label}${state ? `, ${state}` : ''}`;
                          }}
                          contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                        />
                        <Bar dataKey="revenue" fill="hsl(var(--chart-5))" radius={[0, 4, 4, 0]} barSize={20} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <div className="overflow-x-auto h-[460px]">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
                      <TableRow>
                        <TableHead>City</TableHead>
                        <TableHead>State</TableHead>
                        <TableHead className="text-right">Orders</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoading ? (
                        Array.from({ length: 10 }).map((_, i) => (
                          <TableRow key={i}>
                            <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                          </TableRow>
                        ))
                      ) : data?.cities.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="p-0">
                            <EmptyState
                              icon={MapPin}
                              title="No city-level data yet"
                              description="Once orders are placed, your top-performing cities will appear here."
                              className="m-4 border-0 bg-transparent"
                            />
                          </TableCell>
                        </TableRow>
                      ) : (
                        [...(data?.cities || [])].sort((a, b) => b.revenue - a.revenue).map((city, i) => (
                          <TableRow key={`${city.city}-${city.state}-${i}`}>
                            <TableCell className="font-medium">{city.city}</TableCell>
                            <TableCell>{city.state}</TableCell>
                            <TableCell className="text-right">{formatNumber(city.orders)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(city.revenue)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
