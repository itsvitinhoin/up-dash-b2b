import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation } from "wouter";
import { useIsFetching } from "@tanstack/react-query";
import { Globe2 } from "lucide-react";
import {
  differenceInCalendarDays,
  format,
  startOfDay,
  subDays,
} from "date-fns";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useTheme } from "@/components/theme-provider";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { setActiveCurrency } from "@/lib/formatters";
import { DateRangePicker } from "@/components/date-range-picker";
import { NotificationBell } from "@/components/notification-bell";
import { FilterBar } from "@/components/filter-bar";
import { useKeyboardShortcuts } from "@/lib/keyboard-shortcuts";
import { useI18n } from "@/lib/i18n";
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
  ChevronDown,
  ChevronRight,
  RefreshCw,
  UserRoundCheck,
} from "lucide-react";
import {
  useListClients,
  useGetClient,
  useHealthCheck,
  type Client,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
import {
  architectureForPath,
  legacyPath,
  navigationPath,
} from "@/lib/dashboard-architecture";

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
  "/": {
    title: "Visão geral",
    subtitle: "",
    hasDateRange: true,
    hasFilterBar: true,
    requiresClient: true,
  },
  "/dashboard": {
    title: "Visão geral",
    subtitle: "",
    hasDateRange: true,
    hasFilterBar: true,
    requiresClient: true,
  },
  "/daily": {
    title: "Diário",
    subtitle: "Relatório diário B2C para PDF",
    hasDateRange: true,
    hasFilterBar: false,
    requiresClient: true,
  },
  "/scale": {
    title: "Escala",
    subtitle: "Poder de venda, mídia e projeção de crescimento B2C",
    hasDateRange: true,
    hasFilterBar: false,
    requiresClient: true,
  },
  "/funnel": {
    title: "Funil de conversão",
    subtitle: "Da visita à compra",
    hasDateRange: true,
    hasFilterBar: true,
    requiresClient: true,
  },
  "/customers": {
    title: "Clientes",
    subtitle: "Segmentação RFM e valor dos clientes",
    hasDateRange: true,
    hasFilterBar: true,
    requiresClient: true,
  },
  "/orders": {
    title: "Pedidos",
    subtitle: "Pedidos, atendimento e origem",
    hasDateRange: true,
    hasFilterBar: true,
    requiresClient: true,
  },
  "/products": {
    title: "Produtos",
    subtitle: "Desempenho e ranking de produtos",
    hasDateRange: true,
    hasFilterBar: true,
    requiresClient: true,
  },
  "/sellers": {
    title: "Vendedoras",
    subtitle: "Desempenho das vendedoras no catálogo",
    hasDateRange: false,
    hasFilterBar: true,
    requiresClient: true,
  },
  "/geography": {
    title: "Geografia",
    subtitle: "Distribuição de vendas por região",
    hasDateRange: true,
    hasFilterBar: true,
    requiresClient: true,
  },
  "/clients": {
    title: "Clientes",
    subtitle: "Contas e marcas da plataforma",
    hasDateRange: true,
    hasFilterBar: false,
  },
  "/accesses": {
    title: "Acessos",
    subtitle: "Acessos dos clientes filtrados por marca",
    hasDateRange: false,
    hasFilterBar: false,
  },
  "/extractions": {
    title: "Extrações",
    subtitle: "Histórico dos agendamentos de dados",
    hasDateRange: false,
    hasFilterBar: false,
  },
  "/relatorios-automaticos": {
    title: "Relatórios automáticos",
    subtitle: "Envio interno de relatórios por WhatsApp Oficial da UP",
    hasDateRange: false,
    hasFilterBar: false,
  },
  "/notifications": {
    title: "Notificações",
    subtitle: "Alertas e movimentações da operação",
    hasDateRange: false,
    hasFilterBar: false,
    requiresClient: true,
  },
  "/compare": {
    title: "Comparar marcas",
    subtitle: "Compare o desempenho de até quatro marcas",
    hasDateRange: true,
    hasFilterBar: false,
  },
  "/overview": {
    title: "Visão geral da plataforma",
    subtitle: "Todas as marcas do grupo em uma visão",
    hasDateRange: true,
    hasFilterBar: false,
  },
  "/marketing": {
    title: "Anúncios",
    subtitle: "Investimento, ROAS, CPL e desempenho dos criativos",
    hasDateRange: true,
    hasFilterBar: true,
    requiresClient: true,
  },
  "/erp": {
    title: "Visão Geral",
    subtitle: "Visão operacional do Miré",
    hasDateRange: true,
    hasFilterBar: false,
    requiresClient: true,
  },
  "/erp/pedidos": {
    title: "Pedidos ERP",
    subtitle: "Faturamento, atendimento e situação comercial",
    hasDateRange: true,
    hasFilterBar: false,
    requiresClient: true,
  },
  "/erp/clientes": {
    title: "Clientes ERP",
    subtitle: "Base histórica de compradores e relacionamento",
    hasDateRange: true,
    hasFilterBar: false,
    requiresClient: true,
  },
  "/erp/produtos": {
    title: "Produtos ERP",
    subtitle: "Venda, grade, estoque e cobertura",
    hasDateRange: true,
    hasFilterBar: false,
    requiresClient: true,
  },
  "/erp/estoque": {
    title: "Estoque ERP",
    subtitle: "Giro, cobertura, risco e poder de venda",
    hasDateRange: true,
    hasFilterBar: false,
    requiresClient: true,
  },
  "/erp/vendedores": {
    title: "Vendedores ERP",
    subtitle: "Produtividade comercial por vendedor e loja",
    hasDateRange: true,
    hasFilterBar: false,
    requiresClient: true,
  },
  "/performance": {
    title: "Visão Geral",
    subtitle: "Mídia, ERP e e-commerce em uma visão consolidada",
    hasDateRange: true,
    hasFilterBar: false,
    requiresClient: true,
  },
  // Achado 11/09/2026: primeiro submenu da nova arquitetura de Performance
  // (Visão Geral > Funil de Conversão > Novos Clientes > Recompra >
  // Cadastros > Anúncios > Origem de Resultados > Escala, ver PDF de
  // especificação) -- convive com o /performance atual (atribuição paga)
  // por enquanto, sem substituir nada ainda.
  "/performance/recompra": {
    title: "Recompra",
    subtitle: "Recompra — recorrência, reativação e ciclo de retorno da base",
    hasDateRange: true,
    hasFilterBar: false,
    requiresClient: true,
  },
  "/whatsapp": {
    title: "WhatsApp",
    subtitle: "Atendimento, velocidade e produtividade",
    hasDateRange: false,
    hasFilterBar: false,
    requiresClient: true,
  },
  "/whatsapp/conversas": {
    title: "Conversas WhatsApp",
    subtitle: "Inbox em tempo real por cliente",
    hasDateRange: false,
    hasFilterBar: false,
    requiresClient: true,
  },
  "/whatsapp/conexoes": {
    title: "Conexões WhatsApp",
    subtitle: "Números, webhooks e integrações por cliente",
    hasDateRange: false,
    hasFilterBar: false,
    requiresClient: true,
  },
  "/whatsapp/envios": {
    title: "Envios WhatsApp",
    subtitle: "Disparos teste e validação da Cloud API",
    hasDateRange: false,
    hasFilterBar: false,
    requiresClient: true,
  },
  "/whatsapp/templates": {
    title: "Modelos WhatsApp",
    subtitle: "Criação e aprovação de modelos oficiais",
    hasDateRange: false,
    hasFilterBar: false,
    requiresClient: true,
  },
  "/stock": {
    title: "Inteligência de estoque",
    subtitle: "Cobertura, risco e saúde do estoque",
    hasDateRange: false,
    hasFilterBar: true,
    requiresClient: true,
  },
  "/journey": {
    title: "Análise da jornada",
    subtitle: "Eventos, caminhos e comportamento de compra",
    hasDateRange: true,
    hasFilterBar: true,
    requiresClient: true,
  },
  "/rfm": {
    title: "Segmentação RFM",
    subtitle: "Recência, frequência e valor de compra",
    hasDateRange: true,
    hasFilterBar: true,
    requiresClient: true,
  },
  "/utm": {
    title: "Análise de UTM e origens",
    subtitle: "Atribuição por origem, mídia e campanha",
    hasDateRange: true,
    hasFilterBar: true,
    requiresClient: true,
  },
  "/orquestrador": {
    title: "IA Comercial",
    subtitle: "Orquestrador comercial B2B com WhatsApp e UP Zero",
    hasDateRange: true,
    hasFilterBar: false,
  },
  "/orquestrador/crm": {
    title: "CRM Comercial",
    subtitle: "Pipeline de atendimento e oportunidades B2B",
    hasDateRange: true,
    hasFilterBar: false,
    requiresClient: true,
  },
  "/orquestrador/cadastros": {
    title: "Cadastros IA",
    subtitle: "Clientes captados e cadastros acompanhados pelo agente",
    hasDateRange: true,
    hasFilterBar: false,
    requiresClient: true,
  },
  "/orquestrador/automacoes": {
    title: "Automações Comerciais",
    subtitle: "Regras seguras por evento de e-commerce",
    hasDateRange: false,
    hasFilterBar: false,
  },
  "/orquestrador/configuracoes": {
    title: "Configurações IA",
    subtitle: "Limites, handoffs e operação assistida",
    hasDateRange: false,
    hasFilterBar: false,
  },
  "/orquestrador/simulador": {
    title: "Simulador IA",
    subtitle: "Teste de respostas antes de conectar backend real",
    hasDateRange: false,
    hasFilterBar: false,
  },
  "/orquestrador/logs": {
    title: "Logs IA",
    subtitle: "Auditoria visual dos eventos do orquestrador",
    hasDateRange: true,
    hasFilterBar: false,
  },
  "/agente-vendas": {
    title: "Agente de Vendas",
    subtitle: "IA comercial assistida para atendimento B2B",
    hasDateRange: true,
    hasFilterBar: false,
    requiresClient: true,
  },
  "/agente-vendas/crm": {
    title: "CRM do Agente",
    subtitle: "Pipeline comercial assistido para leads e oportunidades",
    hasDateRange: true,
    hasFilterBar: false,
    requiresClient: true,
  },
  "/agente-vendas/simulacao": {
    title: "Simulação do Agente",
    subtitle: "Teste respostas antes de usar em atendimento real",
    hasDateRange: true,
    hasFilterBar: false,
    requiresClient: true,
  },
  "/agente-vendas/configuracoes": {
    title: "Configurações do Agente",
    subtitle: "Regras, limites e ações permitidas",
    hasDateRange: false,
    hasFilterBar: false,
    requiresClient: true,
  },
};

