import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  useGetSellerDetail,
  useGetSellerCustomers,
  useGetSellerOrders,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { formatDistanceToNow, format } from "date-fns";
import {
  ArrowLeft,
  Users,
  TrendingUp,
  ShoppingBag,
  ChevronRight,
  BarChart2,
  Mail,
  Phone,
  CheckCircle2,
  MapPin,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cardEntry, staggerContainer, useReducedMotion, withReducedMotion } from "@/lib/motion";

const STATUS_STYLES: Record<string, string> = {
  APPROVED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  DELIVERED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  SHIPPED: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  PENDING: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  REJECTED: "bg-red-500/15 text-red-400 border-red-500/30",
};

function KpiCard({
  label,
  value,
  prev,
  icon: Icon,
  format: fmt,
  className,
}: {
  label: string;
  value: number;
  prev: number;
  icon: React.ElementType;
  format: (v: number) => string;
  className?: string;
}) {
  const delta = prev > 0 ? ((value - prev) / prev) * 100 : null;
  return (
    <Card className={`p-4 ${className ?? ""}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Icon className="h-3 w-3" />
        </div>
        <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="text-xl font-bold tabular-nums">{fmt(value)}</div>
      {delta !== null && (
        <p
          className={`text-xs tabular-nums mt-0.5 ${
            delta >= 0 ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {delta >= 0 ? "+" : ""}
          {delta.toFixed(1)}% vs prev period
        </p>
      )}
    </Card>
  );
}

