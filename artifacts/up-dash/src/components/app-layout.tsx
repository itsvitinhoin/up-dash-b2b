import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useIsFetching } from "@tanstack/react-query";
import { Globe2 } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useTheme } from "@/components/theme-provider";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { setActiveCurrency } from "@/lib/formatters";
import { DateRangePicker } from "@/components/date-range-picker";
import { NotificationBell } from "@/components/notification-bell";
import { FilterBar } from "@/components/filter-bar";
import { useKeyboardShortcuts } from "@/lib/keyboard-shortcuts";
import { LANGUAGE_OPTIONS, useI18n } from "@/lib/i18n";
import {
  LayoutDashboard,
  Filter,
  Users,
  Package,
  ShoppingBag,
  Store,
  MapPin,
  Building2,
  LogOut,
  Moon,
  Sun,
  Menu,
  Search,
  GitCompareArrows,
  Bell,
  HelpCircle,
  Megaphone,
  PackageSearch,
  Route,
  BarChart3,
  KeyRound,
  Link2,
  History,
  MessageCircle,
  MessageSquareText,
  FileText,
  PlugZap,
  Send,
  CalendarDays,
  FileClock,
  ReceiptText,
  Bot,
  Workflow,
  PlayCircle,
  Settings2,
  Sparkles,
  Scale,
  Gauge,
} from "lucide-react";
import {
  useListClients,
  useGetClient,
  useHealthCheck,
  type Client,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SearchPalette } from "@/components/search-palette";
import { DashLoader } from "@/components/ui/dash-loader";

interface AppLayoutProps {
  children: ReactNode;
}

interface PageMeta {
  title: string;
  subtitle: string;
  hasDateRange: boolean;
  hasFilterBar: boolean;
  // Per-brand pages need a single client in context — admins must explicitly
  // pick one before the page can render. Pages that aggregate across the whole
  // platform (e.g. /overview, /clients, /compare) leave this false.
  requiresClient?: boolean;
}