// Sentinel value for the topbar picker when an admin selects the
// platform-wide entry. Real client IDs are CUIDs, so this can never collide.
const PLATFORM_PICK = "__platform__";
const ADMIN_DISPLAY_EMAIL = "admin@updash.com";
const GLOBAL_SWITCH_MIN_MS = 650;
const GLOBAL_SWITCH_MAX_MS = 12000;
const ADMIN_CLIENTS_CACHE_KEY = "updash.adminClientOptions.v1";
const DESIGN_DEMO =
  import.meta.env.DEV && import.meta.env.VITE_DESIGN_DEMO === "1";
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
  // Abas do menu lateral escondidas manualmente pra esse client (admin
  // configura em /clients — ver VisibleTabsDialog). Null/vazio = mostra
  // tudo que já seria mostrado pelas regras de B2B/B2C/Vesti de sempre.
  hiddenNavItems: string[] | null;
};

function toAdminClientOption(client: Client): AdminClientOption {
  return {
    id: client.id,
    name: client.name,
    dashboardType: client.dashboardType ?? null,
    currency: client.currency,
    locale: client.locale,
    commercePlatform: client.commercePlatform ?? null,
    hiddenNavItems: client.hiddenNavItems ?? null,
  };
}

function readCachedAdminClients(): AdminClientOption[] {
  if (typeof window === "undefined") return [];

  try {
    const parsed = JSON.parse(
      localStorage.getItem(ADMIN_CLIENTS_CACHE_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(
        (client): AdminClientOption => ({
          id: typeof client?.id === "string" ? client.id : "",
          name: typeof client?.name === "string" ? client.name : "",
          dashboardType:
            client?.dashboardType === "B2B" || client?.dashboardType === "B2C"
              ? client.dashboardType
              : null,
          currency:
            typeof client?.currency === "string" ? client.currency : "BRL",
          locale: typeof client?.locale === "string" ? client.locale : "pt-BR",
          commercePlatform:
            typeof client?.commercePlatform === "string"
              ? client.commercePlatform
              : null,
          hiddenNavItems: Array.isArray(client?.hiddenNavItems)
            ? client.hiddenNavItems
            : null,
        }),
      )
      .filter((client) => client.id && client.name);
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
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
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
  const { language, t } = useI18n();
  const { dateRange, setDateRange } = useDashboardFilters();
  const { setOpen: setShortcutsOpen } = useKeyboardShortcuts();
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [expandedNav, setExpandedNav] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location]);
  const [cachedAdminClients, setCachedAdminClients] = useState<
    AdminClientOption[]
  >(readCachedAdminClients);
  const userDisplayName = getUserDisplayName(user);
  const userInitials = getUserInitials(userDisplayName);

  // Bridge the "/" shortcut to the command palette. The topbar search is now
  // a button that opens a palette (not an <input>), so "focusing search"
  // means opening the palette.
  useEffect(() => {
    (window as unknown as { __focusSearch?: () => void }).__focusSearch =
      () => {
        setSearchOpen(true);
      };
    return () => {
      delete (window as unknown as { __focusSearch?: () => void })
        .__focusSearch;
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
        refetchInterval: (query) =>
          query.state.status === "error" ? 30_000 : false,
      }),
    },
  );

  useEffect(() => {
    if (!Array.isArray(clientsData?.data) || clientsData.data.length === 0) {
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

  const adminClients = useMemo(() => {
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
  }, [cachedAdminClients, clientsData?.data, selectedDashboardMode]);

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
    predicate: (query) =>
      query.state.fetchStatus === "fetching" &&
      !isBackgroundQueryKey(query.queryKey),
  });

  const [isGlobalSwitchLoading, setIsGlobalSwitchLoading] = useState(false);
  const [globalSwitchReason, setGlobalSwitchReason] = useState<
    "client" | "period" | "context"
  >("context");
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
          ? (user.clientId ?? "")
          : location === "/overview"
            ? PLATFORM_PICK
            : (selectedClientId ?? ""),
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

    const clientChanged =
      previous.clientId !== globalContext.clientId ||
      previous.mode !== globalContext.mode;
    const periodChanged =
      previous.dateFrom !== globalContext.dateFrom ||
      previous.dateTo !== globalContext.dateTo;
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

  const architecture = architectureForPath(location);
  const breadcrumbArchitecture =
    architecture ?? architectureForPath(navigationPath(location));
  const inheritedMeta = architecture
    ? pageMeta[architecture.legacy]
    : undefined;
  const meta = (architecture && inheritedMeta
    ? {
        ...inheritedMeta,
        title: architecture.title,
        ...(architecture.page === "monthly-history"
          ? { hasDateRange: false, subtitle: "Métricas consolidadas por mês" }
          : {}),
      }
    : undefined) ??
    pageMeta[location] ??
    (location.startsWith("/products/")
      ? {
          title: "Detalhes do produto",
          subtitle: "Perfil de desempenho",
          hasDateRange: false,
          hasFilterBar: false,
          requiresClient: true,
        }
      : null) ??
    (location.startsWith("/customers/")
      ? {
          title: "Detalhes do cliente",
          subtitle: "Histórico de compras e comportamento",
          hasDateRange: false,
          hasFilterBar: false,
          requiresClient: true,
        }
      : null) ??
    (location.startsWith("/sellers/")
      ? {
          title: "Detalhes da vendedora",
          subtitle: "Faturamento, pedidos e principais clientes",
          hasDateRange: true,
          hasFilterBar: false,
          requiresClient: true,
        }
      : null) ??
    (location.startsWith("/orquestrador/clientes/")
      ? {
          title: "Operação IA Comercial",
          subtitle: "Configuração e qualidade por cliente B2B",
          hasDateRange: true,
          hasFilterBar: false,
          requiresClient: true,
        }
      : null) ?? {
      title: "UP Dash",
      subtitle: "",
      hasDateRange: false,
      hasFilterBar: false,
    };
  const pageTranslationKey =
    location === "/" || location === "/dashboard"
      ? "dashboard"
      : location === "/orders"
        ? "orders"
        : null;
  const navTitleKeys: Record<string, string> = {
    "/funnel": "nav.funnel",
    "/customers": "nav.customers",
    "/orders": "nav.orders",
    "/products": "nav.products",
    "/sellers": "nav.sellers",
    "/geography": "nav.geography",
    "/clients": "nav.clients",
    "/notifications": "nav.notifications",
    "/compare": "nav.compareBrands",
    "/overview": "nav.platformOverview",
    "/stock": "nav.stock",
    "/journey": "nav.journey",
    "/rfm": "nav.rfm",
    "/utm": "nav.utm",
  };
  const titleText =
    architecture?.title ??
    (pageTranslationKey
      ? t(`page.${pageTranslationKey}.title`, meta.title)
      : navTitleKeys[location]
        ? t(navTitleKeys[location], meta.title)
        : meta.title);
  const subtitleText =
    location === "/" || location === "/dashboard"
      ? `${new Intl.DateTimeFormat(language === "pt" ? "pt-BR" : language === "ko" ? "ko-KR" : "en-US", { weekday: "long", day: "numeric", month: "long" }).format(new Date())} · ${DESIGN_DEMO ? "prévia visual" : t("page.dashboard.live", "live data")}`
      : pageTranslationKey
        ? t(`page.${pageTranslationKey}.subtitle`, meta.subtitle)
        : meta.subtitle;
  const globalLoadingClientName =
    location === "/overview"
      ? "visão da plataforma"
      : (activeClient?.name ??
        (user?.role === "CLIENT" ? "sua marca" : "cliente selecionado"));
  const globalLoadingDescription =
    globalSwitchReason === "period"
      ? `Atualizando ${globalLoadingClientName} para ${format(dateRange.from, "dd/MM/yyyy")} a ${format(dateRange.to, "dd/MM/yyyy")}.`
      : `Carregando dados de ${globalLoadingClientName}.`;

  const b2bOnlyRoutes = useMemo(
    () =>
      new Set([
        "/whatsapp",
        "/utm",
        "/sellers",
        "/journey",
        "/orquestrador",
        "/agente-vendas",
        "/erp",
        "/performance",
      ]),
    [],
  );
  const b2cOnlyRoutes = useMemo(() => new Set(["/daily", "/scale"]), []);
  // Clientes Vesti são dashboardType=B2B (venda por atacado), mas já têm
  // relatório diário via BigQuery (ver vestiDashboardController.getDailyReport)
  // — por isso "/daily" fica liberado pra eles mesmo em modo B2B.
  const vestiEnabledB2cRoutes = useMemo(
    () => new Set(["/daily", "/scale"]),
    [],
  );
  const isVestiClient = activeClient?.commercePlatform === "VESTI";
  const isB2BOnlyRoute = useCallback(
    (href: string) => {
      const entry = architectureForPath(href);
      return (
        Boolean(entry && "b2bOnly" in entry && entry.b2bOnly) ||
        b2bOnlyRoutes.has(href) ||
        href.startsWith("/whatsapp/") ||
        href.startsWith("/erp/") ||
        href.startsWith("/orquestrador/") ||
        href.startsWith("/agente-vendas/")
      );
    },
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

  const visibleNav = (item: { href: string }) => {
    const source = legacyPath(item.href);
    if (effectiveDashboardMode === "B2C" && isB2BOnlyRoute(source))
      return false;
    if (
      effectiveDashboardMode === "B2B" &&
      b2cOnlyRoutes.has(source) &&
      !(isVestiClient && vestiEnabledB2cRoutes.has(source))
    )
      return false;
    return (
      !activeClient?.hiddenNavItems?.includes(source) &&
      !activeClient?.hiddenNavItems?.includes(item.href)
    );
  };
  const analyticsNav: NavEntry[] = [
    { name: "Visão Geral", href: "/dashboard", icon: LayoutDashboard },
    {
      name: "ERP",
      href: "/erp",
      icon: Store,
      children: [
        { name: "Visão Geral", href: "/erp", icon: LayoutDashboard },
        { name: "Pedidos", href: "/erp/pedidos", icon: ReceiptText },
        { name: "Clientes", href: "/erp/clientes", icon: Users },
        { name: "Produtos", href: "/erp/produtos", icon: Package },
        { name: "Estoque", href: "/erp/estoque", icon: PackageSearch },
        { name: "Vendedoras e Lojas", href: "/erp/vendedores", icon: Users },
        { name: "Geografia", href: "/erp/geografia", icon: MapPin },
      ],
    },
    {
      name: "Desempenho",
      href: "/performance",
      icon: Gauge,
      children: [
        { name: "Visão Geral", href: "/performance", icon: LayoutDashboard },
        {
          name: "Funil de Conversão",
          href: "/performance/funil",
          icon: Filter,
        },
        {
          name: "Novos Clientes",
          href: "/performance/novos-clientes",
          icon: UserRoundCheck,
        },
        { name: "Recompra", href: "/performance/recompra", icon: RefreshCw },
        { name: "Cadastros", href: "/performance/cadastros", icon: Users },
        { name: "Anúncios", href: "/performance/anuncios", icon: Megaphone },
        {
          name: "Jornada & Atribuição",
          href: "/performance/jornada",
          icon: Route,
        },
      ],
    },
    {
      name: "E-commerce",
      href: "/ecommerce",
      icon: ShoppingBag,
      children: [
        { name: "Visão Geral", href: "/ecommerce", icon: LayoutDashboard },
        { name: "Pedidos", href: "/ecommerce/pedidos", icon: ReceiptText },
        { name: "Cadastros", href: "/ecommerce/cadastros", icon: Users },
        { name: "Produtos", href: "/ecommerce/produtos", icon: Package },
        { name: "Estoque", href: "/ecommerce/estoque", icon: PackageSearch },
        { name: "Vendedores", href: "/ecommerce/vendedores", icon: Users },
        { name: "Geografia", href: "/ecommerce/geografia", icon: MapPin },
        {
          name: "Inteligência de Clientes",
          href: "/ecommerce/inteligencia-clientes",
          icon: BarChart3,
        },
        {
          name: "Histórico Mensal",
          href: "/ecommerce/historico-mensal",
          icon: CalendarDays,
        },
      ],
    },
    {
      name: "WhatsApp",
      href: "/whatsapp",
      icon: MessageCircle,
      children: [
        { name: "Análise de Atendimento", href: "/whatsapp", icon: BarChart3 },
        {
          name: "Conversas",
          href: "/whatsapp/conversas",
          icon: MessageSquareText,
        },
        { name: "Conexões", href: "/whatsapp/conexoes", icon: PlugZap },
      ],
    },
  ]
    .map((item) => {
      const children = item.children?.filter(visibleNav);
      return {
        ...item,
        children,
        href:
          item.href === "/performance" && !visibleNav(item) && children?.length
            ? children[0].href
            : item.href,
      };
    })
    .filter((item) => {
      // A group can retain eligible children even when its legacy overview is restricted.
      if (item.name === "Performance" && item.children?.length) return true;
      return visibleNav(item);
    });

  const workspaceNav: NavEntry[] = [
    ...[
      { name: t("nav.daily", "Diário"), href: "/daily", icon: CalendarDays },
      { name: t("nav.scale", "Escala"), href: "/scale", icon: Scale },
      { name: "Envios WhatsApp", href: "/whatsapp/envios", icon: Send },
      {
        name: "Modelos WhatsApp",
        href: "/whatsapp/templates",
        icon: FileText,
      },
    ].filter(visibleNav),
    {
      name: t("nav.notifications", "Notificações"),
      href: "/notifications",
      icon: Bell,
    },
  ];

  if (user?.role === "ADMIN") {
    workspaceNav.unshift({
      name: t("nav.platformOverview", "Visão geral da plataforma"),
      href: "/overview",
      icon: Globe2,
    });
    workspaceNav.push({
      name: t("nav.compareBrands", "Comparar marcas"),
      href: "/compare",
      icon: GitCompareArrows,
    });
    workspaceNav.push({
      name: t("nav.clients", "Clientes"),
      href: "/clients",
      icon: Building2,
    });
    workspaceNav.push({
      name: t("nav.accesses", "Acessos"),
      href: "/accesses",
      icon: KeyRound,
    });
    workspaceNav.push({
      name: t("nav.extractions", "Extrações"),
      href: "/extractions",
      icon: History,
    });
    workspaceNav.push({
      name: t("nav.automaticReports", "Relatórios automáticos"),
      href: "/relatorios-automaticos",
      icon: FileClock,
    });
    if (selectedDashboardMode === "B2B") {
      workspaceNav.push({
        name: t("nav.orchestrator", "IA Comercial"),
        href: "/orquestrador",
        icon: Bot,
        children: [
          {
            name: t("nav.orchestrator.overview", "Visão Geral"),
            href: "/orquestrador",
            icon: Sparkles,
          },
          {
            name: t("nav.orchestrator.crm", "CRM"),
            href: "/orquestrador/crm",
            icon: Workflow,
          },
          {
            name: t("nav.orchestrator.registrations", "Cadastros"),
            href: "/orquestrador/cadastros",
            icon: Users,
          },
          {
            name: t("nav.orchestrator.automations", "Automações"),
            href: "/orquestrador/automacoes",
            icon: Bot,
          },
          {
            name: t("nav.orchestrator.settings", "Configurações"),
            href: "/orquestrador/configuracoes",
            icon: Settings2,
          },
          {
            name: t("nav.orchestrator.simulator", "Simulador"),
            href: "/orquestrador/simulador",
            icon: PlayCircle,
          },
          {
            name: t("nav.orchestrator.logs", "Logs"),
            href: "/orquestrador/logs",
            icon: FileText,
          },
        ],
      });
    }
  } else if (effectiveDashboardMode === "B2B") {
    workspaceNav.push({
      name: t("nav.salesAgent", "Agente de Vendas"),
      href: "/agente-vendas",
      icon: Bot,
      children: [
        {
          name: t("nav.salesAgent.crm", "CRM"),
          href: "/agente-vendas/crm",
          icon: Workflow,
        },
        {
          name: t("nav.salesAgent.simulation", "Simulação"),
          href: "/agente-vendas/simulacao",
          icon: PlayCircle,
        },
        {
          name: t("nav.salesAgent.settings", "Configurações"),
          href: "/agente-vendas/configuracoes",
          icon: Settings2,
        },
      ],
    });
  }

  const renderNavItem = (item: NavEntry, scope: string) => {
    const navLocation = navigationPath(location);
    const isActive =
      navLocation === item.href ||
      (item.href === "/dashboard" && location === "/") ||
      Boolean(item.children?.some((child) => child.href === navLocation)) ||
      (item.href === "/orquestrador" &&
        location.startsWith("/orquestrador/clientes/")) ||
      (item.href === "/agente-vendas" &&
        location.startsWith("/agente-vendas/"));
    const expanded = expandedNav[item.href] ?? isActive;
    const submenuId = `${scope}-submenu-${item.href.replace(/\//g, "-")}`;
    return (
      <div>
        <div className={`up-nav-row ${isActive ? "is-active" : ""}`}>
          <Link
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            data-testid={`nav-${item.href.replace(/^\//, "").replace(/\//g, "-") || "dashboard"}`}
            className="up-nav-link"
          >
            <item.icon className="h-[18px] w-[18px] shrink-0" />
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
          </Link>
          {item.children && (
            <button
              type="button"
              className="up-nav-toggle"
              aria-label={`${expanded ? "Recolher" : "Expandir"} ${item.name}`}
              aria-expanded={expanded}
              aria-controls={submenuId}
              onClick={() =>
                setExpandedNav((previous) => ({
                  ...previous,
                  [item.href]: !expanded,
                }))
              }
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </div>
        {item.children && expanded && (
          <div id={submenuId} className="up-nav-sub">
            {item.children.map((child) => (
              <Link
                key={child.href}
                href={child.href}
                aria-current={
                  navigationPath(location) === child.href ? "page" : undefined
                }
                data-testid={`nav-${child.href.replace(/^\//, "").replace(/\//g, "-")}`}
                className="up-nav-sub-link"
              >
                <child.icon className="h-3.5 w-3.5 shrink-0" />
                {child.name}
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderSidebarContent = (scope: string) => (
    <>
      <div className="up-brand">
        <Link href="/dashboard" className="flex flex-col items-start gap-2">
          <img
            src={`${import.meta.env.BASE_URL}brand/up-group.png`}
            alt="Grupo UP"
            className="h-[30px] w-auto object-contain"
            draggable={false}
          />
          <span className="up-brand-sub">
            UP Dash · Inteligência de negócios
          </span>
        </Link>
      </div>

      <nav
        aria-label="Navegação principal"
        className="up-nav flex-1 space-y-6 overflow-y-auto"
      >
        <div>
          <p className="up-nav-label">{t("nav.analytics", "Análises")}</p>
          <div className="space-y-0.5">
            {analyticsNav.map((item) => (
              <div key={item.href}>{renderNavItem(item, scope)}</div>
            ))}
          </div>
        </div>

        <div>
          <p className="up-nav-label">{t("nav.workspace", "Gestão")}</p>
          <div className="space-y-0.5">
            {workspaceNav.map((item) => (
              <div key={item.href}>{renderNavItem(item, scope)}</div>
            ))}
          </div>
        </div>
      </nav>

      <div className="up-sidebar-footer up-glass-panel">
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
              {user?.role === "CLIENT" && clientData
                ? clientData.name
                : "Time Grupo UP"}
            </p>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between px-2 text-[11px] text-muted-foreground">
          <span>{t("top.system", "Sistema")}</span>
          <span className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                health?.status === "ok" ? "bg-emerald-500" : "bg-red-500"
              }`}
            />
            {health?.status === "ok" ? "Conectado" : health?.status ? "Indisponível" : "Verificando"}
          </span>
        </div>
      </div>
    </>
  );

  const renderClientPicker = (mobile = false) => (
    <Select
      value={
        location === "/overview" ? PLATFORM_PICK : (selectedClientId ?? "")
      }
      onValueChange={(val) => {
        if (val === PLATFORM_PICK) {
          setSelectedClientId(null);
          navigate("/overview");
          return;
        }
        setSelectedClientId(val);
        if (location === "/overview") navigate("/dashboard");
      }}
    >
      <SelectTrigger
        data-testid={mobile ? "mobile-client-picker" : "client-picker"}
        aria-label={t("top.selectClient", "Selecione um cliente")}
        className="h-9 bg-card border-border"
      >
        <SelectValue placeholder={t("top.selectClient", "Selecione um cliente")} />
      </SelectTrigger>
      <SelectContent
        className="max-h-[min(70vh,28rem)]"
        viewportClassName="h-auto max-h-[min(64vh,25rem)] overflow-y-auto overscroll-contain touch-pan-y"
      >
        <SelectItem value={PLATFORM_PICK} data-testid="client-picker-platform">
          <span className="flex items-center gap-2">
            <Globe2 className="h-3.5 w-3.5 text-primary" />
            {t("top.allClients", "Todos os clientes · Plataforma")}
          </span>
        </SelectItem>
        {adminClients.length > 0 && <div className="my-1 h-px bg-border" />}
        {adminClients.map((client) => (
          <SelectItem key={client.id} value={client.id}>
            <span className="flex w-full items-center justify-between gap-2">
              <span className="truncate">{client.name}</span>
              {client.commercePlatform && (
                <Badge
                  variant={
                    client.commercePlatform === "VESTI"
                      ? "default"
                      : "secondary"
                  }
                  className="shrink-0 px-1.5 py-0 text-[10px] font-normal"
                >
                  {client.commercePlatform}
                </Badge>
              )}
            </span>
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
              <p>
                {t(
                  "top.clientsError",
                  "Não foi possível carregar os clientes.",
                )}
              </p>
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
        {!LOCAL_UI_PREVIEW && isClientsError && adminClients.length > 0 && (
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
              {t(
                "top.noClientsForMode",
                "Nenhum cliente disponível neste modo.",
              )}
            </div>
          )}
      </SelectContent>
    </Select>
  );

  return (
    <div className="up-app flex h-dvh overflow-hidden text-foreground">
      <a href="#main-content" className="up-skip-link">
        Ir para o conteúdo
      </a>
      <aside className="up-sidebar hidden w-[268px] shrink-0 flex-col md:flex no-print">
        {renderSidebarContent("desktop")}
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="up-topbar flex shrink-0 flex-wrap items-center gap-3 no-print">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="up-top-menu md:hidden">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Abrir menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="up-sidebar up-mobile-sidebar w-[280px] max-w-[86vw] p-0 border-border flex flex-col"
            >
              <SheetTitle className="sr-only">Menu do dashboard</SheetTitle>
              <SheetDescription className="sr-only">
                Navegue pelas áreas da sua operação.
              </SheetDescription>
              {renderSidebarContent("mobile")}
            </SheetContent>
          </Sheet>

          <div className="up-breadcrumb hidden min-w-0 items-center gap-2 2xl:flex">
            <span>
              {breadcrumbArchitecture?.group ??
                (location.startsWith("/erp")
                  ? "ERP"
                  : location.startsWith("/performance")
                    ? "Performance"
                    : location.startsWith("/whatsapp")
                      ? "WhatsApp"
                      : t("nav.analytics", "Painel"))}
            </span>
            <ChevronRight className="h-3 w-3 shrink-0" />
            <span className="truncate text-foreground">{titleText}</span>
          </div>

          {/* Search trigger — opens the command palette */}
          <div className="up-search hidden min-w-0 flex-1 2xl:flex">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              data-testid="search-trigger"
              className="relative h-9 w-full rounded-xl border border-border bg-card/30 pl-10 pr-12 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <span className="truncate">
                {t("top.search", "Buscar SKUs, categorias e clientes")}
              </span>
              <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-mono bg-muted border border-border rounded text-muted-foreground">
                ⌘K
              </kbd>
            </button>
          </div>

          <div className="up-top-controls ml-auto flex min-w-0 items-center gap-2">
            {user?.role === "ADMIN" && <Select value={selectedDashboardMode} onValueChange={(mode: "B2B" | "B2C") => {
              setSelectedDashboardMode(mode);
              if ((mode === "B2C" && isB2BOnlyRoute(location)) || (mode === "B2B" && b2cOnlyRoutes.has(location))) navigate("/dashboard");
            }}>
              <SelectTrigger className="up-top-operation h-9 w-[100px] shrink-0" aria-label="Operação" data-testid="dashboard-mode-picker"><Building2 className="h-4 w-4 text-primary" /><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="B2B">B2B</SelectItem><SelectItem value="B2C">B2C</SelectItem></SelectContent>
            </Select>}
            {user?.role === "ADMIN" && (
              <div className="up-top-client w-44 lg:w-52">
                {renderClientPicker()}
              </div>
            )}

            {meta.hasDateRange && <div className="up-top-period"><DateRangePicker value={dateRange} onChange={setDateRange} /></div>}

            <div className="up-top-actions flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="2xl:hidden"
                onClick={() => setSearchOpen(true)}
                aria-label={t("top.search", "Buscar")}
              >
                <Search className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="hidden lg:inline-flex h-9 w-9 hover:bg-accent"
                onClick={() => setShortcutsOpen(true)}
                aria-label={t("top.keyboardShortcuts", "Atalhos de teclado")}
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
                aria-label={t("top.toggleTheme", "Alternar tema")}
                data-testid="theme-toggle"
              >
                {theme === "dark" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="relative h-9 w-9 rounded-full p-0"
                  >
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
                  <DropdownMenuItem
                    onClick={() => setShortcutsOpen(true)}
                    className="cursor-pointer"
                  >
                    <HelpCircle className="mr-2 h-4 w-4" />
                    <span>
                      {t("top.keyboardShortcuts", "Atalhos de teclado")}
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={logout}
                    className="text-destructive cursor-pointer"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>{t("top.logout", "Sair")}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        <main
          id="main-content"
          className="up-main flex-1 overflow-y-auto print-area"
        >
          <section
            className="up-page-head no-print"
            aria-label="Contexto do dashboard"
          >
            <div className="min-w-0">
              <p className="up-eyebrow">
                <span className="up-status-dot" />
                {activeClient?.name ?? "Grupo UP"} ·{" "}
                {effectiveDashboardMode ?? selectedDashboardMode}
              </p>
              <h1>
                {titleText}
                {(location === "/" || location === "/dashboard") && (
                  <span className="up-display up-display-accent">
                    {" "}
                    de performance
                  </span>
                )}
              </h1>
              {subtitleText && (
                <p className="up-page-subtitle">{subtitleText}</p>
              )}
            </div>

          </section>
          {(LOCAL_UI_PREVIEW || DESIGN_DEMO) && (
            <p className="up-preview-notice no-print">
              Prévia visual · dados de demonstração
            </p>
          )}
          {(meta.hasDateRange || meta.hasFilterBar) && (
            <div className="up-control-panel up-glass-panel no-print">
              <div className="up-operation-row">
                {meta.hasDateRange && (
                  <div
                    className="up-period-chips"
                    role="group"
                    aria-label="Períodos rápidos"
                  >
                    {[7, 30, 90].map((days) => (
                      <button
                        key={days}
                        className="up-period-chip"
                        type="button"
                        aria-pressed={
                          differenceInCalendarDays(
                            dateRange.to,
                            dateRange.from,
                          ) +
                            1 ===
                            days &&
                          differenceInCalendarDays(new Date(), dateRange.to) ===
                            0
                        }
                        onClick={() => {
                          const today = startOfDay(new Date());
                          setDateRange({
                            from: subDays(today, days - 1),
                            to: today,
                          });
                        }}
                      >
                        {days}{" "}
                        {language === "pt"
                          ? "dias"
                          : language === "ko"
                            ? "일"
                            : "days"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {meta.hasFilterBar && <FilterBar />}
            </div>
          )}
          <div className="up-page-content" aria-busy={isGlobalSwitchLoading || activeDataLoads > 0}>
            {meta.requiresClient &&
            user?.role === "ADMIN" &&
            !selectedClientId ? (
              <div
                className="mx-auto flex max-w-xl flex-col items-center justify-center gap-4 rounded-2xl border border-dashed bg-card/50 p-10 text-center"
                data-testid="empty-no-client-selected"
              >
                <div className="rounded-full bg-muted p-3">
                  <Building2 className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">
                    {t(
                      "empty.selectClient.title",
                      "Selecione um cliente {mode} para continuar",
                    ).replace("{mode}", selectedDashboardMode)}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "empty.selectClient.body",
                      "Esta página exibe um cliente por vez. Selecione um cliente no topo ou abra a visão geral para ver todas as marcas.",
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button
                    onClick={() => navigate("/overview")}
                    data-testid="link-go-to-overview"
                  >
                    {t(
                      "empty.selectClient.overview",
                      "Ir para a visão geral da plataforma",
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => navigate("/clients")}
                    data-testid="link-go-to-clients"
                  >
                    {t("empty.selectClient.clients", "Ver todas as marcas")}
                  </Button>
                </div>
              </div>
            ) : (
              children
            )}
          </div>
        </main>
      </div>

      {(isGlobalSwitchLoading || activeDataLoads > 0) && (
        <div className="up-loading-overlay fixed inset-0 z-[80] flex items-center justify-center bg-background/40 px-4 backdrop-blur-[10px] no-print" role="status" aria-live="polite" aria-label="Carregando dados atualizados" data-testid="global-loader">
          <DashLoader label="Carregando dados atualizados" description={globalLoadingDescription} />
        </div>
      )}

      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
