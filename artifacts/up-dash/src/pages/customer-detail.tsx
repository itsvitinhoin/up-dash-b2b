import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { customFetch, useGetCustomerDetail } from "@workspace/api-client-react";
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
  CreditCard, User, Megaphone, BarChart2, Star, Building2, Inbox, Calendar,
  MousePointerClick, MonitorSmartphone
} from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { EmptyState } from "@/components/empty-state";
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

type TimelineTab = "events" | "orders" | "products";

type CustomerTimelineEvent = {
  id: string;
  userId: number;
  occurredAt: string;
  periodType: string;
  eventName: string;
  eventLabel: string;
  productId: number | null;
  productName: string | null;
  productSku: string | null;
  categoryId: number | null;
  categoryName: string | null;
  orderId: number | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  normalizedSource: string;
  normalizedMedium: string;
  deviceType: string | null;
  totalEvents: number;
  totalQuantity: number;
  totalValue: number;
  attributionType: "first_touch" | "last_touch" | "return_touch" | "direct" | null;
  rawMetricId: number;
  updatedAt: string;
  eventId?: string | null;
  anonymousId?: string | null;
  sessionId?: string | null;
  visitorId?: string | null;
  fbclid?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  gclid?: string | null;
  landingHost?: string | null;
  landingPath?: string | null;
  referrerHost?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
};

type CustomerTimelineTouch = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  occurredAt: string | null;
};