const pageMeta: Record<string, PageMeta> = {
  "/": { title: "Overview", subtitle: "", hasDateRange: true, hasFilterBar: true, requiresClient: true },
  "/dashboard": { title: "Overview", subtitle: "", hasDateRange: true, hasFilterBar: true, requiresClient: true },
  "/daily": { title: "Daily", subtitle: "Relatório diário B2C para PDF", hasDateRange: true, hasFilterBar: false, requiresClient: true },
  "/scale": { title: "Escala", subtitle: "Poder de venda, mídia e projeção de crescimento B2C", hasDateRange: true, hasFilterBar: false, requiresClient: true },
  "/funnel": { title: "Conversion funnel", subtitle: "Visit through purchase", hasDateRange: true, hasFilterBar: true, requiresClient: true },
  "/customers": { title: "Customers", subtitle: "RFM segmentation and lifetime value", hasDateRange: true, hasFilterBar: true, requiresClient: true },
  "/orders": { title: "Orders", subtitle: "Pedidos, atendimento e origem", hasDateRange: true, hasFilterBar: true, requiresClient: true },
  "/products": { title: "Products", subtitle: "Performance and ranking", hasDateRange: true, hasFilterBar: true, requiresClient: true },
  "/sellers": { title: "Sellers", subtitle: "Top performers across the catalog", hasDateRange: false, hasFilterBar: true, requiresClient: true },
  "/geography": { title: "Geography", subtitle: "Sales distribution by region", hasDateRange: true, hasFilterBar: true, requiresClient: true },
  "/clients": { title: "Clients", subtitle: "Brand accounts on the platform", hasDateRange: true, hasFilterBar: false },
  "/accesses": { title: "Acessos", subtitle: "Client logins filtered by brand", hasDateRange: false, hasFilterBar: false },
  "/extractions": { title: "Extrações", subtitle: "Histórico dos agendamentos de dados", hasDateRange: false, hasFilterBar: false },
  "/relatorios-automaticos": { title: "Relatórios automáticos", subtitle: "Envio interno de relatórios por WhatsApp Oficial da UP", hasDateRange: false, hasFilterBar: false },
  "/notifications": { title: "Notifications", subtitle: "Anomalies, top movers, and rollups", hasDateRange: false, hasFilterBar: false, requiresClient: true },
  "/compare": { title: "Compare brands", subtitle: "Benchmark up to four clients side-by-side", hasDateRange: true, hasFilterBar: false },
  "/overview": { title: "Platform overview", subtitle: "Every brand on UP Dash, at a glance", hasDateRange: true, hasFilterBar: false },
  "/marketing": { title: "Marketing", subtitle: "Ad spend, ROAS, CPL, and creative performance", hasDateRange: true, hasFilterBar: true, requiresClient: true },
  "/erp": { title: "ERP", subtitle: "Visão operacional do Miré", hasDateRange: true, hasFilterBar: false, requiresClient: true },
  "/erp/pedidos": { title: "Pedidos ERP", subtitle: "Faturamento, atendimento e situação comercial", hasDateRange: true, hasFilterBar: false, requiresClient: true },
  "/erp/clientes": { title: "Clientes ERP", subtitle: "Base histórica de compradores e relacionamento", hasDateRange: true, hasFilterBar: false, requiresClient: true },
  "/erp/produtos": { title: "Produtos ERP", subtitle: "Venda, grade, estoque e cobertura", hasDateRange: true, hasFilterBar: false, requiresClient: true },
  "/performance": { title: "Performance", subtitle: "Mídia, ERP e e-commerce em uma visão consolidada", hasDateRange: true, hasFilterBar: false, requiresClient: true },
  "/whatsapp": { title: "WhatsApp", subtitle: "Atendimento, velocidade e produtividade", hasDateRange: false, hasFilterBar: false, requiresClient: true },
  "/whatsapp/conversas": { title: "Conversas WhatsApp", subtitle: "Inbox em tempo real por cliente", hasDateRange: false, hasFilterBar: false, requiresClient: true },
  "/whatsapp/conexoes": { title: "Conexões WhatsApp", subtitle: "Números, webhooks e integrações por cliente", hasDateRange: false, hasFilterBar: false, requiresClient: true },
  "/whatsapp/envios": { title: "Envios WhatsApp", subtitle: "Disparos teste e validação da Cloud API", hasDateRange: false, hasFilterBar: false, requiresClient: true },
  "/whatsapp/templates": { title: "Templates WhatsApp", subtitle: "Criação e aprovação de modelos oficiais", hasDateRange: false, hasFilterBar: false, requiresClient: true },
  "/stock": { title: "Stock Intelligence", subtitle: "Coverage, risk, and inventory health", hasDateRange: false, hasFilterBar: true, requiresClient: true },
  "/journey": { title: "Journey Analytics", subtitle: "Event flow, top paths, and buyer behaviour", hasDateRange: true, hasFilterBar: true, requiresClient: true },
  "/rfm": { title: "RFM Segmentation", subtitle: "Recency, frequency, and monetary analysis", hasDateRange: true, hasFilterBar: true, requiresClient: true },
  "/utm": { title: "UTM / Source Analysis", subtitle: "Attribution by source, medium, and campaign", hasDateRange: true, hasFilterBar: true, requiresClient: true },
  "/orquestrador": { title: "IA Comercial", subtitle: "Orquestrador comercial B2B com WhatsApp e UP Zero", hasDateRange: true, hasFilterBar: false },
  "/orquestrador/crm": { title: "CRM Comercial", subtitle: "Pipeline de atendimento e oportunidades B2B", hasDateRange: true, hasFilterBar: false, requiresClient: true },
  "/orquestrador/cadastros": { title: "Cadastros IA", subtitle: "Clientes captados e cadastros acompanhados pelo agente", hasDateRange: true, hasFilterBar: false, requiresClient: true },
  "/orquestrador/automacoes": { title: "Automações Comerciais", subtitle: "Regras seguras por evento de e-commerce", hasDateRange: false, hasFilterBar: false },
  "/orquestrador/configuracoes": { title: "Configurações IA", subtitle: "Limites, handoffs e operação assistida", hasDateRange: false, hasFilterBar: false },
  "/orquestrador/simulador": { title: "Simulador IA", subtitle: "Teste de respostas antes de conectar backend real", hasDateRange: false, hasFilterBar: false },
  "/orquestrador/logs": { title: "Logs IA", subtitle: "Auditoria visual dos eventos do orquestrador", hasDateRange: true, hasFilterBar: false },
  "/agente-vendas": { title: "Agente de Vendas", subtitle: "IA comercial assistida para atendimento B2B", hasDateRange: true, hasFilterBar: false, requiresClient: true },
  "/agente-vendas/crm": { title: "CRM do Agente", subtitle: "Pipeline comercial assistido para leads e oportunidades", hasDateRange: true, hasFilterBar: false, requiresClient: true },
  "/agente-vendas/simulacao": { title: "Simulação do Agente", subtitle: "Teste respostas antes de usar em atendimento real", hasDateRange: true, hasFilterBar: false, requiresClient: true },
  "/agente-vendas/configuracoes": { title: "Configurações do Agente", subtitle: "Regras, limites e ações permitidas", hasDateRange: false, hasFilterBar: false, requiresClient: true },
};

// Sentinel value for the topbar picker when an admin selects the
// platform-wide entry. Real client IDs are CUIDs, so this can never collide.
const PLATFORM_PICK = "__platform__";
const ADMIN_DISPLAY_EMAIL = "admin@updash.com";
const GLOBAL_SWITCH_MIN_MS = 650;
const GLOBAL_SWITCH_MAX_MS = 12000;
const ADMIN_CLIENTS_CACHE_KEY = "updash.adminClientOptions.v1";
const LOCAL_UI_PREVIEW =
  import.meta.env.DEV && import.meta.env.VITE_UI_PREVIEW === "1";
