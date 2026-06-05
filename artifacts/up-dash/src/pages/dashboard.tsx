import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { addDays, differenceInDays, format, subDays } from "date-fns";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import {
  customFetch,
  useGetDashboard,
  useGetInsight,
  useRegenerateInsight,
  getGetInsightQueryKey,
  useGetAlerts,
  useGetSellers,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronRight,
  CircleDot,
  DollarSign,
  Download,
  Eye,
  FileText,
  Info,
  LogIn,
  Megaphone,
  MessageCircle,
  Package,
  PackageX,
  RefreshCw,
  Store,
  Sparkles,
  Target,
  Tag,
  TrendingDown,
  TrendingUp,
  CreditCard,
  MousePointerClick,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  UserPlus,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency, formatCurrencySmart, formatPercentage, formatNumber } from "@/lib/formatters";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
} from "recharts";
import { CountUp } from "@/components/count-up";
import { DrillDownPanel } from "@/components/drill-down-panel";
import {
  fadeInUp,
  staggerContainer,
  useReducedMotion,
  withReducedMotion,
} from "@/lib/motion";
import { exportRowsAsCsv } from "@/lib/csv-export";
import { DashboardKpiCard } from "@/components/dashboard-kpi-card";

function computeChange(current: number | undefined, previous: number | undefined): number | null {
  if (current === undefined || previous === undefined) return null;
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

function ProductMiniature({ imageUrl, name }: { imageUrl?: string | null; name: string }) {
  const [imgError, setImgError] = useState(false);
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

  if (imageUrl && !imgError) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className="h-9 w-9 shrink-0 rounded-md border border-border object-cover"
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-primary/10 text-[10px] font-semibold text-primary">
      {initials || "PR"}
    </div>
  );
}

const CHART_METRICS = [
  { id: "revenue", label: "Revenue", formatter: (v: number) => formatCurrency(v) },
  { id: "orders", label: "Orders", formatter: (v: number) => formatNumber(v) },
  { id: "avgTicket", label: "Avg ticket", formatter: (v: number) => formatCurrency(v) },
  { id: "sessions", label: "Sessions", formatter: (v: number) => formatNumber(v) },
  { id: "conversionRate", label: "Conversion", formatter: (v: number) => formatPercentage(v) },
] as const;

type ChartMetric = (typeof CHART_METRICS)[number]["id"];

type CampaignCustomerRow = {
  customerId: string | null;
  userId: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  type: string | null;
  cpf: string | null;
  cnpj: string | null;
  companyName: string | null;
  documentType: "CPF" | "CNPJ" | null;
  registrationStatus: string | null;
  registeredAt: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  firstTouch: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    occurredAt: string | null;
  };
  lastTouch: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    occurredAt: string | null;
  };
  returnTouch: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    occurredAt: string | null;
  } | null;
  campaigns: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
    eventsCount: number;
  }[];
  hasPurchase: boolean;
  isRemarketing: boolean;
  purchaseCount: number;
  orderIds: number[];
  totalPurchaseValue: number;
  addToCartCount: number;
  checkoutCount: number;
  registerSubmittedCount: number;
  productViewCount: number;
  lastEventName: string | null;
  lastEventAt: string | null;
};

const CAMPAIGN_CUSTOMER_STATUS_DOT: Record<string, string> = {
  APPROVED: "bg-emerald-500",
  PENDING: "bg-amber-400",
  REJECTED: "bg-red-500",
};

type CampaignCustomerSortKey =
  | "totalPurchaseValue"
  | "purchaseCount"
  | "productViewCount"
  | "lastEventAt"
  | "firstSeenAt"
  | "name";

type CampaignCustomersResponse = {
  rows: CampaignCustomerRow[];
  data?: CampaignCustomerRow[];
  total: number;
  filters?: {
    sources: string[];
    campaigns: string[];
    customerTypes: string[];
  };
  summary: {
    impactedCustomers: number;
    attributedRevenue: number;
    orders: number;
    itemQuantity: number;
    registrations: number;
  };
};