type CustomerTimelineResponse = {
  userId: number;
  attribution: {
    firstTouch: CustomerTimelineTouch;
    lastTouch: CustomerTimelineTouch;
    lastReturn: CustomerTimelineTouch;
  };
  summary: {
    totalEvents: number;
    productViews: number;
    categoryViews: number;
    formStarts: number;
    registerStarts: number;
    registerSubmitted: number;
    logins: number;
    addToCartEvents: number;
    checkoutStarts: number;
    purchases: number;
    totalCartValue: number;
    totalPurchaseValue: number;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
  };
  timeline: CustomerTimelineEvent[];
};

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
    { label: "Visits", value: journey.visits, icon: Eye, active: journey.visits > 0, numeric: true },
    { label: "Registered", value: journey.registered ? 1 : 0, icon: User, active: journey.registered, numeric: false },
    { label: "Approved", value: journey.approved ? 1 : 0, icon: CheckCircle, active: journey.approved, numeric: false },
    { label: "Product Views", value: journey.productViews, icon: Package, active: journey.productViews > 0, numeric: true },
    { label: "Cart Adds", value: journey.addedToCart, icon: ShoppingCart, active: journey.addedToCart > 0, numeric: true },
    { label: "Purchases", value: journey.purchased, icon: ShoppingBag, active: journey.purchased > 0, numeric: true },
  ];

  return (
    <div className="flex items-stretch gap-0 overflow-x-auto">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-center">
          <div className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg text-center min-w-[80px] ${
            step.active ? "bg-primary/10" : "bg-muted/40 opacity-50"
          }`}>
            <step.icon className={`h-4 w-4 ${step.active ? "text-primary" : "text-muted-foreground"}`} />
            <span className="text-xs font-semibold tabular-nums">
              {step.numeric ? formatNumber(step.value) : step.value === 1 ? "✓" : "✗"}
            </span>
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

function AttributionPanel({
  utmSource, utmMedium, utmCampaign, approvalDate, registrationStatus,
}: {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  approvalDate?: string | null;
  registrationStatus?: string;
}) {
  const rows = [
    { label: "Channel (First-touch)", value: utmSource ?? "Direct / None", highlight: true },
    { label: "Medium", value: utmMedium ?? "—" },
    { label: "Campaign", value: utmCampaign ?? "—" },
    { label: "Registration Status", value: registrationStatus ?? "—" },
    { label: "Approval Date", value: approvalDate ? format(new Date(approvalDate), "MMM d, yyyy HH:mm") : "—" },
  ];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-primary" />
          Attribution & Registration
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2">
          {rows.map((row) => (
            <div key={row.label} className="flex items-start justify-between gap-4">
              <dt className="text-xs text-muted-foreground flex-shrink-0">{row.label}</dt>
              <dd className={`text-xs font-medium text-right truncate max-w-[180px] ${row.highlight ? "text-primary" : ""}`} title={row.value}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function formatSaoPauloDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function attributionLabel(type: CustomerTimelineEvent["attributionType"]) {
  switch (type) {
    case "first_touch":
      return "Primeira campanha";
    case "last_touch":
      return "Última campanha conhecida";
    case "return_touch":
      return "Campanha de retorno";
    case "direct":
      return "Direto / não identificado";
    default:
      return null;
  }
}

function timelineIcon(eventName: string) {
  if (eventName === "product_view") return Package;
  if (eventName === "category_view") return Tag;
  if (eventName === "add_to_cart") return ShoppingCart;
  if (eventName === "initiate_checkout" || eventName === "checkout_start") return CreditCard;
  if (["purchase", "order_created", "order_paid", "payment_approved"].includes(eventName)) return ShoppingBag;
  if (eventName === "login") return User;
  if (eventName === "register_submitted" || eventName === "register_start") return CheckCircle;
  if (eventName === "page_view") return Eye;
  return MousePointerClick;
}

function TouchCard({
  title,
  touch,
  fallback,
}: {
  title: string;
  touch: CustomerTimelineTouch;
  fallback: string;
}) {
  const hasCampaign = Boolean(touch.campaign);
  return (
    <Card className="p-4">
      <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{title}</p>
      <p className="mt-2 text-sm font-semibold leading-snug line-clamp-2">
        {hasCampaign ? touch.campaign : fallback}
      </p>
      <p className="mt-1 text-xs text-muted-foreground line-clamp-1">
        {hasCampaign ? `${touch.source ?? "—"} · ${touch.medium ?? "—"}` : "—"}
      </p>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {formatSaoPauloDateTime(touch.occurredAt)}
      </p>
    </Card>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <p className="mt-2 text-base font-semibold tabular-nums leading-tight break-words">{value}</p>
    </Card>
  );
}

function UpzeroTimelineSection({
  data,
  isLoading,
  isError,
}: {
  data?: CustomerTimelineResponse;
  isLoading: boolean;
  isError: boolean;
}) {
  const timeline = data?.timeline ?? [];
  return (
    <section className="space-y-4" data-testid="customer-upzero-timeline">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            Timeline do Cliente
          </h3>
          <p className="text-xs text-muted-foreground">
            Jornada comportamental agregada por horário pela UP Zero, apenas com eventos que possuem user_id.
          </p>
        </div>
        {data?.userId && (
          <Badge variant="outline" className="w-fit font-mono text-[11px]">
            User ID UP Zero: {data.userId}
          </Badge>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Não foi possível carregar a timeline da UP Zero para este cliente.
          </AlertDescription>
        </Alert>
      ) : !data || timeline.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Sem eventos identificados"
          description="A timeline só atribui eventos com user_id preenchido. Eventos anônimos não entram nesta jornada."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
            <TouchCard
              title="Primeira campanha"
              touch={data.attribution.firstTouch}
              fallback="Sem campanha identificada"
            />
            <TouchCard
              title="Última campanha"
              touch={data.attribution.lastTouch}
              fallback="Sem conversão atribuída"
            />
            <TouchCard
              title="Campanha de retorno"
              touch={data.attribution.lastReturn}
              fallback="Sem retorno identificado"
            />
            <MetricCard
              label="Primeira atividade"
              value={formatSaoPauloDateTime(data.summary.firstSeenAt)}
              icon={Calendar}
            />
            <MetricCard
              label="Última atividade"
              value={formatSaoPauloDateTime(data.summary.lastSeenAt)}
              icon={Clock}
            />
            <MetricCard label="Produtos vistos" value={formatNumber(data.summary.productViews)} icon={Package} />
            <MetricCard label="Carrinhos" value={formatNumber(data.summary.addToCartEvents)} icon={ShoppingCart} />
            <MetricCard label="Checkouts" value={formatNumber(data.summary.checkoutStarts)} icon={CreditCard} />
            <MetricCard label="Compras" value={formatNumber(data.summary.purchases)} icon={ShoppingBag} />
            <MetricCard label="Valor comprado" value={formatCurrency(data.summary.totalPurchaseValue)} icon={ShoppingBag} />
          </div>

          <Card className="p-5">
            <div className="relative pl-7">
              <div className="absolute left-[13px] top-0 bottom-0 w-px bg-border" />
              {timeline.map((event, index) => {
                const Icon = timelineIcon(event.eventName);
                const attribution = attributionLabel(event.attributionType);
                return (
                  <div key={event.id} className="relative pb-5 last:pb-0">
                    <div className={`absolute left-[-27px] top-0 h-7 w-7 rounded-full border-2 bg-card flex items-center justify-center ${index === 0 ? "border-primary" : "border-border"}`}>
                      <Icon className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="rounded-lg border border-border/70 bg-background/40 p-3">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold">{event.eventLabel}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatSaoPauloDateTime(event.occurredAt)} · agregado por {event.periodType}
                          </p>
                        </div>
                        {attribution && (
                          <Badge variant="outline" className="w-fit text-[11px]">
                            {attribution}
                          </Badge>
                        )}
                      </div>

                      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-5 gap-y-1.5 text-xs">
                        {event.productName && (
                          <span><strong>Produto:</strong> {event.productName}</span>
                        )}
                        {event.productSku && (
                          <span><strong>SKU:</strong> {event.productSku}</span>
                        )}
                        {event.categoryName && (
                          <span><strong>Categoria:</strong> {event.categoryName}</span>
                        )}
                        {event.orderId !== null && (
                          <span><strong>Pedido:</strong> #{event.orderId}</span>
                        )}
                        {event.utmCampaign && (
                          <span className="md:col-span-2 xl:col-span-3">
                            <strong>Campanha:</strong> {event.utmCampaign}
                          </span>
                        )}
                        {event.utmContent && (
                          <span><strong>Conteúdo:</strong> {event.utmContent}</span>
                        )}
                        {event.utmTerm && (
                          <span><strong>Termo:</strong> {event.utmTerm}</span>
                        )}
                        <span><strong>Origem:</strong> {event.normalizedSource}</span>
                        <span><strong>Medium:</strong> {event.normalizedMedium}</span>
                        {event.landingHost && (
                          <span><strong>Landing:</strong> {event.landingHost}{event.landingPath ?? ""}</span>
                        )}
                        {event.referrerHost && (
                          <span><strong>Referrer:</strong> {event.referrerHost}</span>
                        )}
                        {event.fbc && (
                          <span className="md:col-span-2 xl:col-span-3 truncate" title={event.fbc}>
                            <strong>FBC:</strong> {event.fbc}
                          </span>
                        )}
                        {event.fbclid && (
                          <span className="md:col-span-2 xl:col-span-3 truncate" title={event.fbclid}>
                            <strong>FBCLID:</strong> {event.fbclid}
                          </span>
                        )}
                        {event.gclid && (
                          <span className="md:col-span-2 xl:col-span-3 truncate" title={event.gclid}>
                            <strong>GCLID:</strong> {event.gclid}
                          </span>
                        )}
                        {(event.sessionId || event.visitorId || event.anonymousId) && (
                          <span className="md:col-span-2 xl:col-span-3 truncate" title={[event.sessionId, event.visitorId, event.anonymousId].filter(Boolean).join(" / ")}>
                            <strong>Tracking:</strong> {[event.sessionId, event.visitorId, event.anonymousId].filter(Boolean).join(" / ")}
                          </span>
                        )}
                        {event.deviceType && (
                          <span className="flex items-center gap-1">
                            <MonitorSmartphone className="h-3 w-3 text-muted-foreground" />
                            <strong>Dispositivo:</strong> {event.deviceType}
                          </span>
                        )}
                        <span><strong>Eventos:</strong> {formatNumber(event.totalEvents)}</span>
                        {event.totalQuantity > 0 && (
                          <span><strong>Quantidade:</strong> {formatNumber(event.totalQuantity)}</span>
                        )}
                        {event.totalValue > 0 && (
                          <span><strong>Valor:</strong> {formatCurrency(event.totalValue)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}
    </section>
  );
}

export default function CustomerDetailPage() {
  const params = useParams<{ customerId: string }>();
  const [, navigate] = useLocation();
  const { selectedClientId, user } = useAuth();
  const [activeTab, setActiveTab] = useState<TimelineTab>("events");
  const [timelineTo] = useState(() => new Date().toISOString());
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
  const timelineFrom = customer?.createdAt
    ? new Date(customer.createdAt).toISOString()
    : undefined;
  const {
    data: upzeroTimeline,
    isLoading: isTimelineLoading,
    isError: isTimelineError,
  } = useQuery({
    queryKey: ["customer-upzero-timeline", params.customerId, clientId, timelineFrom, timelineTo],
    queryFn: () => {
      const searchParams = new URLSearchParams({
        from: timelineFrom ?? "",
        to: timelineTo,
        lookbackDays: "30",
      });
      if (clientId) searchParams.set("clientId", clientId);
      return customFetch<CustomerTimelineResponse>(
        `/api/analytics/customers/${params.customerId}/timeline?${searchParams.toString()}`,
      );
    },
    enabled:
      !!params.customerId &&
      !!timelineFrom &&
      (user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId)),
  });

  const TABS: { key: TimelineTab; label: string; count: number }[] = [
    { key: "events", label: "Timeline", count: upzeroTimeline?.timeline.length ?? 0 },
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
                        {(() => {
                          const seller = (data as Record<string, unknown> | undefined)?.assignedSeller as string | null | undefined;
                          return seller ? (
                            <span className="flex items-center gap-1">
                              <User className="h-3.5 w-3.5" />
                              Seller: {seller}
                            </span>
                          ) : null;
                        })()}
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

      {/* Journey funnel + Attribution side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <motion.div variants={cardVariants} initial="hidden" animate="visible" className="lg:col-span-2">
          <Card className="h-full">
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

        <motion.div variants={cardVariants} initial="hidden" animate="visible">
          {isLoading ? (
            <Card className="h-full">
              <CardContent className="p-6 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
              </CardContent>
            </Card>
          ) : (
            <AttributionPanel
              utmSource={customer?.utmSource}
              utmMedium={customer?.utmMedium}
              utmCampaign={customer?.utmCampaign}
              approvalDate={customer?.approvalDate}
              registrationStatus={customer?.registrationStatus}
            />
          )}
        </motion.div>
      </div>

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
              <UpzeroTimelineSection
                data={upzeroTimeline}
                isLoading={isLoading || isTimelineLoading}
                isError={isTimelineError}
              />
            )}

            {activeTab === "orders" && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px] font-mono uppercase tracking-wider">Order ID</TableHead>
                      <TableHead className="text-[10px] font-mono uppercase tracking-wider text-right">Amount</TableHead>
                      <TableHead className="text-[10px] font-mono uppercase tracking-wider">Status</TableHead>
                      <TableHead className="text-[10px] font-mono uppercase tracking-wider">Seller</TableHead>
                      <TableHead className="text-[10px] font-mono uppercase tracking-wider">Items</TableHead>
                      <TableHead className="text-[10px] font-mono uppercase tracking-wider">Location</TableHead>
                      <TableHead className="text-[10px] font-mono uppercase tracking-wider text-right">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 7 }).map((__, j) => (
                            <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : !data?.orders.length ? (
                      <TableRow>
                        <TableCell colSpan={7} className="p-0">
                          <EmptyState
                            icon={ShoppingBag}
                            title="No orders yet"
                            description="This customer hasn't placed any orders."
                            className="border-0 bg-transparent py-8"
                          />
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
                            <TableCell>
                              {order.sellerName ? (
                                <span className="flex items-center gap-1 text-xs">
                                  <Building2 className="h-3 w-3 text-muted-foreground" />
                                  {order.sellerName}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
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
                      <TableHead className="text-[10px] font-mono uppercase tracking-wider text-right">Unit Price</TableHead>
                      <TableHead className="text-[10px] font-mono uppercase tracking-wider text-right">Qty</TableHead>
                      <TableHead className="text-[10px] font-mono uppercase tracking-wider text-right">Spent</TableHead>
                      <TableHead className="text-[10px] font-mono uppercase tracking-wider text-right">First Order</TableHead>
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
                    ) : !data?.productsPurchased.length ? (
                      <TableRow>
                        <TableCell colSpan={6} className="p-0">
                          <EmptyState
                            icon={Package}
                            title="No products purchased yet"
                            description="Products will appear here once the customer makes a purchase."
                            className="border-0 bg-transparent py-8"
                          />
                        </TableCell>
                      </TableRow>
                    ) : (
                      data?.productsPurchased.map((p) => (
                        <TableRow key={p.productId}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {p.imageUrl ? (
                                <img
                                  src={p.imageUrl}
                                  alt={p.name}
                                  className="h-8 w-8 rounded object-cover flex-shrink-0"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                />
                              ) : (
                                <div className="h-8 w-8 rounded bg-muted flex items-center justify-center flex-shrink-0">
                                  <Package className="h-3.5 w-3.5 text-muted-foreground" />
                                </div>
                              )}
                              <div>
                                <div className="font-medium text-sm">{p.name}</div>
                                <div className="text-xs text-muted-foreground font-mono">{p.sku}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{p.category ?? "—"}</TableCell>
                          <TableCell className="text-right text-sm">
                            {p.unitPrice != null ? formatCurrency(p.unitPrice) : "—"}
                          </TableCell>
                          <TableCell className="text-right">{formatNumber(p.quantity)}</TableCell>
                          <TableCell className="text-right font-semibold">{formatCurrency(p.totalSpent)}</TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">
                            {p.firstOrderDate ? (
                              <span className="flex items-center justify-end gap-1">
                                <Calendar className="h-3 w-3" />
                                {format(new Date(p.firstOrderDate), "MMM d, yyyy")}
                              </span>
                            ) : "—"}
                          </TableCell>
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
