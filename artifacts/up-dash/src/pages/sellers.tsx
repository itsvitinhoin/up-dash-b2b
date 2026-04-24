import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useGetSellers } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue 
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Trophy, ShoppingBag, DollarSign, Download } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { exportRowsAsCsv } from "@/lib/csv-export";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export default function SellersPage() {
  const { selectedClientId, user } = useAuth();
  const [limit, setLimit] = useState(25);

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;

  const { data, isLoading, isError, refetch } = useGetSellers(
    {
      clientId,
      limit,
    },
    {
      query: queryOpts({
        enabled: user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId),
      }),
    }
  );

  return (
    <div className="space-y-6" data-testid="page-sellers">
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (!data) return;
            exportRowsAsCsv(
              `sellers-${new Date().toISOString().slice(0, 10)}.csv`,
              data,
              [
                { header: "id", accessor: (r) => r.id },
                { header: "name", accessor: (r) => r.name },
                { header: "email", accessor: (r) => r.email ?? "" },
                { header: "totalOrders", accessor: (r) => r.totalOrders },
                { header: "totalRevenue", accessor: (r) => r.totalRevenue },
                { header: "avgTicket", accessor: (r) => r.avgTicket },
              ],
            );
          }}
          disabled={!data?.length}
          data-testid="sellers-export"
        >
          <Download className="h-4 w-4 mr-1.5" />
          Export CSV
        </Button>
        <div className="flex items-center gap-2 bg-card p-1 rounded-md border border-border">
          <span className="text-sm font-medium text-muted-foreground px-2">Show top</span>
          <Select value={limit.toString()} onValueChange={(val) => setLimit(Number(val))}>
            <SelectTrigger className="w-[80px] border-none shadow-none h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            Failed to load sellers.
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-4">
          {isLoading && !data ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4 flex items-center gap-4">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <div className="hidden sm:block space-y-2 text-right">
                    <Skeleton className="h-4 w-24 ml-auto" />
                    <Skeleton className="h-3 w-16 ml-auto" />
                  </div>
                </CardContent>
              </Card>
            ))
          ) : data?.length === 0 ? (
            <Card>
              <CardContent className="h-32 flex flex-col items-center justify-center text-muted-foreground">
                <Trophy className="h-8 w-8 mb-2 text-muted-foreground/50" />
                No sellers found.
              </CardContent>
            </Card>
          ) : (
            data?.map((seller, index) => {
              const isTop3 = index < 3;
              
              return (
                <Card key={seller.id} className={`overflow-hidden transition-all hover:shadow-md ${isTop3 ? 'border-primary/20 shadow-sm' : ''}`}>
                  <CardContent className="p-0">
                    <div className="flex items-center p-4 sm:p-6 gap-4 sm:gap-6 relative">
                      {isTop3 && (
                        <div className={`absolute top-0 bottom-0 left-0 w-1 ${
                          index === 0 ? 'bg-amber-400' : 
                          index === 1 ? 'bg-zinc-300' : 
                          'bg-amber-600'
                        }`} />
                      )}
                      
                      <div className={`flex items-center justify-center font-bold ${
                        index === 0 ? 'text-amber-500 h-10 w-10 text-2xl' : 
                        index === 1 ? 'text-zinc-500 h-8 w-8 text-xl' : 
                        index === 2 ? 'text-amber-700 h-8 w-8 text-xl' : 
                        'text-muted-foreground h-8 w-8 text-lg'
                      }`}>
                        #{index + 1}
                      </div>
                      
                      <Avatar className="h-12 w-12 border">
                        <AvatarFallback className="bg-primary/5 text-primary">
                          {seller.name.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-lg truncate">{seller.name}</h3>
                        <p className="text-sm text-muted-foreground truncate">{seller.email || 'No email'}</p>
                      </div>
                      
                      <div className="hidden md:flex items-center gap-8 text-right">
                        <div>
                          <p className="text-xs text-muted-foreground flex items-center justify-end gap-1 mb-1">
                            <ShoppingBag className="h-3 w-3" /> Orders
                          </p>
                          <p className="font-medium">{formatNumber(seller.totalOrders)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground flex items-center justify-end gap-1 mb-1">
                            <DollarSign className="h-3 w-3" /> Avg Ticket
                          </p>
                          <p className="font-medium">{formatCurrency(seller.avgTicket)}</p>
                        </div>
                        <div className="w-32">
                          <p className="text-xs text-primary font-medium mb-1">Revenue</p>
                          <p className="text-xl font-bold">{formatCurrency(seller.totalRevenue)}</p>
                        </div>
                      </div>

                      {/* Mobile stats */}
                      <div className="md:hidden text-right">
                        <p className="text-sm font-bold text-primary">{formatCurrency(seller.totalRevenue)}</p>
                        <p className="text-xs text-muted-foreground">{formatNumber(seller.totalOrders)} ord</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