type CustomerTimelineEvent = {
  id: string;
  occurredAt: string;
  eventName: string;
  eventLabel: string;
  productName: string | null;
  productSku: string | null;
  productImageUrl?: string | null;
  categoryName: string | null;
  orderId: number | null;
  utmCampaign: string | null;
  normalizedSource: string;
  normalizedMedium: string;
  deviceType: string | null;
  totalEvents: number;
  totalQuantity: number;
  totalValue: number;
  attributionType: "first_touch" | "last_touch" | "return_touch" | "direct" | null;
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

type CustomerTimelineResponse = {
  userId: number;
  summary: {
    totalEvents: number;
    productViews: number;
    categoryViews: number;
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

type B2COrderRow = {
  id: string;
  externalId: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "SHIPPED" | "DELIVERED";
  amount: number;
  fulfilledAmount: number;
  grossAmount: number;
  discountAmount: number;
  shippingAmount: number;
  refundedAmount: number;
  cancelledAmount: number;
  requestedQuantity: number;
  fulfilledQuantity: number;
  createdAt: string;
  customerId: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  state: string | null;
  city: string | null;
};

type B2COrdersResponse = {
  rows: B2COrderRow[];
  page: number;
  limit: number;
  total: number;
};

type B2COrderDetailsResponse = {
  order: B2COrderRow & {
    approvalDate: string | null;
  };
  customer: {
    id: string | null;
    externalId: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
    state: string | null;
    city: string | null;
    firstPurchaseAt: string | null;
    lastPurchaseAt: string | null;
    totalOrders: number | null;
    totalSpent: number | null;
  };
  items: Array<{
    id: string;
    quantity: number;
    fulfilledQuantity: number;
    priceAtSale: number;
    grossPriceAtSale: number;
    discountAmount: number;
    size: string | null;
    color: string | null;
    productId: string;
    sku: string;
    name: string;
    category: string | null;
    imageUrl: string | null;
  }>;
};

function detectAnomalies(series: { date: string; value: number }[]): { date: string; value: number }[] {
  // ±2σ from the series mean — flag any point whose value is more than two
  // standard deviations away from the average for the visible date range.
  if (series.length < 4) return [];
  const mean = series.reduce((s, p) => s + p.value, 0) / series.length;
  const variance =
    series.reduce((s, p) => s + Math.pow(p.value - mean, 2), 0) / series.length;
  const std = Math.sqrt(variance);
  if (std === 0) return [];
  return series.filter((p) => Math.abs(p.value - mean) >= 2 * std);
}

function formatCampaignDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTimelineDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function timelineEventMeta(eventName: string): {
  icon: React.ElementType;
  bg: string;
  border: string;
  color: string;
} {
  if (["product_view", "product_item_impression"].includes(eventName)) {
    return { icon: Package, bg: "bg-blue-500/10", border: "border-blue-500/30", color: "text-blue-400" };
  }
  if (eventName === "product_item_click") {
    return { icon: MousePointerClick, bg: "bg-cyan-500/10", border: "border-cyan-500/30", color: "text-cyan-400" };
  }
  if (eventName === "category_view") {
    return { icon: Tag, bg: "bg-violet-500/10", border: "border-violet-500/30", color: "text-violet-400" };
  }
  if (eventName === "add_to_cart") {
    return { icon: ShoppingCart, bg: "bg-emerald-500/10", border: "border-emerald-500/30", color: "text-emerald-400" };
  }
  if (eventName === "remove_from_cart") {
    return { icon: Trash2, bg: "bg-red-500/10", border: "border-red-500/30", color: "text-red-400" };
  }
  if (eventName === "cart_view") {
    return { icon: ShoppingCart, bg: "bg-teal-500/10", border: "border-teal-500/30", color: "text-teal-400" };
  }
  if (["initiate_checkout", "checkout_start", "checkout_started"].includes(eventName)) {
    return { icon: CreditCard, bg: "bg-amber-500/10", border: "border-amber-500/30", color: "text-amber-400" };
  }
  if (["purchase", "order_created", "order_paid", "payment_approved"].includes(eventName)) {
    return { icon: ShoppingBag, bg: "bg-fuchsia-500/10", border: "border-fuchsia-500/30", color: "text-fuchsia-400" };
  }
  if (eventName === "login") {
    return { icon: LogIn, bg: "bg-sky-500/10", border: "border-sky-500/30", color: "text-sky-400" };
  }
  if (["register_submitted", "register_start"].includes(eventName)) {
    return { icon: UserPlus, bg: "bg-lime-500/10", border: "border-lime-500/30", color: "text-lime-400" };
  }
  if (eventName === "form_start") {
    return { icon: FileText, bg: "bg-orange-500/10", border: "border-orange-500/30", color: "text-orange-400" };
  }
  if (eventName === "page_view") {
    return { icon: Eye, bg: "bg-muted/40", border: "border-border", color: "text-muted-foreground" };
  }
  return { icon: MousePointerClick, bg: "bg-primary/10", border: "border-primary/30", color: "text-primary" };
}

function attributionLabel(value: CustomerTimelineEvent["attributionType"]) {
  if (value === "first_touch") return "Primeira campanha";
  if (value === "last_touch") return "Última campanha conhecida";
  if (value === "return_touch") return "Campanha de retorno";
  if (value === "direct") return "Direto";
  return null;
}

type TimelineListItem =
  | { type: "event"; event: CustomerTimelineEvent }
  | { type: "product_group"; id: string; events: CustomerTimelineEvent[] };

type TimelineDayGroup = {
  key: string;
  date: string;
  items: TimelineListItem[];
};

function isProductTimelineEvent(event: CustomerTimelineEvent) {
  return ["product_view", "product_item_impression", "product_item_click"].includes(event.eventName);
}

function groupProductTimelineEvents(events: CustomerTimelineEvent[]): TimelineListItem[] {
  const items: TimelineListItem[] = [];
  let productEvents: CustomerTimelineEvent[] = [];

  const flush = () => {
    if (productEvents.length === 1) {
      const event = productEvents[0];
      if (event) items.push({ type: "event", event });
    } else if (productEvents.length > 1) {
      items.push({
        type: "product_group",
        id: `products_${productEvents[0]?.id ?? items.length}`,
        events: productEvents,
      });
    }
    productEvents = [];
  };

  for (const event of events) {
    if (isProductTimelineEvent(event)) {
      productEvents.push(event);
      continue;
    }
    flush();
    items.push({ type: "event", event });
  }

  flush();
  return items;
}

function timelineDateKey(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function formatTimelineDay(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function groupTimelineItemsByDay(items: TimelineListItem[]): TimelineDayGroup[] {
  const groups = new Map<string, TimelineDayGroup>();

  for (const item of items) {
    const date = item.type === "event" ? item.event.occurredAt : item.events[0]!.occurredAt;
    const key = timelineDateKey(date);
    const current = groups.get(key) ?? { key, date, items: [] };
    current.items.push(item);
    groups.set(key, current);
  }

  return Array.from(groups.values());
}

function productPreviewImages(events: CustomerTimelineEvent[]) {
  const seen = new Set<string>();
  const images: Array<{ src: string; alt: string }> = [];
  for (const event of events) {
    if (!event.productImageUrl || seen.has(event.productImageUrl)) continue;
    seen.add(event.productImageUrl);
    images.push({ src: event.productImageUrl, alt: event.productName ?? event.eventLabel });
    if (images.length >= 4) break;
  }
  return images;
}

function whatsappDirectUrl(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/\D/g, "") ?? "";
  if (!digits) return null;
  const normalized = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${normalized}`;
}

function CampaignCustomersPanel({
  data,
  isLoading,
  isError,
  clientId,
  dateFrom,
  dateTo,
}: {
  data?: CampaignCustomersResponse;
  isLoading: boolean;
  isError: boolean;
  clientId?: string;
  dateFrom: string;
  dateTo: string;
}) {
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [documentFilter, setDocumentFilter] = useState("all");
  const [purchaseFilter, setPurchaseFilter] = useState("all");
  const [remarketingFilter, setRemarketingFilter] = useState("all");
  const [customerTypeFilter, setCustomerTypeFilter] = useState("all");
  const [sortKey, setSortKey] = useState<CampaignCustomerSortKey>("lastEventAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [timelineRow, setTimelineRow] = useState<CampaignCustomerRow | null>(null);

  const {
    data: timelineData,
    isLoading: timelineLoading,
    isError: timelineError,
  } = useQuery<CustomerTimelineResponse>({
    queryKey: ["campaign-customer-timeline", clientId, timelineRow?.userId, dateFrom, dateTo],
    queryFn: () => {
      if (!timelineRow) throw new Error("Cliente não selecionado.");
      const params = new URLSearchParams({
        userId: String(timelineRow.userId),
        dateFrom,
        dateTo,
      });
      if (clientId) params.set("clientId", clientId);
      return customFetch<CustomerTimelineResponse>(
        `/api/analytics/customer-timeline-by-user?${params.toString()}`,
      );
    },
    enabled: !!timelineRow,
  });
  const groupedTimelineItems = useMemo(
    () => groupProductTimelineEvents(timelineData?.timeline ?? []),
    [timelineData?.timeline],
  );
  const timelineDayGroups = useMemo(
    () => groupTimelineItemsByDay(groupedTimelineItems),
    [groupedTimelineItems],
  );
  const timelineWhatsappUrl = whatsappDirectUrl(timelineRow?.phone);

  const visibleRows = useMemo(() => {
    const rows = [...(data?.rows ?? [])].filter((row) => {
      if (sourceFilter !== "all" && row.lastTouch.source !== sourceFilter) return false;
      if (campaignFilter !== "all" && !row.campaigns.some((campaign) => campaign.campaign === campaignFilter)) return false;
      if (documentFilter === "CPF" && row.documentType !== "CPF") return false;
      if (documentFilter === "CNPJ" && row.documentType !== "CNPJ") return false;
      if (documentFilter === "none" && row.documentType !== null) return false;
      if (customerTypeFilter !== "all" && row.type !== customerTypeFilter) return false;
      if (purchaseFilter === "buyers" && !row.hasPurchase) return false;
      if (purchaseFilter === "non_buyers" && row.hasPurchase) return false;
      if (remarketingFilter === "yes" && !row.isRemarketing) return false;
      if (remarketingFilter === "no" && row.isRemarketing) return false;
      if (search.trim()) {
        const term = search.trim().toLowerCase();
        const haystack = [
          row.userId.toString(),
          row.name,
          row.email,
          row.companyName,
          row.cpf,
          row.cnpj,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });

    rows.sort((a, b) => {
      const direction = sortDir === "asc" ? 1 : -1;
      if (sortKey === "name") {
        return direction * (a.name || a.email || `UP Zero ${a.userId}`).localeCompare(b.name || b.email || `UP Zero ${b.userId}`);
      }
      if (sortKey === "lastEventAt" || sortKey === "firstSeenAt") {
        const aTime = a[sortKey] ? new Date(a[sortKey] as string).getTime() : 0;
        const bTime = b[sortKey] ? new Date(b[sortKey] as string).getTime() : 0;
        return direction * (aTime - bTime);
      }
      return direction * ((a[sortKey] as number) - (b[sortKey] as number));
    });

    return rows;
  }, [
    campaignFilter,
    customerTypeFilter,
    data?.rows,
    documentFilter,
    purchaseFilter,
    remarketingFilter,
    search,
    sortDir,
    sortKey,
    sourceFilter,
  ]);

  const setSort = (key: CampaignCustomerSortKey) => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "name" ? "asc" : "desc");
  };

  const SortHeader = ({
    children,
    sort,
    align = "left",
  }: {
    children: React.ReactNode;
    sort: CampaignCustomerSortKey;
    align?: "left" | "right";
  }) => (
    <button
      type="button"
      onClick={() => setSort(sort)}
      className={`inline-flex w-full items-center gap-1 font-medium hover:text-foreground ${
        align === "right" ? "justify-end text-right" : "justify-start"
      }`}
    >
      {children}
      <span className="text-[9px] text-muted-foreground">
        {sortKey === sort ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );

  return (
    <Card className="p-5 bg-card border-border" data-testid="campaign-customers-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold leading-tight flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-primary" />
            Clientes atribuídos às campanhas
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Clientes e cadastros com UTM de campanhas pagas: fb, ig, gc, up e derivados. Linktree fica fora desta lista.
          </p>
        </div>
        {data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-right">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Clientes</p>
              <p className="text-sm font-semibold tabular-nums">{formatNumber(data.summary.impactedCustomers)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Receita</p>
              <p className="text-sm font-semibold tabular-nums">{formatCurrency(data.summary.attributedRevenue)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pedidos</p>
              <p className="text-sm font-semibold tabular-nums">{formatNumber(data.summary.orders)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Cadastros</p>
              <p className="text-sm font-semibold tabular-nums">{formatNumber(data.summary.registrations)}</p>
            </div>
          </div>
        )}
      </div>

      {data && data.rows.length > 0 && (
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs"
            placeholder="Buscar nome, empresa, doc ou ID"
            aria-label="Buscar cliente atribuído"
          />
          <select
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs"
            aria-label="Filtrar por origem"
          >
            <option value="all">Origem: todas</option>
            {(data.filters?.sources ?? []).map((source) => (
              <option key={source} value={source}>{source}</option>
            ))}
          </select>
          <select
            value={campaignFilter}
            onChange={(event) => setCampaignFilter(event.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs"
            aria-label="Filtrar por campanha"
          >
            <option value="all">Campanha: todas</option>
            {(data.filters?.campaigns ?? []).map((campaign) => (
              <option key={campaign} value={campaign}>{campaign}</option>
            ))}
          </select>
          <select
            value={documentFilter}
            onChange={(event) => setDocumentFilter(event.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs"
            aria-label="Filtrar por documento"
          >
            <option value="all">Documento: todos</option>
            <option value="CPF">CPF</option>
            <option value="CNPJ">CNPJ</option>
            <option value="none">Sem documento</option>
          </select>
          <select
            value={customerTypeFilter}
            onChange={(event) => setCustomerTypeFilter(event.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs"
            aria-label="Filtrar por tipo de cliente"
          >
            <option value="all">Tipo: todos</option>
            {(data.filters?.customerTypes ?? []).map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <select
            value={purchaseFilter}
            onChange={(event) => setPurchaseFilter(event.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs"
            aria-label="Filtrar por compra"
          >
            <option value="all">Compra: todos</option>
            <option value="buyers">Fez compra</option>
            <option value="non_buyers">Não comprou</option>
          </select>
          <select
            value={remarketingFilter}
            onChange={(event) => setRemarketingFilter(event.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs"
            aria-label="Filtrar por remarketing"
          >
            <option value="all">Remarketing: todos</option>
            <option value="yes">Remarketing sim</option>
            <option value="no">Remarketing não</option>
          </select>
          <select
            value={`${sortKey}:${sortDir}`}
            onChange={(event) => {
              const [key, dir] = event.target.value.split(":") as [CampaignCustomerSortKey, "asc" | "desc"];
              setSortKey(key);
              setSortDir(dir);
            }}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs"
            aria-label="Ordenar clientes atribuídos"
          >
            <option value="lastEventAt:desc">Última atividade</option>
            <option value="totalPurchaseValue:desc">Maior valor</option>
            <option value="purchaseCount:desc">Mais pedidos</option>
            <option value="productViewCount:desc">Mais produtos vistos</option>
            <option value="firstSeenAt:desc">Primeira atividade recente</option>
            <option value="name:asc">Nome A-Z</option>
          </select>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Não foi possível carregar os clientes atribuídos às campanhas.</AlertDescription>
        </Alert>
      ) : !data || data.rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary mb-3">
            <Megaphone className="h-5 w-5" />
          </div>
          <p className="text-sm font-medium">Nenhum cliente atribuído no período</p>
          <p className="text-xs text-muted-foreground mt-1">
            A lista aparece quando a UP Zero retorna eventos identificados por user.id ou user_id com UTM/campanha paga.
          </p>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <p className="text-sm font-medium">Nenhum cliente com esses filtros</p>
          <p className="text-xs text-muted-foreground mt-1">
            Ajuste CPF/CNPJ, compra, remarketing ou status para voltar a visualizar os cadastros atribuídos.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-4"><SortHeader sort="name">Cliente</SortHeader></th>
                <th className="py-2 px-3 font-medium">Tipo / Documento</th>
                <th className="py-2 px-3 font-medium">Empresa</th>
                <th className="py-2 px-3 font-medium">Primeira campanha</th>
                <th className="py-2 px-3 font-medium">Última campanha</th>
                <th className="py-2 px-3 font-medium">Compra / RMKT</th>
                <th className="py-2 px-3"><SortHeader sort="purchaseCount" align="right">Pedidos</SortHeader></th>
                <th className="py-2 px-3"><SortHeader sort="totalPurchaseValue" align="right">Valor</SortHeader></th>
                <th className="py-2 px-3"><SortHeader sort="productViewCount" align="right">Produtos vistos</SortHeader></th>
                <th className="py-2 pl-3"><SortHeader sort="lastEventAt" align="right">Última atividade</SortHeader></th>
                <th className="py-2 pl-3 font-medium text-right">Histórico</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={`${row.userId}-${row.customerId ?? "upzero"}`} className="border-b border-border/60 last:border-0 hover-elevate">
                  <td className="py-3 pr-4 min-w-[220px]">
                    <div className="flex items-start gap-2">
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          row.registrationStatus
                            ? CAMPAIGN_CUSTOMER_STATUS_DOT[row.registrationStatus] ?? "bg-zinc-400"
                            : "bg-zinc-400"
                        }`}
                        title={row.registrationStatus ?? "Status não identificado"}
                        aria-label={row.registrationStatus ?? "Status não identificado"}
                      />
                      {row.customerId ? (
                        <Link href={`/customers/${row.customerId}`} className="block min-w-0">
                          <div className="font-medium hover:text-primary truncate">
                            {row.name || row.email || `UP Zero ${row.userId}`}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {[row.email, `UP Zero ${row.userId}`].filter(Boolean).join(" · ")}
                          </div>
                        </Link>
                      ) : (
                        <div className="min-w-0">
                          <div className="font-medium truncate">{row.name || `UP Zero ${row.userId}`}</div>
                          <div className="text-xs text-muted-foreground truncate">Sem cadastro local · UP Zero {row.userId}</div>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-3 min-w-[150px]">
                    <div className="font-medium">{row.type ?? "—"}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {row.cpf && (
                        <span className="inline-flex rounded-md bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-400">
                          CPF {row.cpf}
                        </span>
                      )}
                      {row.cnpj && (
                        <span className="inline-flex rounded-md bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-400">
                          CNPJ {row.cnpj}
                        </span>
                      )}
                      {!row.cpf && !row.cnpj && row.documentType && (
                        <span className="inline-flex rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {row.documentType} cadastrado
                        </span>
                      )}
                      {!row.cpf && !row.cnpj && !row.documentType && (
                        <span className="text-xs text-muted-foreground">Documento não retornado</span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-3 min-w-[180px]">
                    <div className="font-medium truncate" title={row.companyName ?? undefined}>
                      {row.companyName ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      1ª atividade: {formatCampaignDate(row.firstSeenAt)}
                    </div>
                  </td>
                  <td className="py-3 px-3 min-w-[260px]">
                    <div className="font-medium truncate" title={row.firstTouch.campaign ?? "—"}>
                      {row.firstTouch.campaign ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {[row.firstTouch.source, row.firstTouch.medium].filter(Boolean).join(" / ") || "Origem não identificada"} · {formatCampaignDate(row.firstTouch.occurredAt)}
                    </div>
                  </td>
                  <td className="py-3 px-3 min-w-[260px]">
                    <div className="font-medium truncate" title={row.lastTouch.campaign ?? "—"}>
                      {row.lastTouch.campaign ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {[row.lastTouch.source, row.lastTouch.medium].filter(Boolean).join(" / ") || "Origem não identificada"} · {formatCampaignDate(row.lastTouch.occurredAt)}
                    </div>
                    {row.returnTouch && (
                      <div className="text-xs text-muted-foreground truncate">
                        Retorno: {row.returnTouch.campaign ?? "campanha diferente"}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-3 min-w-[190px]">
                    <div className="flex flex-wrap gap-1.5">
                      <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-medium ${
                        row.hasPurchase ? "bg-emerald-500/10 text-emerald-400" : "bg-muted/50 text-muted-foreground"
                      }`}>
                        Compra: {row.hasPurchase ? "Sim" : "Não"}
                      </span>
                      <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-medium ${
                        row.isRemarketing ? "bg-fuchsia-500/10 text-fuchsia-400" : "bg-muted/50 text-muted-foreground"
                      }`}>
                        RMKT: {row.isRemarketing ? "Sim" : "Não"}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-right tabular-nums">{formatNumber(row.purchaseCount)}</td>
                  <td className="py-3 px-3 text-right font-semibold tabular-nums">{formatCurrency(row.totalPurchaseValue)}</td>
                  <td className="py-3 px-3 text-right tabular-nums">{formatNumber(row.productViewCount)}</td>
                  <td className="py-3 pl-3 text-right min-w-[150px]">
                    <div className="tabular-nums">{formatCampaignDate(row.lastEventAt)}</div>
                    <div className="text-xs text-muted-foreground">{row.lastEventName ?? "—"}</div>
                  </td>
                  <td className="py-3 pl-3 text-right min-w-[120px]">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => setTimelineRow(row)}
                      data-testid={`campaign-customer-timeline-${row.userId}`}
                    >
                      Ver timeline
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!timelineRow} onOpenChange={(open) => !open && setTimelineRow(null)}>
        <DialogContent className="max-h-[84vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Timeline de {timelineRow?.name || timelineRow?.email || `UP Zero ${timelineRow?.userId ?? ""}`}
            </DialogTitle>
            <DialogDescription>
              Eventos identificados pelo user.id da UP Zero no período selecionado.
            </DialogDescription>
          </DialogHeader>

          {timelineLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : timelineError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Não foi possível carregar a timeline deste cliente.</AlertDescription>
            </Alert>
          ) : timelineData && timelineData.timeline.length > 0 ? (
            <div className="space-y-4">
              <div className="flex justify-end">
                {timelineWhatsappUrl ? (
                  <Button asChild size="sm" className="w-full sm:w-auto">
                    <a href={timelineWhatsappUrl} target="_blank" rel="noopener noreferrer">
                      <MessageCircle className="h-4 w-4" />
                      Enviar mensagem no WhatsApp
                    </a>
                  </Button>
                ) : (
                  <Button type="button" size="sm" disabled className="w-full sm:w-auto">
                    <MessageCircle className="h-4 w-4" />
                    WhatsApp sem telefone
                  </Button>
                )}
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Eventos</p>
                  <p className="text-lg font-semibold tabular-nums">{formatNumber(timelineData.summary.totalEvents)}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Produtos vistos</p>
                  <p className="text-lg font-semibold tabular-nums">{formatNumber(timelineData.summary.productViews)}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Carrinhos</p>
                  <p className="text-lg font-semibold tabular-nums">{formatNumber(timelineData.summary.addToCartEvents)}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Valor comprado</p>
                  <p className="text-lg font-semibold tabular-nums">{formatCurrency(timelineData.summary.totalPurchaseValue)}</p>
                </div>
              </div>

              <div className="space-y-6">
                {timelineDayGroups.map((group) => (
                  <div key={group.key} className="grid gap-3 md:grid-cols-9 md:items-start">
                    <div className="md:col-span-2">
                      <time dateTime={group.key} className="text-sm font-semibold text-muted-foreground md:text-base">
                        {formatTimelineDay(group.date)}
                      </time>
                    </div>
                    <div className="relative md:col-span-7">
                      <div className="absolute left-3 top-0 bottom-0 hidden w-px bg-border md:block" />
                      <div className="space-y-3 md:pl-10">
                        {group.items.map((item, index) => {
                          if (item.type === "product_group") {
                            const firstEvent = item.events[0]!;
                            const lastEvent = item.events[item.events.length - 1]!;
                            const uniqueProducts = new Set(
                              item.events.map((event) => event.productName ?? event.productSku ?? event.id),
                            ).size;
                            const totalViews = item.events.reduce((sum, event) => sum + event.totalEvents, 0);
                            const previewImages = productPreviewImages(item.events);
                            return (
                              <details key={item.id} className="group relative rounded-lg border border-border bg-card">
                                <div className="absolute -left-[39px] top-4 hidden h-6 w-6 items-center justify-center rounded-full border border-blue-500/30 bg-blue-500/10 md:flex">
                                  <Package className="h-3.5 w-3.5 text-blue-400" />
                                </div>
                                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3">
                                  <div className="flex min-w-0 items-center gap-3">
                                    <div className="flex -space-x-2">
                                      {previewImages.length > 0 ? (
                                        previewImages.map((image) => (
                                          <img
                                            key={image.src}
                                            src={image.src}
                                            alt={image.alt}
                                            className="h-10 w-10 rounded-md border border-background object-cover shadow-sm"
                                            loading="lazy"
                                          />
                                        ))
                                      ) : (
                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-blue-500/30 bg-blue-500/10">
                                          <Package className="h-4 w-4 text-blue-400" />
                                        </div>
                                      )}
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-sm font-semibold">Produtos visualizados</p>
                                      <p className="text-xs text-muted-foreground">
                                        {formatTimelineDate(firstEvent.occurredAt)}
                                        {lastEvent.id !== firstEvent.id ? ` - ${formatTimelineDate(lastEvent.occurredAt)}` : ""}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        {formatNumber(uniqueProducts)} produto(s), {formatNumber(totalViews)} visualização(ões)
                                      </p>
                                    </div>
                                  </div>
                                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                                </summary>
                                <div className="space-y-2 border-t border-border p-3 pt-2">
                                  {item.events.map((event) => (
                                    <div key={event.id} className="flex gap-3 rounded-md bg-muted/20 p-2">
                                      {event.productImageUrl ? (
                                        <img
                                          src={event.productImageUrl}
                                          alt={event.productName ?? event.eventLabel}
                                          className="h-10 w-10 shrink-0 rounded-md border border-border object-cover"
                                          loading="lazy"
                                        />
                                      ) : (
                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-blue-500/30 bg-blue-500/10">
                                          <Package className="h-4 w-4 text-blue-400" />
                                        </div>
                                      )}
                                      <div className="min-w-0 flex-1 text-xs">
                                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                          <p className="truncate font-medium text-foreground" title={event.productName ?? event.eventLabel}>
                                            {event.productName ?? event.eventLabel}
                                          </p>
                                          <span className="shrink-0 text-muted-foreground">{formatTimelineDate(event.occurredAt)}</span>
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                                          {event.productSku && <span>SKU: {event.productSku}</span>}
                                          <span>Eventos: {formatNumber(event.totalEvents)}</span>
                                          {event.deviceType && <span>Dispositivo: {event.deviceType}</span>}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            );
                          }
                          const event = item.event;
                          const attribution = attributionLabel(event.attributionType);
                          const meta = timelineEventMeta(event.eventName);
                          const Icon = meta.icon;
                          return (
                            <div key={event.id} className="relative rounded-lg border border-border bg-card p-3">
                              <div className={`absolute -left-[39px] top-4 hidden h-6 w-6 items-center justify-center rounded-full border md:flex ${meta.bg} ${index === 0 ? "border-primary" : meta.border}`}>
                                <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
                              </div>
                              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                                <div className="flex min-w-0 gap-3">
                                  {event.productImageUrl ? (
                                    <img
                                      src={event.productImageUrl}
                                      alt={event.productName ?? event.eventLabel}
                                      className="h-12 w-12 shrink-0 rounded-md border border-border object-cover"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-md border ${meta.bg} ${meta.border}`}>
                                      <Icon className={`h-5 w-5 ${meta.color}`} />
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold">{event.eventLabel}</p>
                                    <p className="text-xs text-muted-foreground">{formatTimelineDate(event.occurredAt)}</p>
                                    {event.productName && (
                                      <p className="mt-1 truncate text-xs text-foreground" title={event.productName}>
                                        {event.productName}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <div className="text-left text-xs text-muted-foreground sm:text-right">
                                  <div>{event.normalizedSource} / {event.normalizedMedium}</div>
                                  {event.deviceType && <div>Dispositivo: {event.deviceType}</div>}
                                </div>
                              </div>
                              <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                                {event.productSku && <div>SKU: <span className="text-foreground">{event.productSku}</span></div>}
                                {event.categoryName && <div>Categoria: <span className="text-foreground">{event.categoryName}</span></div>}
                                {event.orderId && <div>Pedido: <span className="text-foreground">#{event.orderId}</span></div>}
                                {event.utmCampaign && <div className="sm:col-span-2">Campanha: <span className="text-foreground">{event.utmCampaign}</span></div>}
                                <div>Eventos: <span className="text-foreground">{formatNumber(event.totalEvents)}</span></div>
                                {event.totalQuantity > 0 && <div>Quantidade: <span className="text-foreground">{formatNumber(event.totalQuantity)}</span></div>}
                                {event.totalValue > 0 && <div>Valor: <span className="text-foreground">{formatCurrency(event.totalValue)}</span></div>}
                                {attribution && <div>Atribuição: <span className="text-foreground">{attribution}</span></div>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-muted/20 p-6 text-center">
              <p className="text-sm font-medium">Sem eventos identificados neste período</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Amplie o período para buscar mais eventos com user.id {timelineRow?.userId}.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function B2COrdersPanel({
  clientId,
  dateFrom,
  dateTo,
  enabled,
}: {
  clientId?: string;
  dateFrom: string;
  dateTo: string;
  enabled: boolean;
}) {
  const [page, setPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState<B2COrderRow | null>(null);
  const limit = 10;

  const { data, isLoading, isError } = useQuery<B2COrdersResponse>({
    queryKey: ["b2c-orders", clientId, dateFrom, dateTo, page],
    queryFn: () => {
      const params = new URLSearchParams({ dateFrom, dateTo, page: String(page), limit: String(limit) });
      if (clientId) params.set("clientId", clientId);
      return customFetch<B2COrdersResponse>(`/api/analytics/b2c/orders?${params.toString()}`);
    },
    enabled,
  });

  const { data: details, isLoading: detailsLoading, isError: detailsError } = useQuery<B2COrderDetailsResponse>({
    queryKey: ["b2c-order-details", clientId, selectedOrder?.id],
    queryFn: () => {
      if (!selectedOrder) throw new Error("Pedido não selecionado.");
      const params = new URLSearchParams();
      if (clientId) params.set("clientId", clientId);
      const qs = params.toString();
      return customFetch<B2COrderDetailsResponse>(
        `/api/analytics/b2c/orders/${selectedOrder.id}${qs ? `?${qs}` : ""}`,
      );
    },
    enabled: enabled && !!selectedOrder,
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / limit));

  return (
    <Card className="p-5 bg-card border-border" data-testid="b2c-orders-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold leading-tight flex items-center gap-2">
            <ShoppingBag className="h-4 w-4 text-primary" />
            Pedidos do período
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Lista paginada com detalhes de cliente, valores, frete, desconto e produtos.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</p>
          <p className="text-sm font-semibold tabular-nums">{formatNumber(data?.total ?? 0)} pedidos</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Não foi possível carregar os pedidos.</AlertDescription>
        </Alert>
      ) : !data || data.rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <ShoppingBag className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm font-medium">Nenhum pedido no período</p>
          <p className="text-xs text-muted-foreground mt-1">Amplie o filtro de data ou sincronize a Nuvemshop.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-4">Pedido</th>
                  <th className="py-2 px-3">Cliente</th>
                  <th className="py-2 px-3 text-right">Pago</th>
                  <th className="py-2 px-3 text-right">Faturado</th>
                  <th className="py-2 px-3 text-right">Frete</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 pl-3 text-right">Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((order) => (
                  <tr key={order.id} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                    <td className="py-3 pr-4 min-w-[150px]">
                      <div className="font-medium">#{order.externalId ?? order.id.slice(0, 8)}</div>
                      <div className="text-xs text-muted-foreground">{formatTimelineDate(order.createdAt)}</div>
                    </td>
                    <td className="py-3 px-3 min-w-[220px]">
                      <div className="font-medium truncate">{order.customerName ?? order.customerEmail ?? "Cliente sem nome"}</div>
                      <div className="text-xs text-muted-foreground truncate">{order.customerEmail ?? order.customerPhone ?? "—"}</div>
                    </td>
                    <td className="py-3 px-3 text-right font-semibold tabular-nums">{formatCurrency(order.fulfilledAmount)}</td>
                    <td className="py-3 px-3 text-right tabular-nums">{formatCurrency(order.amount)}</td>
                    <td className="py-3 px-3 text-right tabular-nums">{formatCurrency(order.shippingAmount)}</td>
                    <td className="py-3 px-3">
                      <span className="inline-flex rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold">
                        {order.status}
                      </span>
                    </td>
                    <td className="py-3 pl-3 text-right">
                      <Button type="button" size="sm" variant="outline" onClick={() => setSelectedOrder(order)}>
                        Abrir
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
            <span>Página {formatNumber(page)} de {formatNumber(totalPages)}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Anterior
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                Próxima
              </Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="max-h-[84vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pedido #{selectedOrder?.externalId ?? selectedOrder?.id.slice(0, 8)}</DialogTitle>
            <DialogDescription>Detalhes importados da Nuvemshop para o período filtrado.</DialogDescription>
          </DialogHeader>
          {detailsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : detailsError || !details ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Não foi possível carregar os detalhes deste pedido.</AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pago</p>
                  <p className="text-lg font-semibold">{formatCurrency(details.order.fulfilledAmount)}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Bruto</p>
                  <p className="text-lg font-semibold">{formatCurrency(details.order.grossAmount)}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Desconto</p>
                  <p className="text-lg font-semibold">{formatCurrency(details.order.discountAmount)}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Frete</p>
                  <p className="text-lg font-semibold">{formatCurrency(details.order.shippingAmount)}</p>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-border p-4">
                  <h3 className="text-sm font-semibold mb-2">Cliente</h3>
                  <div className="space-y-1 text-sm">
                    <p>{details.customer.name ?? "Sem nome"}</p>
                    <p className="text-muted-foreground">{details.customer.email ?? "Sem email"}</p>
                    <p className="text-muted-foreground">{details.customer.phone ?? "Sem telefone"}</p>
                    <p className="text-muted-foreground">{[details.customer.city, details.customer.state].filter(Boolean).join(" / ") || "Sem localização"}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <h3 className="text-sm font-semibold mb-2">Pedido</h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <span className="text-muted-foreground">Status</span><span>{details.order.status}</span>
                    <span className="text-muted-foreground">Criado em</span><span>{formatTimelineDate(details.order.createdAt)}</span>
                    <span className="text-muted-foreground">Itens</span><span>{formatNumber(details.order.requestedQuantity)}</span>
                    <span className="text-muted-foreground">Cancelado</span><span>{formatCurrency(details.order.cancelledAmount)}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border">
                <div className="border-b border-border p-3">
                  <h3 className="text-sm font-semibold">Produtos</h3>
                </div>
                <div className="divide-y divide-border">
                  {details.items.map((item) => (
                    <div key={item.id} className="flex gap-3 p-3">
                      <ProductMiniature imageUrl={item.imageUrl} name={item.name} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{item.sku}{item.category ? ` · ${item.category}` : ""}</p>
                      </div>
                      <div className="text-right text-sm">
                        <p className="font-semibold">{formatCurrency(item.priceAtSale)}</p>
                        <p className="text-xs text-muted-foreground">Qtd {formatNumber(item.quantity)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function DashboardPage() {
  const { selectedClientId, user, selectedDashboardMode } = useAuth();
  const { dateRange, filters } = useDashboardFilters();
  const queryClient = useQueryClient();
  const [chartMetric, setChartMetric] = useState<ChartMetric>("revenue");
  const [drillDate, setDrillDate] = useState<string | null>(null);
  const [insightDismissed, setInsightDismissed] = useState(false);
  const reduced = useReducedMotion();

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled =
    user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);
  const isB2C = selectedDashboardMode === "B2C";

  const { data, isLoading, isError, refetch } = useGetDashboard(
    {
      clientId,
      dateFrom: format(dateRange.from, "yyyy-MM-dd"),
      dateTo: format(dateRange.to, "yyyy-MM-dd"),
      category: filters.category ?? undefined,
      sellerId: filters.sellerId ?? undefined,
      channel: filters.channel ?? undefined,
      segment: filters.segment ?? undefined,
      utmSource: filters.utmSource || undefined,
      utmMedium: filters.utmMedium || undefined,
      utmCampaign: filters.utmCampaign || undefined,
      compare: true,
    },
    { query: queryOpts({ enabled }) },
  );

  const inclusiveDays = Math.max(1, differenceInDays(dateRange.to, dateRange.from) + 1);
  const prevPeriodTo = useMemo(() => subDays(dateRange.from, 1), [dateRange.from]);
  const prevPeriodFrom = useMemo(
    () => addDays(prevPeriodTo, -(inclusiveDays - 1)),
    [prevPeriodTo, inclusiveDays],
  );

  // ── AI insight (real LLM) ──────────────────────────────────────────────
  const insightParams = {
    clientId,
    dateFrom: format(dateRange.from, "yyyy-MM-dd"),
    dateTo: format(dateRange.to, "yyyy-MM-dd"),
  };
  const { data: insight, isLoading: insightLoading } = useGetInsight(insightParams, {
    query: queryOpts({ enabled }),
  });
  const regenerateInsight = useRegenerateInsight({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getGetInsightQueryKey(insightParams),
        });
      },
    },
  });

  // ── Inventory alerts ──────────────────────────────────────────────────
  const {
    data: alertsData,
    isLoading: alertsLoading,
  } = useGetAlerts(
    { clientId, horizonDays: 14, lookbackDays: 30, limit: 8 },
    { query: queryOpts({ enabled }) },
  );

  // Top sellers (mini leaderboard on the dashboard)
  const { data: topSellersData, isLoading: topSellersLoading } = useGetSellers(
    { clientId, limit: 5 },
    { query: queryOpts({ enabled: enabled && !isB2C }) },
  );
  const {
    data: campaignCustomers,
    isLoading: campaignCustomersLoading,
    isError: campaignCustomersError,
  } = useQuery({
    queryKey: [
      "campaign-customers",
      clientId,
      format(dateRange.from, "yyyy-MM-dd"),
      format(dateRange.to, "yyyy-MM-dd"),
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        dateFrom: format(dateRange.from, "yyyy-MM-dd"),
        dateTo: format(dateRange.to, "yyyy-MM-dd"),
        limit: "500",
      });
      if (clientId) params.set("clientId", clientId);
      return customFetch<CampaignCustomersResponse>(
        `/api/analytics/campaign-customers?${params.toString()}`,
      );
    },
    enabled: enabled && !isB2C,
  });

  // Compute changes from API-provided prior-period KPIs
  const revenueChange = useMemo(
    () => computeChange(data?.kpis.revenue, data?.prevKpis?.revenue),
    [data],
  );
  const ordersChange = useMemo(
    () => computeChange(data?.kpis.orders, data?.prevKpis?.orders),
    [data],
  );
  const avgTicketChange = useMemo(
    () => computeChange(data?.kpis.avgTicket, data?.prevKpis?.avgTicket),
    [data],
  );
  const conversionChange = useMemo(
    () => computeChange(data?.kpis.conversionRate, data?.prevKpis?.conversionRate),
    [data],
  );
  const retentionChange = useMemo(
    () => computeChange(data?.kpis.retentionPct, data?.prevKpis?.retentionPct),
    [data],
  );

  // Build chart data (uses prev time series from the same response)
  const chartData = useMemo(() => {
    if (!data) return [];
    const dailyPerformance = data.dailyPerformance ?? [];
    const current =
      isB2C && chartMetric === "revenue"
        ? dailyPerformance.map((p) => ({ date: p.date, value: p.revenue }))
        : isB2C && chartMetric === "orders"
          ? dailyPerformance.map((p) => ({ date: p.date, value: p.orders }))
          : chartMetric === "revenue"
        ? data.revenueOverTime
        : chartMetric === "orders"
          ? data.ordersOverTime
          : chartMetric === "sessions"
            ? dailyPerformance.map((p) => ({ date: p.date, value: p.sessions }))
            : chartMetric === "conversionRate"
              ? dailyPerformance.map((p) => ({ date: p.date, value: p.conversionRate }))
              : data.revenueOverTime.map((r, i) => {
              const o = data.ordersOverTime[i]?.value || 0;
              return { date: r.date, value: o > 0 ? r.value / o : 0 };
            });
    const prevRevenue = data.prevRevenueOverTime;
    const prevOrders = data.prevOrdersOverTime;
    const previous =
      prevRevenue && prevOrders
        ? chartMetric === "revenue"
          ? prevRevenue
          : chartMetric === "orders"
            ? prevOrders
            : prevRevenue.map((r, i) => {
                const o = prevOrders[i]?.value || 0;
                return { date: r.date, value: o > 0 ? r.value / o : 0 };
              })
        : undefined;
    return current.map((p, i) => ({
      date: p.date,
      current: p.value,
      previous: previous?.[i]?.value ?? null,
    }));
  }, [data, chartMetric, isB2C]);

  const currentSeries = useMemo(() => {
    if (!data) return [];
    const dailyPerformance = data.dailyPerformance ?? [];
    return isB2C && chartMetric === "revenue"
      ? dailyPerformance.map((p) => ({ date: p.date, value: p.revenue }))
      : isB2C && chartMetric === "orders"
        ? dailyPerformance.map((p) => ({ date: p.date, value: p.orders }))
        : chartMetric === "revenue"
      ? data.revenueOverTime
      : chartMetric === "orders"
        ? data.ordersOverTime
        : chartMetric === "sessions"
          ? dailyPerformance.map((p) => ({ date: p.date, value: p.sessions }))
          : chartMetric === "conversionRate"
            ? dailyPerformance.map((p) => ({ date: p.date, value: p.conversionRate }))
            : data.revenueOverTime.map((r, i) => {
            const o = data.ordersOverTime[i]?.value || 0;
            return { date: r.date, value: o > 0 ? r.value / o : 0 };
          });
  }, [data, chartMetric, isB2C]);

  const anomalies = useMemo(() => detectAnomalies(currentSeries), [currentSeries]);
  const chartFormatter = CHART_METRICS.find((m) => m.id === chartMetric)!.formatter;

  // Top categories
  const topCategories = useMemo(() => {
    if (!data?.revenueByCategory) return [];
    return [...data.revenueByCategory].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [data]);

  const totalCategoryRevenue = (data?.revenueByCategory ?? []).reduce((sum, c) => sum + c.revenue, 0);

  const handlePrint = () => {
    document.body.classList.add("print-dashboard");
    window.setTimeout(() => {
      window.print();
      document.body.classList.remove("print-dashboard");
    }, 50);
  };

  const handleExportSummary = () => {
    if (!data) return;
    exportRowsAsCsv(
      `dashboard-summary-${format(dateRange.from, "yyyyMMdd")}-${format(dateRange.to, "yyyyMMdd")}.csv`,
      data.revenueOverTime.map((r, i) => ({
        date: r.date,
        revenue: r.value,
        orders: data.ordersOverTime[i]?.value ?? 0,
        leads: data.leadsOverTime[i]?.value ?? 0,
      })),
      [
        { header: "date", accessor: (r) => r.date },
        { header: "revenue", accessor: (r) => r.revenue },
        { header: "orders", accessor: (r) => r.orders },
        { header: "leads", accessor: (r) => r.leads },
      ],
    );
  };

  const chartMetrics = isB2C
    ? CHART_METRICS
    : CHART_METRICS.filter((metric) => metric.id !== "sessions" && metric.id !== "conversionRate");

  useEffect(() => {
    if (!isB2C && (chartMetric === "sessions" || chartMetric === "conversionRate")) {
      setChartMetric("revenue");
    }
  }, [chartMetric, isB2C]);

  if (isError) {
    return (
      <Alert variant="destructive" data-testid="page-dashboard">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription className="flex items-center justify-between">
          Failed to load dashboard data.
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const sparkRevenue = data?.revenueOverTime.map((p) => p.value) ?? [];
  const sparkOrders = data?.ordersOverTime.map((p) => p.value) ?? [];
  const sparkLeads = data?.leadsOverTime.map((p) => p.value) ?? [];
  const sparkConv = isB2C
    ? data?.dailyPerformance?.map((p) => p.conversionRate) ?? []
    : (data?.leadsOverTime ?? []).map((leadPoint, i) => {
        const orderVal = data?.ordersOverTime[i]?.value ?? 0;
        return leadPoint.value > 0 ? (orderVal / leadPoint.value) * 100 : 0;
      });
  const sparkNewBuyers = data?.newBuyersOverTime?.map((p) => p.value) ?? [];
  const sparkReturning = data?.returningBuyersOverTime?.map((p) => p.value) ?? [];
  const containerVariants = withReducedMotion(staggerContainer, reduced);
  const fadeVariants = withReducedMotion(fadeInUp, reduced);

  return (
    <div className="space-y-6 dashboard-printable" data-testid="page-dashboard">
      {/* Live indicator + export toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={fadeVariants}
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <span className="relative flex h-1.5 w-1.5">
            {!reduced && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60" />
            )}
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          <span className="font-mono uppercase tracking-wider">
            Live · {format(dateRange.from, "MMM d")} → {format(dateRange.to, "MMM d, yyyy")}
            <span className="ml-2 text-muted-foreground/70">
              vs. {format(prevPeriodFrom, "MMM d")} → {format(prevPeriodTo, "MMM d")}
            </span>
          </span>
        </motion.div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportSummary} data-testid="dashboard-export-csv">
            <Download className="h-4 w-4 mr-1.5" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint} data-testid="dashboard-export-pdf">
            <FileText className="h-4 w-4 mr-1.5" />
            Print / PDF
          </Button>
        </div>
      </div>

      <motion.div
        initial="hidden"
        animate="visible"
        variants={containerVariants}
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4"
      >
        <DashboardKpiCard
          testId="kpi-revenue"
          icon={DollarSign}
          iconClass="bg-blue-500/15 text-blue-400"
          label={isB2C ? "Valor pago" : "Total revenue"}
          value={data?.kpis.revenue ?? 0}
          format={(v) => formatCurrencySmart(v)}
          unit="BRL"
          change={revenueChange}
          changeLabel="vs. previous period"
          sparkValues={sparkRevenue}
          sparkColor="#60a5fa"
          sub={[
            { label: "Avg ticket", value: data ? formatCurrency(data.kpis.avgTicket) : "—" },
            { label: "Customers", value: data ? formatNumber(data.kpis.customers) : "—" },
          ]}
          isLoading={isLoading}
          valueAccent
        />
        <DashboardKpiCard
          testId="kpi-orders"
          icon={Package}
          iconClass="bg-violet-500/15 text-violet-400"
          label="Orders"
          value={data?.kpis.orders ?? 0}
          format={(v) => formatNumber(v)}
          unit={inclusiveDays + "d"}
          change={ordersChange}
          changeLabel="vs. previous period"
          sparkValues={sparkOrders}
          sparkColor="#a78bfa"
          sub={[
            { label: isB2C ? "Sessões" : "Leads", value: data ? formatNumber(isB2C ? data.traffic?.sessions ?? 0 : data.kpis.leads) : "—" },
            { label: isB2C ? "Pedidos" : "Approved leads", value: data ? formatNumber(isB2C ? data.traffic?.orders ?? data.kpis.orders : data.kpis.approvedLeads) : "—" },
          ]}
          isLoading={isLoading}
        />
        <DashboardKpiCard
          testId="kpi-avgTicket"
          icon={Wallet}
          iconClass="bg-emerald-500/15 text-emerald-400"
          label="Avg ticket"
          value={data?.kpis.avgTicket ?? 0}
          format={(v) => formatCurrencySmart(v)}
          unit="BRL"
          change={avgTicketChange}
          changeLabel="vs. previous period"
          sparkValues={sparkLeads}
          sparkColor="#34d399"
          sub={[
            { label: "Repeat customers", value: data ? formatNumber(data.kpis.repeatCustomers) : "—" },
            { label: isB2C ? "Paid rate" : "Approval rate", value: data ? formatPercentage(data.kpis.approvalRate) : "—" },
          ]}
          isLoading={isLoading}
        />
        <DashboardKpiCard
          testId="kpi-conversionRate"
          icon={Target}
          iconClass="bg-sky-500/15 text-sky-400"
          label="Conversion rate"
          value={data?.kpis.conversionRate ?? 0}
          format={(v) => formatPercentage(v)}
          change={conversionChange}
          changeLabel="vs. previous period"
          sparkValues={sparkConv}
          sparkColor="#38bdf8"
          sub={[
            { label: isB2C ? "Sessões" : "Leads", value: data ? formatNumber(isB2C ? data.traffic?.sessions ?? 0 : data.kpis.leads) : "—" },
            { label: isB2C ? "Pedidos" : "Orders", value: data ? formatNumber(isB2C ? data.traffic?.orders ?? data.kpis.orders : data.kpis.orders) : "—" },
          ]}
          isLoading={isLoading}
          ringValue={data?.kpis.conversionRate ?? 0}
          ringColor="hsl(var(--chart-1))"
        />
      </motion.div>

      {/* Marketing & buyer KPIs row */}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={containerVariants}
        className="grid grid-cols-1 sm:grid-cols-3 gap-4"
      >
        {/* Requested vs Approved Revenue */}
        <Card className="p-5 bg-card border-border" data-testid="kpi-requested-revenue">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/15 shrink-0">
              <DollarSign className="h-4 w-4 text-blue-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground leading-none">
                {isB2C ? "Valor faturado" : "Requested revenue"}
              </p>
              {isLoading ? (
                <Skeleton className="h-6 w-24 mt-1" />
              ) : (
                <p className="text-xl font-bold tabular-nums mt-0.5">
                  <CountUp value={data?.kpis.requestedRevenue ?? 0} format={(v) => formatCurrencySmart(v)} />
                </p>
              )}
            </div>
          </div>
          {isLoading ? (
            <Skeleton className="h-3 w-full mb-2" />
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>{isB2C ? "Pago" : "Approved"}</span>
                <span className="font-medium text-foreground tabular-nums">
                  {formatCurrency(data?.kpis.revenue ?? 0)}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-400 transition-all"
                  style={{
                    width: `${Math.min(100, (data?.kpis.requestedRevenue ?? 0) > 0
                      ? ((data?.kpis.revenue ?? 0) / (data?.kpis.requestedRevenue ?? 1)) * 100
                      : 0)}%`,
                  }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {(data?.kpis.requestedRevenue ?? 0) > 0
                  ? `${(((data?.kpis.revenue ?? 0) / (data?.kpis.requestedRevenue ?? 1)) * 100).toFixed(1)}% ${isB2C ? "paid rate" : "fulfillment rate"}`
                  : isB2C ? "No invoiced revenue" : "No requested revenue"}
              </p>
            </>
          )}
        </Card>

        {/* New vs Returning Buyers */}
        <Card className="p-5 bg-card border-border" data-testid="kpi-buyers">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 shrink-0">
              <Users className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground leading-none">Buyers this period</p>
              {isLoading ? (
                <Skeleton className="h-6 w-24 mt-1" />
              ) : (
                <p className="text-xl font-bold tabular-nums mt-0.5">
                  <CountUp
                    value={(data?.kpis.newBuyers ?? 0) + (data?.kpis.returningBuyers ?? 0)}
                    format={(v) => formatNumber(v)}
                  />
                </p>
              )}
            </div>
          </div>
          {isLoading ? (
            <div className="space-y-1.5">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-3 w-full mt-1" />
            </div>
          ) : (
            <>
              {/* Stacked sparkline: new (emerald) over returning (blue) */}
              {sparkNewBuyers.length > 0 && (
                <div className="h-10 w-full mb-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={sparkNewBuyers.map((v, i) => ({
                        new: v,
                        returning: sparkReturning[i] ?? 0,
                      }))}
                      margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
                    >
                      <Area
                        type="monotone"
                        dataKey="returning"
                        stackId="buyers"
                        stroke="#60a5fa"
                        fill="#60a5fa"
                        fillOpacity={0.35}
                        strokeWidth={1}
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="new"
                        stackId="buyers"
                        stroke="#34d399"
                        fill="#34d399"
                        fillOpacity={0.35}
                        strokeWidth={1}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="flex gap-3 text-xs">
                <div className="flex-1 flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                  <span className="text-muted-foreground">New</span>
                  <span className="ml-auto font-semibold tabular-nums">
                    {formatNumber(data?.kpis.newBuyers ?? 0)}
                  </span>
                </div>
                <div className="flex-1 flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-blue-400 shrink-0" />
                  <span className="text-muted-foreground">Returning</span>
                  <span className="ml-auto font-semibold tabular-nums">
                    {formatNumber(data?.kpis.returningBuyers ?? 0)}
                  </span>
                </div>
              </div>
            </>
          )}
        </Card>

        {/* Retention % */}
        <DashboardKpiCard
          testId="kpi-retention"
          icon={TrendingUp}
          iconClass="bg-violet-500/15 text-violet-400"
          label="Buyer retention"
          value={data?.kpis.retentionPct ?? 0}
          format={(v) => formatPercentage(v)}
          change={retentionChange}
          changeLabel="vs. previous period"
          sparkValues={sparkReturning}
          sparkColor="#a78bfa"
          sub={[
            { label: "New buyers", value: data ? formatNumber(data.kpis.newBuyers) : "—" },
            { label: "Returning", value: data ? formatNumber(data.kpis.returningBuyers) : "—" },
          ]}
          isLoading={isLoading}
        />
      </motion.div>

      <motion.div initial="hidden" animate="visible" variants={fadeVariants}>
        {isB2C ? (
          <B2COrdersPanel
            clientId={clientId}
            dateFrom={format(dateRange.from, "yyyy-MM-dd")}
            dateTo={format(dateRange.to, "yyyy-MM-dd")}
            enabled={enabled}
          />
        ) : (
          <CampaignCustomersPanel
            data={campaignCustomers}
            isLoading={campaignCustomersLoading}
            isError={campaignCustomersError}
            clientId={clientId}
            dateFrom={format(dateRange.from, "yyyy-MM-dd")}
            dateTo={format(dateRange.to, "yyyy-MM-dd")}
          />
        )}
      </motion.div>

      {/* Chart + insight */}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={fadeVariants}
        className="grid grid-cols-1 lg:grid-cols-3 gap-4"
      >
        <Card className="lg:col-span-2 p-5 bg-card border-border">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-semibold leading-tight">Daily performance</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isB2C
                  ? `Por dia: receita, pedidos, sessões e conversão${data?.traffic?.source === "ga4" ? " via GA4" : ""}`
                  : `Last ${inclusiveDays} days vs. previous period · click any anomaly to drill in`}
              </p>
            </div>
            <div className="inline-flex items-center bg-muted/40 border border-border rounded-md p-0.5">
              {chartMetrics.map((metric) => (
                <button
                  key={metric.id}
                  data-testid={`chart-toggle-${metric.id}`}
                  onClick={() => setChartMetric(metric.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    chartMetric === metric.id
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {metric.label}
                </button>
              ))}
            </div>
          </div>

          <div className="h-[280px]">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                  onClick={(e: { activeLabel?: string }) => {
                    if (e?.activeLabel) setDrillDate(e.activeLabel);
                  }}
                >
                  <defs>
                    <linearGradient id="colorCurrent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(val) => format(new Date(val), "MMM d")}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    dy={6}
                  />
                  <YAxis
                    tickFormatter={(val) =>
                      chartMetric === "orders" || chartMetric === "sessions"
                        ? formatNumber(val)
                        : chartMetric === "conversionRate"
                          ? formatPercentage(val)
                        : `R$${(val / 1000).toFixed(0)}k`
                    }
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={55}
                  />
                  <Tooltip
                    formatter={(value: number, name) => [
                      chartFormatter(value),
                      name === "current" ? "Current" : "Previous",
                    ]}
                    labelFormatter={(label) => format(new Date(label), "MMM d, yyyy")}
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="previous"
                    stroke="hsl(var(--muted-foreground))"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    fill="transparent"
                    dot={false}
                    isAnimationActive={!reduced}
                  />
                  <Area
                    type="monotone"
                    dataKey="current"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fill="url(#colorCurrent)"
                    dot={false}
                    activeDot={{ r: 5, style: { cursor: "pointer" } }}
                    isAnimationActive={!reduced}
                  />
                  {anomalies.map((a) => (
                    <ReferenceDot
                      key={a.date}
                      x={a.date}
                      y={a.value}
                      r={5}
                      stroke="#fbbf24"
                      strokeWidth={2}
                      fill="hsl(var(--background))"
                      ifOverflow="extendDomain"
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1.5">
              <CircleDot className="h-3 w-3 text-primary" />
              Current
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 border-t border-dashed border-muted-foreground" />
              Previous
            </span>
            {anomalies.length > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full ring-2 ring-amber-400/80 bg-background" />
                {anomalies.length} anomaly{anomalies.length === 1 ? "" : "ies"} detected
              </span>
            )}
          </div>
        </Card>

        {/* AI insight card */}
        {!insightDismissed && (
          <Card
            className="p-5 bg-gradient-to-br from-primary/[0.04] via-card to-card border-border relative overflow-hidden flex flex-col"
            data-testid="ai-insight-card"
          >
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-primary via-chart-3 to-chart-1 opacity-80"
            />
            <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/10 blur-2xl pointer-events-none" />
            <div className="relative z-10 flex flex-col h-full">
              <div className="flex items-center justify-between mb-3">
                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/15 text-primary text-[10px] font-semibold uppercase tracking-wider">
                  <Sparkles className="h-3 w-3" />
                  UP Insight · {insight?.source === "ai" ? "AI" : "Auto"}
                </span>
                <button
                  type="button"
                  onClick={() => setInsightDismissed(true)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Dismiss insight"
                  data-testid="insight-dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {insightLoading || !insight ? (
                <>
                  <Skeleton className="h-6 w-3/4 mb-2" />
                  <Skeleton className="h-4 w-full mb-1" />
                  <Skeleton className="h-4 w-5/6 mb-4" />
                </>
              ) : (
                <>
                  <h3 className="text-lg font-semibold leading-snug mb-2">{insight.headline}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{insight.body}</p>
                  {insight.bullets && insight.bullets.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {insight.bullets.map((b, i) => (
                        <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                          <span className="text-primary mt-1 leading-none">•</span>
                          <span className="leading-relaxed">{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              <div className="mt-auto pt-5 flex items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => regenerateInsight.mutate({ params: insightParams })}
                  disabled={regenerateInsight.isPending || insightLoading}
                  data-testid="insight-regenerate"
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${regenerateInsight.isPending ? "animate-spin" : ""}`} />
                  {regenerateInsight.isPending ? "Regenerating" : "Regenerate"}
                </Button>
                {insight?.cached && (
                  <span className="text-[11px] text-muted-foreground">Cached · refreshes hourly</span>
                )}
              </div>
            </div>
          </Card>
        )}
      </motion.div>

      {/* Business signals */}
      {(data?.signals?.length ?? 0) > 0 && (
        <motion.div
          initial="hidden"
          animate="visible"
          variants={fadeVariants}
        >
          <Card className="p-5 bg-card border-border" data-testid="signals-panel">
            <div className="flex items-center gap-2 mb-4">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-sky-500/15">
                <BarChart3 className="h-4 w-4 text-sky-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold leading-tight">Business signals</h2>
                <p className="text-xs text-muted-foreground">Computed insights for this period</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {data?.signals?.map((signal) => {
                const isWarning = signal.severity === "warning";
                const isCritical = signal.severity === "critical";
                const colorCls = isCritical
                  ? "bg-red-500/10 border-red-500/20 text-red-400"
                  : isWarning
                    ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                    : "bg-sky-500/10 border-sky-500/20 text-sky-400";
                const Icon =
                  signal.type === "high_traffic_low_sales"
                    ? TrendingDown
                    : signal.type === "high_performing_regions"
                      ? BarChart3
                      : Info;
                return (
                  <div
                    key={signal.type}
                    className={`flex gap-3 p-3.5 rounded-lg border ${colorCls}`}
                    data-testid={`signal-${signal.type}`}
                  >
                    <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-snug">{signal.title}</p>
                      <p className="text-xs opacity-80 mt-0.5 leading-relaxed">{signal.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </motion.div>
      )}

      {/* Inventory alerts */}
      <Card className="p-5 bg-card border-border" data-testid="alerts-panel">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold leading-tight flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Alerts
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              SKUs below restock threshold and predicted stockouts in the next 14 days
            </p>
          </div>
          {alertsData && alertsData.counts.total > 0 && (
            <div className="flex items-center gap-2">
              {alertsData.counts.critical > 0 && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-red-500/15 text-red-400"
                  data-testid="alerts-count-critical"
                >
                  {alertsData.counts.critical} critical
                </span>
              )}
              {alertsData.counts.warning > 0 && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-amber-500/15 text-amber-400"
                  data-testid="alerts-count-warning"
                >
                  {alertsData.counts.warning} warning
                </span>
              )}
            </div>
          )}
        </div>

        {alertsLoading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : !alertsData || alertsData.alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 mb-3">
              <Package className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium">All inventory is healthy</p>
            <p className="text-xs text-muted-foreground mt-1">
              No SKUs below restock threshold or projected to stock out soon.
            </p>
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-12 gap-4 px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
              <div className="col-span-5">Product</div>
              <div className="col-span-2 text-right">Stock</div>
              <div className="col-span-2 text-right">Threshold</div>
              <div className="col-span-2 text-right">Days of cover</div>
              <div className="col-span-1" />
            </div>
            <div className="divide-y divide-border">
              {alertsData.alerts.map((alert) => {
                const isCritical = alert.severity === "critical";
                const Icon =
                  alert.type === "OUT_OF_STOCK"
                    ? PackageX
                    : alert.type === "PREDICTED_STOCKOUT"
                      ? AlertTriangle
                      : AlertCircle;
                const iconWrap = isCritical
                  ? "bg-red-500/15 text-red-400"
                  : "bg-amber-500/15 text-amber-400";
                const typeLabel =
                  alert.type === "OUT_OF_STOCK"
                    ? "Out of stock"
                    : alert.type === "PREDICTED_STOCKOUT"
                      ? "Predicted stockout"
                      : "Low stock";
                const productHref = `/products?sku=${encodeURIComponent(alert.sku)}${
                  alert.category ? `&category=${encodeURIComponent(alert.category)}` : ""
                }`;
                const daysCover =
                  alert.daysOfCover === null || alert.daysOfCover === undefined
                    ? "—"
                    : `${Math.max(0, Math.round(alert.daysOfCover))}d`;
                return (
                  <div
                    key={alert.productId}
                    className="grid grid-cols-12 gap-4 items-center px-2 py-3"
                    data-testid={`alert-row-${alert.sku}`}
                  >
                    <div className="col-span-5 flex items-center gap-3 min-w-0">
                      <div className="relative shrink-0">
                        <ProductMiniature imageUrl={alert.imageUrl} name={alert.name} />
                        <span className={`absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border border-background ${iconWrap}`}>
                          <Icon className="h-2.5 w-2.5" />
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{alert.name}</span>
                          <span
                            className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                              isCritical
                                ? "bg-red-500/15 text-red-400"
                                : "bg-amber-500/15 text-amber-400"
                            }`}
                            data-testid={`alert-type-${alert.sku}`}
                          >
                            {typeLabel}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {alert.sku}
                          {alert.category ? ` · ${alert.category}` : ""} · {alert.message}
                        </p>
                      </div>
                    </div>
                    <div className="col-span-2 text-right tabular-nums text-sm">
                      {formatNumber(alert.stock)}
                    </div>
                    <div className="col-span-2 text-right tabular-nums text-sm text-muted-foreground">
                      {formatNumber(alert.restockThreshold)}
                    </div>
                    <div className="col-span-2 text-right tabular-nums text-sm text-muted-foreground">
                      {daysCover}
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Link
                        href={productHref}
                        className="inline-flex items-center text-xs font-medium text-primary hover:underline"
                        data-testid={`alert-link-${alert.sku}`}
                        aria-label={`View ${alert.sku} in products`}
                      >
                        View <ChevronRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {/* Top categories */}
      <Card className="p-5 bg-card border-border">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold leading-tight">Top categories</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Share of revenue across the catalog
            </p>
          </div>
          <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            See all <ChevronRight className="h-3 w-3" />
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : topCategories.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No category data for this period.
          </p>
        ) : (
          <div>
            <div className="grid grid-cols-12 gap-4 px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
              <div className="col-span-5">Category</div>
              <div className="col-span-3 text-right">Revenue</div>
              <div className="col-span-2 text-right">Orders</div>
              <div className="col-span-2 text-right">Share</div>
            </div>
            <div className="divide-y divide-border">
              {topCategories.map((cat) => {
                const share =
                  totalCategoryRevenue > 0 ? (cat.revenue / totalCategoryRevenue) * 100 : 0;
                return (
                  <div
                    key={cat.category}
                    className="grid grid-cols-12 gap-4 items-center px-2 py-3"
                    data-testid={`category-row-${cat.category}`}
                  >
                    <div className="col-span-5 flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 text-primary">
                        <Package className="h-4 w-4" />
                      </div>
                      <span className="font-medium text-sm">{cat.category}</span>
                    </div>
                    <div className="col-span-3 text-right tabular-nums text-sm">
                      {formatCurrency(cat.revenue)}
                    </div>
                    <div className="col-span-2 text-right tabular-nums text-sm text-muted-foreground">
                      {formatNumber(cat.orders)}
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                        <TrendingUp className="h-3 w-3" />
                        {share.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {/* Top sellers mini-leaderboard */}
      {!isB2C && (topSellersLoading || (topSellersData && topSellersData.length > 0)) && (
        <Card className="p-5 bg-card border-border">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold leading-tight">Top sellers</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ranked by lifetime revenue
              </p>
            </div>
            <Link
              href="/sellers"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              See all <ChevronRight className="h-3 w-3" />
            </Link>
          </div>

          {topSellersLoading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-12 gap-4 px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
                <div className="col-span-5">Seller</div>
                <div className="col-span-3 text-right">Revenue</div>
                <div className="col-span-2 text-right">Orders</div>
                <div className="col-span-2 text-right"></div>
              </div>
              <div className="divide-y divide-border">
                {topSellersData?.map((seller, idx) => (
                  <Link
                    key={seller.id}
                    href={`/sellers/${seller.id}`}
                    className="grid grid-cols-12 gap-4 items-center px-2 py-3 hover:bg-muted/30 transition-colors rounded-sm cursor-pointer"
                    data-testid={`dashboard-top-seller-${seller.id}`}
                  >
                    <div className="col-span-5 flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 text-primary shrink-0">
                        <Store className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          {idx === 0 && <span className="text-[10px] text-amber-400 font-bold">#1</span>}
                          <span className="font-medium text-sm truncate">{seller.name}</span>
                        </div>
                      </div>
                    </div>
                    <div className="col-span-3 text-right tabular-nums text-sm">
                      {formatCurrency(seller.totalRevenue)}
                    </div>
                    <div className="col-span-2 text-right tabular-nums text-sm text-muted-foreground">
                      {formatNumber(seller.totalOrders)}
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                        View <ChevronRight className="h-3 w-3" />
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      <DrillDownPanel date={drillDate} onClose={() => setDrillDate(null)} />
    </div>
  );
}
