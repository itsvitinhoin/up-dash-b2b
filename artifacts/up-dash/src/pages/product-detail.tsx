import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  useGetProductDetail,
  useGetProductCustomers,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { format } from "date-fns";
import {
  ArrowLeft,
  Package,
  Users,
  TrendingUp,
  ShoppingCart,
  ChevronRight,
  BarChart2,
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
} from "recharts";
import { cardEntry, staggerContainer, useReducedMotion, withReducedMotion } from "@/lib/motion";

const LEVEL_STYLES: Record<string, string> = {
  "High Conversion": "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  Standard: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  Low: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "At Risk": "bg-red-500/15 text-red-400 border-red-500/30",
};

function ProductThumbnail({ imageUrl, name, size = "lg" }: { imageUrl?: string | null; name: string; size?: "sm" | "lg" }) {
  const [imgError, setImgError] = useState(false);
  const dim = size === "lg" ? "h-16 w-16" : "h-8 w-8";
  const text = size === "lg" ? "text-xl" : "text-[10px]";
  const initials = name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  if (imageUrl && !imgError) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className={`${dim} rounded-lg object-cover border border-border flex-shrink-0`}
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <div className={`${dim} rounded-lg bg-primary/10 flex items-center justify-center ${text} font-semibold text-primary flex-shrink-0 border border-border`}>
      {initials}
    </div>
  );
}

function KpiTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 p-4 rounded-lg border border-border bg-card">
      <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">{label}</span>
      <span className="text-2xl font-bold tabular-nums">{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

function BreakdownChart({ data, title }: {
  data: Array<{ label: string; units: number; revenue: number }>;
  title: string;
}) {
  if (!data.length) {
    return (
      <EmptyState
        icon={BarChart2}
        title="No data available"
        description="No breakdown data for this period."
        className="h-40 border-0 bg-transparent"
      />
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{title}</p>
      <ResponsiveContainer width="100%" height={Math.min(200, data.length * 32 + 20)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={(v) => formatNumber(v)}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={80}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value: number, name: string) =>
              name === "revenue" ? [formatCurrency(value), "Revenue"] : [formatNumber(value), "Units"]
            }
          />
          <Bar dataKey="units" fill="hsl(var(--primary))" radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const [, setLocation] = useLocation();
  const { user, selectedClientId } = useAuth();
  const reduced = useReducedMotion();
  const containerVariants = withReducedMotion(staggerContainer, reduced);
  const cardVariants = withReducedMotion(cardEntry, reduced);

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;

  const { data, isLoading, isError } = useGetProductDetail(
    productId ?? "",
    { clientId },
    {
      query: queryOpts({
        enabled: !!productId && (user?.role === "CLIENT" || !!selectedClientId),
      }),
    },
  );

  const { data: buyersData, isLoading: buyersLoading } = useGetProductCustomers(
    productId ?? "",
    { clientId, page: 1, limit: 10 },
    {
      query: queryOpts({
        enabled: !!productId && (user?.role === "CLIENT" || !!selectedClientId),
      }),
    },
  );

  const product = data?.product;
  const kpis = data?.kpis;

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

  if (isError) {
    return (
      <EmptyState
        icon={Package}
        title="Product not found"
        description="This product doesn't exist or you don't have access to it."
        action={{ label: "Back to Products", onClick: () => setLocation("/products") }}
        className="py-20"
      />
    );
  }

  return (
    <motion.div
      className="space-y-6"
      data-testid="page-product-detail"
      initial="hidden"
      animate="visible"
      variants={containerVariants}
    >
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/products")}
          className="gap-1.5 text-muted-foreground hover:text-foreground"
          data-testid="product-detail-back"
        >
          <ArrowLeft className="h-4 w-4" />
          Products
        </Button>
      </div>

      <motion.div variants={cardVariants}>
        <Card>
          <CardContent className="p-6">
            {isLoading ? (
              <div className="flex gap-4">
                <Skeleton className="h-16 w-16 rounded-lg flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-6 w-64" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-5 w-20 mt-2" />
                </div>
              </div>
            ) : product ? (
              <div className="flex flex-col sm:flex-row gap-4">
                <ProductThumbnail imageUrl={product.imageUrl} name={product.name} size="lg" />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-start gap-2">
                    <h2 className="text-2xl font-bold truncate flex-1 min-w-0">{product.name}</h2>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${LEVEL_STYLES[product.level] ?? ""}`}>
                      {product.level}
                    </span>
                    <Badge variant={product.status === "ACTIVE" ? "default" : "secondary"} className="text-xs">
                      {product.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">{product.sku}</p>
                  {product.description && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{product.description}</p>
                  )}
                  <div className="flex flex-wrap gap-4 mt-3 text-sm">
                    {product.category && (
                      <span className="text-muted-foreground">Category: <strong className="text-foreground">{product.category}</strong></span>
                    )}
                    <span className="text-muted-foreground">Price: <strong className="text-foreground">{formatCurrency(product.price)}</strong></span>
                    <span className="text-muted-foreground">Stock: <strong className="text-foreground">{formatNumber(product.stock)}</strong></span>
                    <span className="text-muted-foreground">Added: <strong className="text-foreground">{format(new Date(product.createdAt), "MMM d, yyyy")}</strong></span>
                  </div>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </motion.div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-4 rounded-lg border border-border">
              <Skeleton className="h-3 w-20 mb-2" />
              <Skeleton className="h-7 w-24" />
            </div>
          ))
        ) : kpis ? (
          <>
            <KpiTile label="Revenue (lifetime)" value={formatCurrency(kpis.totalRevenue)} />
            <KpiTile label="Units sold" value={formatNumber(kpis.totalUnitsSold)} />
            <KpiTile label="Avg ticket" value={formatCurrency(kpis.avgTicket)} />
            <KpiTile
              label="Sell-through"
              value={`${Math.round((product?.percentSold ?? 0) * 100)}%`}
              sub={`${kpis.uniqueBuyers} unique buyers`}
            />
          </>
        ) : null}
      </div>

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
                title="No sales data for this period"
                description="Adjust the date range or check back once orders are placed."
                className="h-48 border-0 bg-transparent"
              />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={mergedChart} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v) => {
                      try { return format(new Date(v), "MMM d"); } catch { return v; }
                    }}
                    minTickGap={30}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v) => formatCurrency(v)}
                    width={64}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value: number, name: string) => [
                      formatCurrency(value),
                      name === "prevRevenue" ? "Prev. period" : "Revenue",
                    ]}
                    labelFormatter={(label) => {
                      try { return format(new Date(label), "MMM d, yyyy"); } catch { return label; }
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                    name="revenue"
                  />
                  {mergedChart.some((d) => d.prevRevenue !== undefined) && (
                    <Line
                      type="monotone"
                      dataKey="prevRevenue"
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      dot={false}
                      name="prevRevenue"
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(["byColor", "bySize", "byState"] as const).map((key) => {
          const titles = { byColor: "By Color", bySize: "By Size", byState: "By State" };
          return (
            <motion.div key={key} variants={cardVariants}>
              <Card className="h-full">
                <CardContent className="p-4">
                  {isLoading ? (
                    <Skeleton className="h-40 w-full" />
                  ) : (
                    <BreakdownChart
                      data={(data?.[key] ?? []) as Array<{ label: string; units: number; revenue: number }>}
                      title={titles[key]}
                    />
                  )}
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      <motion.div variants={cardVariants}>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4" />
              Top Buyers
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-mono uppercase tracking-wider text-[10px]">Customer</TableHead>
                    <TableHead className="font-mono uppercase tracking-wider text-[10px]">Segment</TableHead>
                    <TableHead className="font-mono uppercase tracking-wider text-[10px] text-right">Units</TableHead>
                    <TableHead className="font-mono uppercase tracking-wider text-[10px] text-right">Spent</TableHead>
                    <TableHead className="font-mono uppercase tracking-wider text-[10px]">Last Purchase</TableHead>
                    <TableHead className="w-6" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {buyersLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-24 mt-1" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-10 ml-auto" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell />
                      </TableRow>
                    ))
                  ) : !buyersData?.data.length ? (
                    <TableRow>
                      <TableCell colSpan={6} className="p-0">
                        <EmptyState
                          icon={ShoppingCart}
                          title="No purchases recorded yet"
                          description="Buyers will appear here once they purchase this product."
                          className="py-12 border-0 bg-transparent"
                        />
                      </TableCell>
                    </TableRow>
                  ) : (
                    buyersData.data.map((buyer) => (
                      <TableRow
                        key={buyer.customerId}
                        className="cursor-pointer hover:bg-accent/30 transition-colors"
                        onClick={() => setLocation(`/customers/${buyer.customerId}`)}
                        data-testid={`buyer-row-${buyer.customerId}`}
                      >
                        <TableCell>
                          <div className="font-medium">{buyer.name}</div>
                          <div className="text-xs text-muted-foreground">{buyer.email}</div>
                        </TableCell>
                        <TableCell>
                          {buyer.rfmSegment ? (
                            <Badge variant="outline" className="text-[10px]">{buyer.rfmSegment}</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(buyer.totalUnitsBought)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{formatCurrency(buyer.totalSpent)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {format(new Date(buyer.lastPurchaseAt), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell className="pr-3">
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {(buyersData?.total ?? 0) > 10 && (
              <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
                Showing 10 of {formatNumber(buyersData!.total)} buyers
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