function BreakdownChart({
  data,
  label,
}: {
  data: { name: string; revenue: number }[];
  label: string;
}) {
  if (!data.length) {
    return (
      <EmptyState
        icon={BarChart2}
        title="No data"
        description={`No ${label.toLowerCase()} breakdown for this period.`}
        className="h-40 border-0 bg-transparent"
      />
    );
  }
  return (
    <div style={{ height: Math.max(160, data.length * 28 + 24) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 24, left: 0, bottom: 4 }}
          barCategoryGap={6}
        >
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis
            type="category"
            dataKey="name"
            width={140}
            tickLine={false}
            axisLine={false}
            interval={0}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as { name: string; revenue: number };
              return (
                <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-muted-foreground tabular-nums">
                    {formatCurrency(p.revenue)}
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="revenue" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {data.map((_, i) => (
              <Cell
                key={i}
                fill={
                  i === 0
                    ? "hsl(var(--primary))"
                    : i === 1
                      ? "hsl(var(--chart-3))"
                      : "hsl(var(--chart-1) / 0.5)"
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function SellerDetailPage() {
  const { sellerId } = useParams<{ sellerId: string }>();
  const [, navigate] = useLocation();
  const { user, selectedClientId } = useAuth();
  const reduced = useReducedMotion();
  const containerVariants = withReducedMotion(staggerContainer, reduced);
  const cardVariants = withReducedMotion(cardEntry, reduced);

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled = !!sellerId && (user?.role === "CLIENT" || !!clientId);

  const { data, isLoading, isError } = useGetSellerDetail(
    sellerId!,
    { clientId },
    { query: queryOpts({ enabled }) },
  );

  const { data: customersData, isLoading: customersLoading } = useGetSellerCustomers(
    sellerId!,
    { clientId, limit: 20 },
    { query: queryOpts({ enabled }) },
  );

  const { data: ordersData, isLoading: ordersLoading } = useGetSellerOrders(
    sellerId!,
    { clientId, limit: 25 },
    { query: queryOpts({ enabled }) },
  );

  const seller = data?.seller;
  const kpis = data?.kpis;
  const prevKpis = data?.prevKpis;

  const currentSeries = data?.revenueOverTime ?? [];
  const prevSeries = data?.prevRevenueOverTime ?? [];
  const firstPrevMs = prevSeries.length ? new Date(prevSeries[0].date).getTime() : 0;
  const prevOffsetMap = new Map<number, number>(
    prevSeries.map((d) => [
      Math.round((new Date(d.date).getTime() - firstPrevMs) / 86_400_000),
      d.revenue,
    ]),
  );
  const firstCurrentMs = currentSeries.length ? new Date(currentSeries[0].date).getTime() : 0;
  const mergedChart = currentSeries.map((d) => {
    const offset = Math.round((new Date(d.date).getTime() - firstCurrentMs) / 86_400_000);
    return {
      date: d.date,
      revenue: d.revenue,
      prevRevenue: prevOffsetMap.get(offset),
    };
  });

  const categoryData = (data?.categoryBreakdown ?? []).map((c) => ({
    name: c.category,
    revenue: c.revenue,
  }));

  const stateData = (data?.stateBreakdown ?? []).map((s) => ({
    name: s.state,
    revenue: s.revenue,
  }));

  if (isError) {
    return (
      <EmptyState
        icon={ShoppingBag}
        title="Seller not found"
        description="This seller may have been removed or you may not have access."
        action={{ label: "Back to Sellers", onClick: () => navigate("/sellers") }}
      />
    );
  }

  return (
    <motion.div
      className="space-y-6"
      data-testid="page-seller-detail"
      initial="hidden"
      animate="visible"
      variants={containerVariants}
    >
      {/* Back navigation */}
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground -ml-2"
        onClick={() => navigate("/sellers")}
        data-testid="seller-detail-back"
      >
        <ArrowLeft className="h-4 w-4" />
        Sellers
      </Button>

      {/* Header card */}
      <motion.div variants={cardVariants}>
        <Card className="p-6">
          {isLoading ? (
            <div className="flex items-center gap-4">
              <Skeleton className="h-16 w-16 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
          ) : seller ? (
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <Avatar className="h-16 w-16 border-2 border-primary/20">
                <AvatarFallback className="bg-primary/10 text-primary text-xl font-bold">
                  {seller.name.charAt(0)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <h2 className="text-2xl font-bold">{seller.name}</h2>
                <div className="flex flex-wrap gap-3 mt-1.5">
                  {seller.email && (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Mail className="h-3.5 w-3.5" />
                      {seller.email}
                    </span>
                  )}
                  {seller.phone && (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Phone className="h-3.5 w-3.5" />
                      {seller.phone}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    Member since{" "}
                    {formatDistanceToNow(new Date(seller.createdAt), { addSuffix: true })}
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </Card>
      </motion.div>

      {/* KPI strip */}
      <motion.div variants={cardVariants}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} className="p-4">
                <Skeleton className="h-4 w-20 mb-2" />
                <Skeleton className="h-7 w-24" />
              </Card>
            ))
          ) : kpis && prevKpis ? (
            <>
              <KpiCard
                label="Revenue"
                value={kpis.revenue}
                prev={prevKpis.revenue}
                icon={TrendingUp}
                format={formatCurrency}
                className="col-span-2 sm:col-span-1 bg-gradient-to-br from-primary/[0.04] via-card to-card border-primary/20"
              />
              <KpiCard
                label="Orders"
                value={kpis.orders}
                prev={prevKpis.orders}
                icon={ShoppingBag}
                format={(v) => formatNumber(Math.round(v))}
              />
              <KpiCard
                label="Avg Ticket"
                value={kpis.avgTicket}
                prev={prevKpis.avgTicket}
                icon={TrendingUp}
                format={formatCurrency}
              />
              <KpiCard
                label="Customers"
                value={kpis.uniqueCustomers}
                prev={prevKpis.uniqueCustomers}
                icon={Users}
                format={(v) => formatNumber(Math.round(v))}
              />
              <KpiCard
                label="Approval Rate"
                value={kpis.approvalRate}
                prev={prevKpis.approvalRate}
                icon={CheckCircle2}
                format={(v) => `${v.toFixed(1)}%`}
              />
            </>
          ) : null}
        </div>
      </motion.div>

      {/* Revenue over time */}
      <motion.div variants={cardVariants}>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Revenue over time
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : mergedChart.length === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title="No revenue data"
                description="No approved orders in this period."
                className="h-48 border-0 bg-transparent"
              />
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={mergedChart} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: string) => {
                        try {
                          return format(new Date(v), "MMM d");
                        } catch {
                          return v;
                        }
                      }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => formatCurrency(v, { compact: true })}
                      width={64}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md space-y-0.5">
                            <p className="font-medium">
                              {(() => {
                                try {
                                  return format(new Date(label as string), "MMM d, yyyy");
                                } catch {
                                  return label as string;
                                }
                              })()}
                            </p>
                            {payload.map((p) => (
                              <p
                                key={p.dataKey as string}
                                className="tabular-nums"
                                style={{ color: p.color }}
                              >
                                {p.name === "prevRevenue" ? "Prev. period" : "Revenue"}:{" "}
                                {formatCurrency(p.value as number)}
                              </p>
                            ))}
                          </div>
                        );
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="revenue"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={false}
                      name="revenue"
                      isAnimationActive={!reduced}
                    />
                    {mergedChart.some((d) => d.prevRevenue !== undefined) && (
                      <Line
                        type="monotone"
                        dataKey="prevRevenue"
                        stroke="hsl(var(--muted-foreground))"
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                        dot={false}
                        name="prevRevenue"
                        isAnimationActive={!reduced}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Breakdowns */}
      <motion.div variants={cardVariants}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <BarChart2 className="h-4 w-4" />
                Revenue by category
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <BreakdownChart data={categoryData} label="Category" />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Revenue by state
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <BreakdownChart data={stateData} label="State" />
              )}
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {/* Top customers */}
      <motion.div variants={cardVariants}>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4" />
              Top customers
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {customersLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : !customersData?.data.length ? (
              <EmptyState
                icon={Users}
                title="No customers yet"
                description="No customers bought from this seller in the selected period."
                className="border-0 bg-transparent"
              />
            ) : (
              <Table data-testid="seller-customers-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Spent</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">Segment</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Last Purchase</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customersData.data.map((c) => (
                    <TableRow
                      key={c.customerId}
                      className="cursor-pointer hover:bg-accent/30 transition-colors"
                      onClick={() => navigate(`/customers/${c.customerId}`)}
                      data-testid={`seller-customer-row-${c.customerId}`}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7">
                            <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                              {c.name.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{c.name}</p>
                            {c.email && (
                              <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(c.totalOrders)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatCurrency(c.totalSpent)}
                      </TableCell>
                      <TableCell className="text-right hidden sm:table-cell">
                        {c.rfmSegment ? (
                          <Badge variant="outline" className="text-xs">
                            {c.rfmSegment}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground hidden md:table-cell">
                        {c.lastPurchaseAt
                          ? formatDistanceToNow(new Date(c.lastPurchaseAt), { addSuffix: true })
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Recent orders */}
      <motion.div variants={cardVariants}>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <ShoppingBag className="h-4 w-4" />
              Recent orders
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {ordersLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : !ordersData?.data.length ? (
              <EmptyState
                icon={ShoppingBag}
                title="No orders yet"
                description="No orders attributed to this seller in the selected period."
                className="border-0 bg-transparent"
              />
            ) : (
              <Table data-testid="seller-orders-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="hidden sm:table-cell">Status</TableHead>
                    <TableHead className="hidden md:table-cell">Location</TableHead>
                    <TableHead className="text-right hidden lg:table-cell">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ordersData.data.map((o) => (
                    <TableRow
                      key={o.id}
                      className="cursor-pointer hover:bg-accent/30 transition-colors"
                      onClick={() => navigate(`/customers/${o.customerId}`)}
                      data-testid={`seller-order-row-${o.id}`}
                    >
                      <TableCell className="font-medium truncate max-w-[160px]">
                        {o.customerName}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {formatCurrency(o.amount)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge
                          variant="outline"
                          className={`text-xs ${STATUS_STYLES[o.status] ?? ""}`}
                        >
                          {o.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground hidden md:table-cell">
                        {[o.city, o.state].filter(Boolean).join(", ") || "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground hidden lg:table-cell">
                        {formatDistanceToNow(new Date(o.createdAt), { addSuffix: true })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
