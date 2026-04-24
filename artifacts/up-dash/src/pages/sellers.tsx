import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useGetSellers } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Trophy, ShoppingBag, DollarSign, Download, Users, Crown } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { exportRowsAsCsv } from "@/lib/csv-export";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { CountUp } from "@/components/count-up";
import { cardEntry, staggerContainer, useReducedMotion, withReducedMotion } from "@/lib/motion";

export default function SellersPage() {
  const { selectedClientId, user } = useAuth();
  const [limit, setLimit] = useState(25);
  const reduced = useReducedMotion();
  const containerVariants = withReducedMotion(staggerContainer, reduced);
  const cardVariants = withReducedMotion(cardEntry, reduced);

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

  const totalRevenue = useMemo(
    () => (data ?? []).reduce((s, x) => s + (x.totalRevenue || 0), 0),
    [data],
  );
  const activeSellers = data?.length ?? 0;
  const topSeller = data?.[0];

  return (
    <motion.div
      className="space-y-6"
      data-testid="page-sellers"
      initial="hidden"
      animate="visible"
      variants={containerVariants}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex items-center gap-2 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <span className="relative flex h-1.5 w-1.5" aria-hidden>
            {!reduced && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60" />
            )}
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          <span className="font-mono uppercase tracking-wider">
            Live ·{" "}
            <span className="text-foreground font-semibold tabular-nums">
              Top {limit}
            </span>{" "}
            Sellers
          </span>
        </div>
        <div className="flex items-center gap-2">
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
      </div>

      {/* Hero KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <motion.div variants={cardVariants}>
          <Card className="p-5 bg-gradient-to-br from-primary/[0.04] via-card to-card border-border relative overflow-hidden">
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-primary via-chart-3 to-chart-1 opacity-80"
            />
            <div className="flex items-center gap-2 mb-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
                <DollarSign className="h-3.5 w-3.5" />
              </div>
              <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                Total Revenue
              </span>
            </div>
            {isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-2xl font-semibold tracking-tight tabular-nums bg-gradient-to-br from-foreground via-foreground to-primary bg-clip-text text-transparent">
                <CountUp value={totalRevenue} format={(v) => formatCurrency(v)} />
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Across top {activeSellers} sellers
            </p>
          </Card>
        </motion.div>

        <motion.div variants={cardVariants}>
          <Card className="p-5 border-border">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-500/15 text-violet-400">
                <Users className="h-3.5 w-3.5" />
              </div>
              <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                Active Sellers
              </span>
            </div>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-semibold tracking-tight tabular-nums">
                <CountUp value={activeSellers} format={(v) => formatNumber(Math.round(v))} />
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Ranked by revenue contribution
            </p>
          </Card>
        </motion.div>

        <motion.div variants={cardVariants}>
          <Card className="p-5 border-border">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/15 text-amber-400">
                <Crown className="h-3.5 w-3.5" />
              </div>
              <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                Top Seller
              </span>
            </div>
            {isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : topSeller ? (
              <>
                <div className="text-base font-semibold tracking-tight truncate" title={topSeller.name}>
                  {topSeller.name}
                </div>
                <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                  {formatCurrency(topSeller.totalRevenue)} ·{" "}
                  {formatNumber(topSeller.totalOrders)} orders
                </p>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">—</div>
            )}
          </Card>
        </motion.div>
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
            <EmptyState
              icon={Trophy}
              title="No seller activity yet"
              description="Once orders are attributed to sellers in the selected window, they'll appear ranked here."
            />
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
                          <p className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground flex items-center justify-end gap-1 mb-1">
                            <ShoppingBag className="h-3 w-3" /> Orders
                          </p>
                          <p className="font-medium tabular-nums">{formatNumber(seller.totalOrders)}</p>
                        </div>
                        <div>
                          <p className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground flex items-center justify-end gap-1 mb-1">
                            <DollarSign className="h-3 w-3" /> Avg Ticket
                          </p>
                          <p className="font-medium tabular-nums">{formatCurrency(seller.avgTicket)}</p>
                        </div>
                        <div className="w-32">
                          <p className="font-mono uppercase tracking-wider text-[10px] text-primary mb-1">Revenue</p>
                          <p className={`text-xl font-bold tabular-nums ${
                            index === 0
                              ? "bg-gradient-to-br from-foreground via-foreground to-primary bg-clip-text text-transparent"
                              : ""
                          }`}>
                            {formatCurrency(seller.totalRevenue)}
                          </p>
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
    </motion.div>
  );
}
