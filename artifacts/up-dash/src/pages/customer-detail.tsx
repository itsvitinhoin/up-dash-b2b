import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useGetCustomerDetail } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import {
  ArrowLeft, Mail, Phone, MapPin, Tag, ShoppingBag, Clock,
  Package, AlertCircle, CheckCircle, XCircle, Eye, ShoppingCart,
  CreditCard, User, Megaphone, BarChart2, Star
} from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { fadeInUp, useReducedMotion, withReducedMotion } from "@/lib/motion";

const OPPORTUNITY_COLOR: Record<string, string> = {
  CHAMPION: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200",
  HIGH: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200",
  MEDIUM: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200",
  LOW: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-400 border-zinc-200",
};

const RFM_COLOR: Record<string, string> = {
  Champions: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  Loyal: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  Potential: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
  "At Risk": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  Lost: "bg-zinc-100 text-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-400",
};

const STATUS_ORDER: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  PENDING: { label: "Pending", color: "text-amber-500", icon: Clock },
  APPROVED: { label: "Approved", color: "text-emerald-500", icon: CheckCircle },
  REJECTED: { label: "Rejected", color: "text-red-500", icon: XCircle },
  SHIPPED: { label: "Shipped", color: "text-blue-500", icon: Package },
  DELIVERED: { label: "Delivered", color: "text-emerald-500", icon: CheckCircle },
};

const EVENT_ICON: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  VISIT: { icon: Eye, label: "Page visit", color: "text-zinc-400" },
  REGISTRATION: { icon: User, label: "Registered", color: "text-violet-500" },
  APPROVED_REGISTRATION: { icon: CheckCircle, label: "Approved", color: "text-emerald-500" },
  PRODUCT_VIEW: { icon: Package, label: "Viewed product", color: "text-blue-400" },
  ADD_TO_CART: { icon: ShoppingCart, label: "Added to cart", color: "text-amber-500" },
  CHECKOUT_STARTED: { icon: CreditCard, label: "Started checkout", color: "text-orange-500" },
  PURCHASE: { icon: ShoppingBag, label: "Purchased", color: "text-emerald-600" },
};

type TimelineTab = "events" | "orders" | "products";