const LOCAL_PREVIEW_CLIENT: Client = {
  id: "preview-celeb",
  name: "CELEB · Prévia ERP",
  email: "preview@updash.local",
  apiKey: "",
  revenueYtd: 0,
  ordersYtd: 0,
  leadsYtd: 0,
  approvedLeads: 0,
  isActive: true,
  dashboardType: "B2B",
  commercePlatform: "MANUAL",
  hasNuvemshopIntegration: false,
  hasGa4Integration: false,
  currency: "BRL",
  locale: "pt-BR",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-23T00:00:00.000Z",
};

type AdminClientOption = {
  id: string;
  name: string;
  dashboardType: "B2B" | "B2C" | null;
  currency: string;
  locale: string;
  commercePlatform: Client["commercePlatform"] | null;
};

function toAdminClientOption(client: Client): AdminClientOption {
  return {
    id: client.id,
    name: client.name,
    dashboardType: client.dashboardType ?? null,
    currency: client.currency,
    locale: client.locale,
    commercePlatform: client.commercePlatform ?? null,
  };
}

function readCachedAdminClients(): AdminClientOption[] {
  if (typeof window === "undefined") return [];

  try {
    const parsed = JSON.parse(localStorage.getItem(ADMIN_CLIENTS_CACHE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];

    return parsed.map(
      (client): AdminClientOption => ({
        id: typeof client?.id === "string" ? client.id : "",
        name: typeof client?.name === "string" ? client.name : "",
        dashboardType:
          client?.dashboardType === "B2B" || client?.dashboardType === "B2C" ? client.dashboardType : null,
        currency: typeof client?.currency === "string" ? client.currency : "BRL",
        locale: typeof client?.locale === "string" ? client.locale : "pt-BR",
        commercePlatform: typeof client?.commercePlatform === "string" ? client.commercePlatform : null,
      }),
    ).filter((client) => client.id && client.name);
  } catch {
    return [];
  }
}

function isBackgroundQueryKey(queryKey: readonly unknown[]): boolean {
  const first = String(queryKey[0] ?? "");
  return first.includes("/api/healthz") || first.includes("/api/notifications");
}

function getUserDisplayName(user: ReturnType<typeof useAuth>["user"]) {
  if (!user) return "";
  if (user.email === ADMIN_DISPLAY_EMAIL) return "Grupo UP";
  return [user.firstName, user.lastName].filter(Boolean).join(" ");
}

function getUserInitials(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

export function AppLayout({ children }: AppLayoutProps) {
  const [location, navigate] = useLocation();
  const {
    user,
    logout,
    selectedClientId,
    setSelectedClientId,
    selectedDashboardMode,
    setSelectedDashboardMode,
  } = useAuth();
  const { theme, setTheme } = useTheme();
  const { language, setLanguage, t } = useI18n();
  const { dateRange, setDateRange } = useDashboardFilters();
  const { setOpen: setShortcutsOpen } = useKeyboardShortcuts();
  const [searchOpen, setSearchOpen] = useState(false);
  const [cachedAdminClients, setCachedAdminClients] = useState<AdminClientOption[]>(
    readCachedAdminClients,
  );
  const userDisplayName = getUserDisplayName(user);
  const userInitials = getUserInitials(userDisplayName);

  // Bridge the "/" shortcut to the command palette. The topbar search is now
  // a button that opens a palette (not an <input>), so "focusing search"
  // means opening the palette.
  useEffect(() => {
    (window as unknown as { __focusSearch?: () => void }).__focusSearch = () => {
      setSearchOpen(true);
    };
    return () => {
      delete (window as unknown as { __focusSearch?: () => void }).__focusSearch;
    };
  }, []);

  // Open the search palette on ⌘K / Ctrl+K, anywhere on the page.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key?.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const {
    data: clientsData,
    isLoading: isLoadingClients,
    isError: isClientsError,
    isFetching: isFetchingClients,
    isSuccess: isClientsSuccess,
    refetch: refetchClients,
  } = useListClients(
    { page: 1, limit: 1000 },
    {
      query: queryOpts({
        enabled: user?.role === "ADMIN" && !LOCAL_UI_PREVIEW,
        placeholderData: (previous) => previous,
        refetchOnWindowFocus: true,
        refetchInterval: (query) => query.state.status === "error" ? 30_000 : false,
      }),
    },
  );

  useEffect(() => {
    if (
      !Array.isArray(clientsData?.data) ||
      clientsData.data.length === 0
    ) {
      return;
    }

    const options = clientsData.data.map(toAdminClientOption);
    setCachedAdminClients(options);
    try {
      localStorage.setItem(ADMIN_CLIENTS_CACHE_KEY, JSON.stringify(options));
    } catch {
      // The live query remains authoritative if browser storage is unavailable.
    }
  }, [clientsData?.data, clientsData?.total]);

  const adminClients = useMemo(
    () => {
      const liveClients = Array.isArray(clientsData?.data)
        ? clientsData.data.map(toAdminClientOption)
        : [];
      const clients: AdminClientOption[] = LOCAL_UI_PREVIEW
        ? [toAdminClientOption(LOCAL_PREVIEW_CLIENT)]
        : liveClients.length > 0
          ? liveClients
          : cachedAdminClients;

      return clients
        .filter((client) => {
          if (client.dashboardType === selectedDashboardMode) return true;
          // Clients created before dashboard_type existed belong to B2B.
          return selectedDashboardMode === "B2B" && !client.dashboardType;
        })
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    },
    [cachedAdminClients, clientsData?.data, selectedDashboardMode],
  );

  // We deliberately do NOT auto-pick a client for admins here. UP Dash is an
  // agency platform: admins always operate on behalf of one specific brand at
  // a time, and silently selecting the alphabetically-first one risks them
  // taking action on the wrong account. Per-brand pages render an explicit
  // "select a brand" prompt below when no client is in context. The platform-
  // wide pages (/overview, /clients, /compare) work fine without a selection.

  const { data: clientData } = useGetClient(user?.clientId || "", {
    query: queryOpts({ enabled: user?.role === "CLIENT" && !!user?.clientId }),
  });

  useEffect(() => {
    if (
      user?.role !== "ADMIN" ||
      !selectedClientId ||
      !clientsData ||
      !isClientsSuccess ||
      isClientsError ||
      isFetchingClients ||
      clientsData.data.length === 0
    ) {
      return;
    }
    if (!adminClients.some((client) => client.id === selectedClientId)) {
      setSelectedClientId(null);
    }
  }, [
    adminClients,
    clientsData,
    isClientsError,
    isClientsSuccess,
    isFetchingClients,
    selectedClientId,
    setSelectedClientId,
    user?.role,
  ]);

  const activeClient =
    user?.role === "CLIENT"
      ? clientData
      : adminClients.find((c) => c.id === selectedClientId);
  const effectiveDashboardMode =
    user?.role === "CLIENT"
      ? (clientData?.dashboardType ?? null)
      : selectedDashboardMode;
  useEffect(() => {
    if (activeClient?.currency && activeClient?.locale) {
      setActiveCurrency(activeClient.currency, activeClient.locale);
    }
  }, [activeClient?.currency, activeClient?.locale]);

  const { data: health } = useHealthCheck({
    query: queryOpts({ enabled: !LOCAL_UI_PREVIEW, refetchInterval: 60000 }),
  });
  const activeDataLoads = useIsFetching({
    predicate: (query) => query.state.fetchStatus === "fetching" && !isBackgroundQueryKey(query.queryKey),
  });

  const [isGlobalSwitchLoading, setIsGlobalSwitchLoading] = useState(false);
  const [globalSwitchReason, setGlobalSwitchReason] = useState<"client" | "period" | "context">("context");
  const previousGlobalContext = useRef<{
    clientId: string;
    dateFrom: string;
    dateTo: string;
    mode: string;
  } | null>(null);
  const globalSwitchStartedAt = useRef(0);

  const globalContext = useMemo(
    () => ({
      clientId:
        user?.role === "CLIENT"
          ? user.clientId ?? ""
          : location === "/overview"
            ? PLATFORM_PICK
            : selectedClientId ?? "",
      dateFrom: dateRange.from.toISOString(),
      dateTo: dateRange.to.toISOString(),
      mode: user?.role === "CLIENT" ? "CLIENT" : selectedDashboardMode,
    }),
    [
      dateRange.from,
      dateRange.to,
      location,
      selectedClientId,
      selectedDashboardMode,
      user?.clientId,
      user?.role,
    ],
  );

  useEffect(() => {
    const previous = previousGlobalContext.current;
    previousGlobalContext.current = globalContext;
    if (!previous) return;

    const clientChanged = previous.clientId !== globalContext.clientId || previous.mode !== globalContext.mode;
    const periodChanged = previous.dateFrom !== globalContext.dateFrom || previous.dateTo !== globalContext.dateTo;
    if (!clientChanged && !periodChanged) return;

    globalSwitchStartedAt.current = Date.now();
    setGlobalSwitchReason(clientChanged ? "client" : "period");
    setIsGlobalSwitchLoading(true);
  }, [globalContext]);

  useEffect(() => {
    if (!isGlobalSwitchLoading) return;

    const maxTimer = window.setTimeout(() => {
      setIsGlobalSwitchLoading(false);
    }, GLOBAL_SWITCH_MAX_MS);

    return () => window.clearTimeout(maxTimer);
  }, [isGlobalSwitchLoading, globalContext]);

  useEffect(() => {
    if (!isGlobalSwitchLoading || activeDataLoads > 0) return;

    const elapsed = Date.now() - globalSwitchStartedAt.current;
    const remaining = Math.max(180, GLOBAL_SWITCH_MIN_MS - elapsed);
    const settleTimer = window.setTimeout(() => {
      setIsGlobalSwitchLoading(false);
    }, remaining);

    return () => window.clearTimeout(settleTimer);
  }, [activeDataLoads, isGlobalSwitchLoading, globalContext]);

  const meta =
    pageMeta[location] ??
    (location.startsWith("/products/") ? { title: "Product detail", subtitle: "Performance profile", hasDateRange: false, hasFilterBar: false, requiresClient: true } : null) ??
    (location.startsWith("/customers/") ? { title: "Customer detail", subtitle: "Purchase history and behaviour", hasDateRange: false, hasFilterBar: false, requiresClient: true } : null) ??
    (location.startsWith("/sellers/") ? { title: "Seller detail", subtitle: "Revenue, orders and top customers", hasDateRange: true, hasFilterBar: false, requiresClient: true } : null) ??
    (location.startsWith("/orquestrador/clientes/") ? { title: "Operação IA Comercial", subtitle: "Configuração e qualidade por cliente B2B", hasDateRange: true, hasFilterBar: false, requiresClient: true } : null) ??
    { title: "UP Dash", subtitle: "", hasDateRange: false, hasFilterBar: false };
  const pageTranslationKey =
    location === "/" || location === "/dashboard"
      ? "dashboard"
      : location === "/orders"
        ? "orders"
        : null;
  const titleText = pageTranslationKey ? t(`page.${pageTranslationKey}.title`, meta.title) : meta.title;
  const subtitleText =
    location === "/" || location === "/dashboard"
      ? `${format(new Date(), "EEEE, MMM d")} · ${t("page.dashboard.live", "live data")}`
      : pageTranslationKey
        ? t(`page.${pageTranslationKey}.subtitle`, meta.subtitle)
        : meta.subtitle;
  const globalLoadingClientName =
    location === "/overview"
      ? "visão da plataforma"
      : activeClient?.name ?? (user?.role === "CLIENT" ? "sua marca" : "cliente selecionado");
  const globalLoadingDescription =
    globalSwitchReason === "period"
      ? `Atualizando ${globalLoadingClientName} para ${format(dateRange.from, "dd/MM/yyyy")} a ${format(dateRange.to, "dd/MM/yyyy")}.`
      : `Carregando dados de ${globalLoadingClientName}.`;

  const b2bOnlyRoutes = useMemo(() => new Set(["/whatsapp", "/utm", "/sellers", "/journey", "/orquestrador", "/agente-vendas", "/erp", "/performance"]), []);
  const b2cOnlyRoutes = useMemo(() => new Set(["/daily", "/scale"]), []);
  // Clientes Vesti são dashboardType=B2B (venda por atacado), mas já têm
  // relatório diário via BigQuery (ver vestiDashboardController.getDailyReport)
  // — por isso "/daily" fica liberado pra eles mesmo em modo B2B.
  const vestiEnabledB2cRoutes = useMemo(() => new Set(["/daily"]), []);
  const isVestiClient = activeClient?.commercePlatform === "VESTI";
  const isB2BOnlyRoute = useCallback(
    (href: string) =>
      b2bOnlyRoutes.has(href) ||
      href.startsWith("/whatsapp/") ||
      href.startsWith("/erp/") ||
      href.startsWith("/orquestrador/") ||
      href.startsWith("/agente-vendas/"),
    [b2bOnlyRoutes],
  );
  useEffect(() => {
    if (effectiveDashboardMode === "B2C" && isB2BOnlyRoute(location)) {
      navigate("/dashboard");
    }
  }, [effectiveDashboardMode, isB2BOnlyRoute, location, navigate]);
  type NavEntry = {
    name: string;
    href: string;
    icon: typeof Users;
    children?: Array<{ name: string; href: string; icon: typeof Users }>;
  };

  const analyticsNav = [
    { name: t("nav.dashboard", "Dashboard"), href: "/dashboard", icon: LayoutDashboard },
    { name: t("nav.daily", "Daily"), href: "/daily", icon: CalendarDays },
    { name: t("nav.scale", "Escala"), href: "/scale", icon: Scale },
    {
      name: t("nav.erp", "ERP"),
      href: "/erp",
      icon: Store,
      children: [
        { name: t("nav.erp.overview", "Visão Geral"), href: "/erp", icon: LayoutDashboard },
        { name: t("nav.erp.orders", "Pedidos"), href: "/erp/pedidos", icon: ReceiptText },
        { name: t("nav.erp.customers", "Clientes"), href: "/erp/clientes", icon: Users },
        { name: t("nav.erp.products", "Produtos"), href: "/erp/produtos", icon: Package },
      ],
    },
    { name: t("nav.performance", "Performance"), href: "/performance", icon: Gauge },
    { name: t("nav.marketing", "Marketing"), href: "/marketing", icon: Megaphone },
    {
      name: t("nav.whatsapp", "WhatsApp"),
      href: "/whatsapp",
      icon: MessageCircle,
      children: [
        { name: t("nav.whatsapp.conversations", "Conversas"), href: "/whatsapp/conversas", icon: MessageSquareText },
        { name: t("nav.whatsapp.connections", "Conexões"), href: "/whatsapp/conexoes", icon: PlugZap },
        { name: t("nav.whatsapp.sends", "Envios"), href: "/whatsapp/envios", icon: Send },
        { name: t("nav.whatsapp.templates", "Templates"), href: "/whatsapp/templates", icon: FileText },
      ],
    },
    { name: t("nav.funnel", "Funnel"), href: "/funnel", icon: Filter },
    { name: t("nav.journey", "Journey"), href: "/journey", icon: Route },
    { name: t("nav.rfm", "RFM"), href: "/rfm", icon: BarChart3 },
    { name: t("nav.utm", "UTM"), href: "/utm", icon: Link2 },
    { name: t("nav.customers", "Customers"), href: "/customers", icon: Users },
    { name: t("nav.orders", "Orders"), href: "/orders", icon: ReceiptText },
    { name: t("nav.products", "Products"), href: "/products", icon: Package },
    { name: t("nav.sellers", "Sellers"), href: "/sellers", icon: ShoppingBag },
    { name: t("nav.stock", "Stock"), href: "/stock", icon: PackageSearch },
  ].filter((item) => {
    if (effectiveDashboardMode === "B2C" && isB2BOnlyRoute(item.href)) return false;
    if (effectiveDashboardMode === "B2B" && b2cOnlyRoutes.has(item.href) && !(isVestiClient && vestiEnabledB2cRoutes.has(item.href))) return false;
    return true;
  });

  const workspaceNav: NavEntry[] = [
    { name: t("nav.geography", "Geography"), href: "/geography", icon: MapPin },
    { name: t("nav.notifications", "Notifications"), href: "/notifications", icon: Bell },
  ];

  if (user?.role === "ADMIN") {
    workspaceNav.unshift({ name: t("nav.platformOverview", "Platform overview"), href: "/overview", icon: Globe2 });
    workspaceNav.push({ name: t("nav.compareBrands", "Compare brands"), href: "/compare", icon: GitCompareArrows });
    workspaceNav.push({ name: t("nav.clients", "Clients"), href: "/clients", icon: Building2 });
    workspaceNav.push({ name: t("nav.accesses", "Acessos"), href: "/accesses", icon: KeyRound });
    workspaceNav.push({ name: t("nav.extractions", "Extrações"), href: "/extractions", icon: History });
    workspaceNav.push({ name: t("nav.automaticReports", "Relatórios automáticos"), href: "/relatorios-automaticos", icon: FileClock });
    if (selectedDashboardMode === "B2B") {
      workspaceNav.push({
        name: t("nav.orchestrator", "IA Comercial"),
        href: "/orquestrador",
        icon: Bot,
        children: [
          { name: t("nav.orchestrator.overview", "Visão Geral"), href: "/orquestrador", icon: Sparkles },
          { name: t("nav.orchestrator.crm", "CRM"), href: "/orquestrador/crm", icon: Workflow },
          { name: t("nav.orchestrator.registrations", "Cadastros"), href: "/orquestrador/cadastros", icon: Users },
          { name: t("nav.orchestrator.automations", "Automações"), href: "/orquestrador/automacoes", icon: Bot },
          { name: t("nav.orchestrator.settings", "Configurações"), href: "/orquestrador/configuracoes", icon: Settings2 },
          { name: t("nav.orchestrator.simulator", "Simulador"), href: "/orquestrador/simulador", icon: PlayCircle },
          { name: t("nav.orchestrator.logs", "Logs"), href: "/orquestrador/logs", icon: FileText },
        ],
      });
    }
  } else if (effectiveDashboardMode === "B2B") {
    workspaceNav.push({
      name: t("nav.salesAgent", "Agente de Vendas"),
      href: "/agente-vendas",
      icon: Bot,
      children: [
        { name: t("nav.salesAgent.crm", "CRM"), href: "/agente-vendas/crm", icon: Workflow },
        { name: t("nav.salesAgent.simulation", "Simulação"), href: "/agente-vendas/simulacao", icon: PlayCircle },
        { name: t("nav.salesAgent.settings", "Configurações"), href: "/agente-vendas/configuracoes", icon: Settings2 },
      ],
    });
  }

  const NavItem = ({ item }: { item: NavEntry }) => {
    const isActive =
      location === item.href ||
      (item.href === "/dashboard" && location === "/") ||
      Boolean(item.children?.some((child) => child.href === location)) ||
      (item.href === "/orquestrador" && location.startsWith("/orquestrador/clientes/")) ||
      (item.href === "/agente-vendas" && location.startsWith("/agente-vendas/"));
    return (
      <div>
        <Link href={item.href}>
          <span
            data-testid={`nav-${item.href.replace(/^\//, "").replace(/\//g, "-") || "dashboard"}`}
            className={`relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
              isActive
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            }`}
          >
            {isActive && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r bg-primary" />
            )}
            <item.icon className="h-4 w-4" />
            {item.name}
          </span>
        </Link>
        {item.children && isActive && (
          <div className="ml-7 mt-1 space-y-0.5">
            {item.children.map((child) => {
              const childActive = location === child.href;
              return (
                <Link key={child.href} href={child.href}>
                  <span
                    data-testid={`nav-${child.href.replace(/^\//, "").replace(/\//g, "-")}`}
                    className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors ${
                      childActive
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                    }`}
                  >
                    <child.icon className="h-3.5 w-3.5" />
                    {child.name}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const SidebarContent = () => (
    <>
      <div className="flex h-16 items-center px-6">
        <Link href="/dashboard" className="flex items-center">
          <img
            src="/up-dash-logo.png"
            alt="Up Dash"
            className="h-8 w-auto object-contain"
            draggable={false}
          />
        </Link>
      </div>

      <nav className="flex-1 px-3 py-2 space-y-6 overflow-y-auto">
        <div>
          <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
            {t("nav.analytics", "Analytics")}
          </p>
          <div className="space-y-0.5">
            {analyticsNav.map((item) => (
              <NavItem key={item.name} item={item} />
            ))}
          </div>
        </div>

        <div>
          <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
            {t("nav.workspace", "Workspace")}
          </p>
          <div className="space-y-0.5">
            {workspaceNav.map((item) => (
              <NavItem key={item.name} item={item} />
            ))}
          </div>
        </div>
      </nav>

      <div className="border-t border-border px-3 py-3">
        <div className="flex items-center gap-3 px-2 py-1.5">
          <Avatar className="h-9 w-9 bg-primary/15">
            <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">
              {userInitials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate text-foreground">
              {userDisplayName}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {user?.role === "CLIENT" && clientData ? clientData.name : "UP Dash team"}
            </p>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between px-2 text-[11px] text-muted-foreground">
          <span>{t("top.system", "System")}</span>
          <span className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                health?.status === "ok" ? "bg-emerald-500" : "bg-red-500"
              }`}
            />
            {health?.status || "checking"}
          </span>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside className="hidden w-60 flex-col border-r border-border bg-sidebar md:flex no-print">
        <SidebarContent />
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-background px-4 sm:px-6 no-print">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle navigation</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0 bg-sidebar border-border flex flex-col">
              <SidebarContent />
            </SheetContent>
          </Sheet>

          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold leading-tight truncate">
              {titleText}
            </h1>
            {subtitleText && (
              <p className="text-xs text-muted-foreground truncate">{subtitleText}</p>
            )}
          </div>

          {/* Search trigger — opens the command palette */}
          <div className="hidden lg:flex flex-1 max-w-md ml-4">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              data-testid="search-trigger"
              className="relative w-full h-9 bg-card border border-border rounded-md pl-10 pr-12 text-sm text-left text-muted-foreground hover:bg-accent/40 focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <span className="truncate">{t("top.search", "Search SKUs, categories, customers")}</span>
              <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-mono bg-muted border border-border rounded text-muted-foreground">
                /
              </kbd>
            </button>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {user?.role === "ADMIN" && (
              <div className="hidden sm:block w-32">
                <Select
                  value={selectedDashboardMode}
                  onValueChange={(val) => {
                    const mode = val === "B2C" ? "B2C" : "B2B";
                    setSelectedDashboardMode(mode);
                    if (
                      mode === "B2C" &&
                      (location.startsWith("/whatsapp") || location.startsWith("/sellers") || location === "/utm")
                    ) {
                      navigate("/dashboard");
                    }
                    if (mode === "B2B" && (location === "/daily" || location === "/scale")) {
                      navigate("/dashboard");
                    }
                  }}
                >
                  <SelectTrigger
                    data-testid="dashboard-mode-picker"
                    className="h-9 bg-card border-border"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="B2B">
                      <span className="flex items-center gap-2">
                        <Building2 className="h-3.5 w-3.5 text-primary" />
                        B2B
                      </span>
                    </SelectItem>
                    <SelectItem value="B2C">
                      <span className="flex items-center gap-2">
                        <Store className="h-3.5 w-3.5 text-primary" />
                        B2C
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {user?.role === "ADMIN" && (
              <div className="hidden sm:block w-52">
                <Select
                  // On the platform overview page no individual client is
                  // active, so render the picker as the platform entry.
                  value={
                    location === "/overview"
                      ? PLATFORM_PICK
                      : selectedClientId ?? undefined
                  }
                  onValueChange={(val) => {
                    if (val === PLATFORM_PICK) {
                      setSelectedClientId(null);
                      navigate("/overview");
                      return;
                    }
                    setSelectedClientId(val);
                    // Leaving the platform view back to a brand should land
                    // on the per-brand dashboard, not strand the user on
                    // /overview with a brand selected.
                    if (location === "/overview") navigate("/dashboard");
                  }}
                >
                  <SelectTrigger
                    data-testid="client-picker"
                    className="h-9 bg-card border-border"
                  >
                    <SelectValue placeholder={t("top.selectClient", "Select a client")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      value={PLATFORM_PICK}
                      data-testid="client-picker-platform"
                    >
                      <span className="flex items-center gap-2">
                        <Globe2 className="h-3.5 w-3.5 text-primary" />
                        {t("top.allClients", "All Clients · Platform")}
                      </span>
                    </SelectItem>
                    {adminClients.length > 0 && (
                      <div className="my-1 h-px bg-border" />
                    )}
                    {adminClients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                    {!LOCAL_UI_PREVIEW && isLoadingClients && (
                      <div className="px-2 py-2 text-xs text-muted-foreground">
                        {t("top.loadingClients", "Carregando clientes...")}
                      </div>
                    )}
                    {!LOCAL_UI_PREVIEW &&
                      !isLoadingClients &&
                      isClientsError &&
                      adminClients.length === 0 && (
                      <div className="space-y-2 px-2 py-2 text-xs text-destructive">
                        <p>{t("top.clientsError", "Não foi possível carregar os clientes.")}</p>
                        <button
                          type="button"
                          className="text-primary underline underline-offset-2"
                          onPointerDown={(event) => event.preventDefault()}
                          onClick={() => void refetchClients()}
                        >
                          {t("top.retryClients", "Tentar novamente")}
                        </button>
                      </div>
                    )}
                    {!LOCAL_UI_PREVIEW &&
                      isClientsError &&
                      adminClients.length > 0 && (
                        <div className="px-2 py-2 text-xs text-amber-600 dark:text-amber-400">
                          {t(
                            "top.cachedClients",
                            "Exibindo a última lista salva enquanto reconectamos.",
                          )}
                        </div>
                      )}
                    {!LOCAL_UI_PREVIEW &&
                      !isLoadingClients &&
                      !isClientsError &&
                      adminClients.length === 0 && (
                        <div className="px-2 py-2 text-xs text-muted-foreground">
                          {t("top.noClientsForMode", "Nenhum cliente disponível neste modo.")}
                        </div>
                      )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {meta.hasDateRange && (
              <DateRangePicker value={dateRange} onChange={setDateRange} />
            )}

            <div className="hidden sm:block w-24">
              <Select value={language} onValueChange={(value) => setLanguage(value as typeof language)}>
                <SelectTrigger
                  data-testid="language-picker"
                  aria-label={t("top.language", "Language")}
                  className="h-9 bg-card border-border"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <span className="flex items-center gap-2">
                        <Globe2 className="h-3.5 w-3.5 text-primary" />
                        {option.shortLabel}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 hover:bg-accent"
              onClick={() => setShortcutsOpen(true)}
              aria-label={t("top.keyboardShortcuts", "Keyboard shortcuts")}
              data-testid="open-shortcuts"
            >
              <HelpCircle className="h-4 w-4" />
            </Button>

            {!LOCAL_UI_PREVIEW && <NotificationBell />}

            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 hover:bg-accent"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={t("top.toggleTheme", "Toggle theme")}
              data-testid="theme-toggle"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-9 w-9 rounded-full p-0">
                  <Avatar className="h-9 w-9 bg-primary/15">
                    <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">
                      {userDisplayName}
                    </p>
                    <p className="text-xs leading-none text-muted-foreground">
                      {user?.email}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShortcutsOpen(true)} className="cursor-pointer">
                  <HelpCircle className="mr-2 h-4 w-4" />
                  <span>{t("top.keyboardShortcuts", "Keyboard shortcuts")}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={logout} className="text-destructive cursor-pointer">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>{t("top.logout", "Log out")}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {meta.hasFilterBar && <FilterBar />}

        <main className="flex-1 overflow-y-auto bg-background p-4 sm:p-6 md:p-8 print-area">
          {meta.requiresClient && user?.role === "ADMIN" && !selectedClientId ? (
            <div className="mx-auto flex max-w-xl flex-col items-center justify-center gap-4 rounded-2xl border border-dashed bg-card/50 p-10 text-center" data-testid="empty-no-client-selected">
              <div className="rounded-full bg-muted p-3">
                <Building2 className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">
                  {t("empty.selectClient.title", "Select a {mode} client to continue").replace("{mode}", selectedDashboardMode)}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t("empty.selectClient.body", "This page shows data for one client at a time. Pick a client from the top selector or open the platform overview to see every brand.")}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => navigate("/overview")} data-testid="link-go-to-overview">
                  {t("empty.selectClient.overview", "Go to platform overview")}
                </Button>
                <Button variant="outline" onClick={() => navigate("/clients")} data-testid="link-go-to-clients">
                  {t("empty.selectClient.clients", "Browse all brands")}
                </Button>
              </div>
            </div>
          ) : (
            children
          )}
        </main>
      </div>

      {isGlobalSwitchLoading && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-background/85 px-4 backdrop-blur-sm no-print"
          role="status"
          aria-live="polite"
          aria-label="Carregando dados atualizados"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-card shadow-2xl">
            <DashLoader
              label="Carregando dados atualizados"
              description={globalLoadingDescription}
            />
          </div>
        </div>
      )}

      {!isGlobalSwitchLoading && activeDataLoads > 0 && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 hidden rounded-lg border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur sm:block no-print">
          <DashLoader compact label="Carregando informações" />
        </div>
      )}

      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