function JourneyFunnel({ journey }: {
  journey: {
    visits: number;
    registered: boolean;
    approved: boolean;
    productViews: number;
    addedToCart: number;
    purchased: number;
  };
}) {
  const steps = [
    { label: "Visits", value: journey.visits, icon: Eye, active: journey.visits > 0 },
    { label: "Registered", value: journey.registered ? 1 : 0, icon: User, active: journey.registered },
    { label: "Approved", value: journey.approved ? 1 : 0, icon: CheckCircle, active: journey.approved },
    { label: "Product Views", value: journey.productViews, icon: Package, active: journey.productViews > 0 },
    { label: "Cart Adds", value: journey.addedToCart, icon: ShoppingCart, active: journey.addedToCart > 0 },
    { label: "Purchases", value: journey.purchased, icon: ShoppingBag, active: journey.purchased > 0 },
  ];

  return (
    <div className="flex items-stretch gap-0 overflow-x-auto">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-center">
          <div className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg text-center min-w-[72px] ${
            step.active ? "bg-primary/10" : "bg-muted/40 opacity-50"
          }`}>
            <step.icon className={`h-4 w-4 ${step.active ? "text-primary" : "text-muted-foreground"}`} />
            <span className="text-xs font-semibold tabular-nums">{step.value === 1 && typeof step.value === "number" && step.label !== "Visits" && step.label !== "Product Views" && step.label !== "Cart Adds" && step.label !== "Purchases" ? "✓" : formatNumber(step.value)}</span>
            <span className="text-[10px] text-muted-foreground leading-tight">{step.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-px w-4 flex-shrink-0 ${step.active ? "bg-primary/40" : "bg-border"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function CustomerDetailPage() {
  const params = useParams<{ customerId: string }>();
  const [, navigate] = useLocation();
  const { selectedClientId, user } = useAuth();
  const [activeTab, setActiveTab] = useState<TimelineTab>("events");
  const reduced = useReducedMotion();
  const cardVariants = withReducedMotion(fadeInUp, reduced);

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;

  const { data, isLoading, isError } = useGetCustomerDetail(
    params.customerId ?? "",
    { clientId },
    {
      query: queryOpts({
        enabled: !!params.customerId && (user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId)),
      }),
    }
  );

  const customer = data?.customer;
  const journey = data?.journey;

  const TABS: { key: TimelineTab; label: string; count: number }[] = [
    { key: "events", label: "Timeline", count: data?.events?.length ?? 0 },
    { key: "orders", label: "Orders", count: data?.orders?.length ?? 0 },
    { key: "products", label: "Products", count: data?.productsPurchased?.length ?? 0 },
  ];

  if (isError) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/customers")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Customers
        </Button>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Failed to load customer profile.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="page-customer-detail">
      {/* Back button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate("/customers")}
        className="text-muted-foreground"
        data-testid="customer-detail-back"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Customers
      </Button>

      {/* Header card */}
      <motion.div variants={cardVariants} initial="hidden" animate="visible">
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row gap-6">
              {/* Avatar + name */}
              <div className="flex items-start gap-4 flex-1">
                <div className="h-14 w-14 rounded-full bg-primary/15 flex items-center justify-center text-primary text-xl font-bold flex-shrink-0">
                  {isLoading ? (
                    <Skeleton className="h-14 w-14 rounded-full" />
                  ) : (
                    (customer?.name?.[0] ?? customer?.email?.[0] ?? "?").toUpperCase()
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {isLoading ? (
                    <>
                      <Skeleton className="h-6 w-40 mb-2" />
                      <Skeleton className="h-4 w-56" />
                    </>
                  ) : (
                    <>
                      <h2 className="text-xl font-bold truncate">
                        {customer?.name || "Unknown Customer"}
                      </h2>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-muted-foreground">
                        {customer?.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3.5 w-3.5" />
                            {customer.email}
                          </span>
                        )}
                        {customer?.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3.5 w-3.5" />
                            {customer.phone}
                          </span>
                        )}
                        {(customer?.city || customer?.state) && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {[customer.city, customer.state].filter(Boolean).join(", ")}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 mt-3">
                        {customer?.registrationStatus && (
                          <Badge
                            variant="outline"
                            className={
                              customer.registrationStatus === "APPROVED"
                                ? "border-emerald-300 text-emerald-700 dark:text-emerald-400"
                                : customer.registrationStatus === "REJECTED"
                                ? "border-red-300 text-red-700 dark:text-red-400"
                                : "border-amber-300 text-amber-700 dark:text-amber-400"
                            }
                          >
                            {customer.registrationStatus === "APPROVED" && <CheckCircle className="h-3 w-3 mr-1" />}
                            {customer.registrationStatus}
                          </Badge>
                        )}
                        {customer?.rfmSegment && (
                          <Badge variant="outline" className={`border-transparent ${RFM_COLOR[customer.rfmSegment] ?? ""}`}>
                            <Star className="h-3 w-3 mr-1" />
                            {customer.rfmSegment}
                          </Badge>
                        )}
                        {data?.opportunityLevel && (
                          <Badge variant="outline" className={`border ${OPPORTUNITY_COLOR[data.opportunityLevel]}`}>
                            {data.opportunityLevel}
                          </Badge>
                        )}
                        {customer?.utmSource && (
                          <Badge variant="outline" className="border-border">
                            <Megaphone className="h-3 w-3 mr-1" />
                            {customer.utmSource}
                            {customer.utmMedium ? ` / ${customer.utmMedium}` : ""}
                          </Badge>
                        )}
                        {customer?.utmCampaign && (
                          <Badge variant="outline" className="border-border text-xs">
                            <Tag className="h-3 w-3 mr-1" />
                            {customer.utmCampaign}
                          </Badge>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Right stats */}
              <div className="grid grid-cols-3 gap-4 sm:flex sm:flex-col sm:gap-3 sm:text-right sm:min-w-[160px]">
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
                ) : (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground font-mono uppercase">Total Spent</p>
                      <p className="text-lg font-bold">{formatCurrency(customer?.totalSpent ?? 0)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-mono uppercase">Orders</p>
                      <p className="text-lg font-bold">{formatNumber(customer?.totalOrders ?? 0)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-mono uppercase">Member Since</p>
                      <p className="text-sm font-semibold">
                        {customer?.createdAt ? format(new Date(customer.createdAt), "MMM yyyy") : "—"}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Journey funnel */}
      <motion.div variants={cardVariants} initial="hidden" animate="visible">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-primary" />
              Customer Journey
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading || !journey ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <JourneyFunnel journey={journey} />
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Activity tabs */}
      <motion.div variants={cardVariants} initial="hidden" animate="visible">
        <Card>
          <CardHeader className="pb-0">
            <div className="flex gap-1 border-b border-border -mx-6 px-6 pb-0">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`pb-3 px-1 mr-4 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.key
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid={`customer-detail-tab-${tab.key}`}
                >
                  {tab.label}
                  {tab.count > 0 && (
                    <span className="ml-1.5 text-xs bg-muted px-1.5 py-0.5 rounded-full tabular-nums">
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {activeTab === "events" && (
              <div className="space-y-0">
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex gap-3 py-3 border-b border-border last:border-0">
                      <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
                      <div className="flex-1">
                        <Skeleton className="h-4 w-32 mb-1" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    </div>
                  ))
                ) : data?.events.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No events recorded</p>
                ) : (
                  <div className="relative pl-6">
                    <div className="absolute left-[11px] top-0 bottom-0 w-px bg-border" />
                    {data?.events.map((event, i) => {
                      const meta = EVENT_ICON[event.eventType] ?? { icon: Clock, label: event.eventType, color: "text-muted-foreground" };
                      return (
                        <div key={event.id} className="relative flex gap-3 py-2.5">
                          <div className={`absolute left-[-13px] h-6 w-6 rounded-full bg-card border-2 border-border flex items-center justify-center flex-shrink-0 ${i === 0 ? "border-primary" : ""}`}>
                            <meta.icon className={`h-3 w-3 ${meta.color}`} />
                          </div>
                          <div className="min-w-0 flex-1 ml-1">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <span className="text-sm font-medium">{meta.label}</span>
                                {event.productName && (
                                  <span className="text-sm text-muted-foreground ml-1">· {event.productName}</span>
                                )}
                              </div>
                              <span className="text-xs text-muted-foreground flex-shrink-0 whitespace-nowrap">
                                {format(new Date(event.createdAt), "MMM d, HH:mm")}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(event.createdAt), { addSuffix: true })}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === "orders" && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px] font-mono uppercase tracking-wider">Order ID</TableHead>
                      <TableHead className="text-[10px] font-mono uppercase tracking-wider text-right">Amount</TableHead>
                      <TableHead className="text-[10px] font-mono uppercase tracking-wider">Status</TableHead>
                      <TableHead className="text-[10px] font-mono uppercase tracking-wider">Items</TableHead>
                      <TableHead className="text-[10px] font-mono uppercase tracking-wider">Location</TableHead>
                      <TableHead className="text-[10px] font-mono uppercase tracking-wider text-right">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 6 }).map((__, j) => (
                            <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : data?.orders.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8 text-sm">
                          No orders yet
                        </TableCell>
                      </TableRow>
                    ) : (
                      data?.orders.map((order) => {
                        const s = STATUS_ORDER[order.status] ?? { label: order.status, color: "text-muted-foreground", icon: Clock };
                        return (
                          <TableRow key={order.id}>
                            <TableCell className="font-mono text-xs text-muted-foreground">{order.id.slice(0, 8)}…</TableCell>
                            <TableCell className="text-right font-semibold">{formatCurrency(order.amount)}</TableCell>
                            <TableCell>
                              <span className={`flex items-center gap-1 text-xs font-medium ${s.color}`}>
                                <s.icon className="h-3 w-3" />
                                {s.label}
                              </span>
                            </TableCell>
                            <TableCell className="text-sm">{order.itemCount}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {order.city && order.state ? `${order.city}, ${order.state}` : "—"}
                            </TableCell>
                            <TableCell className="text-right text-sm text-muted-foreground">
                              {format(new Date(order.createdAt), "MMM d, yyyy")}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {activeTab === "products" && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px] font-mono uppercase tracking-wider">Product</TableHead>
                      <TableHead className="text-[10px] font-mono uppercase tracking-wider">Category</TableHead>
                      <TableHead className="text-[10px] font-mono uppercase tracking-wider text-right">Qty</TableHead>
                      <TableHead className="text-[10px] font-mono uppercase tracking-wider text-right">Spent</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 4 }).map((__, j) => (
                            <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : data?.productsPurchased.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-8 text-sm">
                          No products purchased yet
                        </TableCell>
                      </TableRow>
                    ) : (
                      data?.productsPurchased.map((p) => (
                        <TableRow key={p.productId}>
                          <TableCell>
                            <div className="font-medium text-sm">{p.name}</div>
                            <div className="text-xs text-muted-foreground font-mono">{p.sku}</div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{p.category ?? "—"}</TableCell>
                          <TableCell className="text-right">{formatNumber(p.quantity)}</TableCell>
                          <TableCell className="text-right font-semibold">{formatCurrency(p.totalSpent)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
