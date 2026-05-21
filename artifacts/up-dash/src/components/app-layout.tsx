import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
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
import {
  LayoutDashboard,
  Filter,
  Users,
  Package,
  ShoppingBag,
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
} from "lucide-react";
import { useListClients, useGetClient, useHealthCheck } from "@workspace/api-client-react";
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
  "/funnel": { title: "Conversion funnel", subtitle: "Visit through purchase", hasDateRange: true, hasFilterBar: true, requiresClient: true },
  "/customers": { title: "Customers", subtitle: "RFM segmentation and lifetime value", hasDateRange: true, hasFilterBar: true, requiresClient: true },
  "/products": { title: "Products", subtitle: "Performance and ranking", hasDateRange: true, hasFilterBar: true, requiresClient: true },
  "/sellers": { title: "Sellers", subtitle: "Top performers across the catalog", hasDateRange: false, hasFilterBar: true, requiresClient: true },
  "/geography": { title: "Geography", subtitle: "Sales distribution by region", hasDateRange: true, hasFilterBar: true, requiresClient: true },
  "/clients": { title: "Clients", subtitle: "Brand accounts on the platform", hasDateRange: true, hasFilterBar: false },
  "/accesses": { title: "Acessos", subtitle: "Client logins filtered by brand", hasDateRange: false, hasFilterBar: false },
  "/extractions": { title: "Extrações", subtitle: "Histórico dos agendamentos de dados", hasDateRange: false, hasFilterBar: false },
  "/notifications": { title: "Notifications", subtitle: "Anomalies, top movers, and rollups", hasDateRange: false, hasFilterBar: false, requiresClient: true },
  "/compare": { title: "Compare brands", subtitle: "Benchmark up to four clients side-by-side", hasDateRange: true, hasFilterBar: false },
  "/overview": { title: "Platform overview", subtitle: "Every brand on UP Dash, at a glance", hasDateRange: true, hasFilterBar: false },
  "/marketing": { title: "Marketing", subtitle: "Ad spend, ROAS, CPL, and creative performance", hasDateRange: true, hasFilterBar: true, requiresClient: true },
  "/stock": { title: "Stock Intelligence", subtitle: "Coverage, risk, and inventory health", hasDateRange: false, hasFilterBar: true, requiresClient: true },
  "/journey": { title: "Journey Analytics", subtitle: "Event flow, top paths, and buyer behaviour", hasDateRange: true, hasFilterBar: true, requiresClient: true },
  "/rfm": { title: "RFM Segmentation", subtitle: "Recency, frequency, and monetary analysis", hasDateRange: true, hasFilterBar: true, requiresClient: true },
  "/utm": { title: "UTM / Source Analysis", subtitle: "Attribution by source, medium, and campaign", hasDateRange: true, hasFilterBar: true, requiresClient: true },
};

// Sentinel value for the topbar picker when an admin selects the
// platform-wide entry. Real client IDs are CUIDs, so this can never collide.
const PLATFORM_PICK = "__platform__";

export function AppLayout({ children }: AppLayoutProps) {
  const [location, navigate] = useLocation();
  const { user, logout, selectedClientId, setSelectedClientId } = useAuth();
  const { theme, setTheme } = useTheme();
  const { dateRange, setDateRange } = useDashboardFilters();
  const { setOpen: setShortcutsOpen } = useKeyboardShortcuts();
  const [searchOpen, setSearchOpen] = useState(false);

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

  const { data: clientsData } = useListClients(
    { limit: 100 },
    { query: queryOpts({ enabled: user?.role === "ADMIN" }) },
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

  const activeClient =
    user?.role === "CLIENT"
      ? clientData
      : clientsData?.data.find((c) => c.id === selectedClientId);
  useEffect(() => {
    if (activeClient?.currency && activeClient?.locale) {
      setActiveCurrency(activeClient.currency, activeClient.locale);
    }
  }, [activeClient?.currency, activeClient?.locale]);

  const { data: health } = useHealthCheck({
    query: queryOpts({ refetchInterval: 60000 }),
  });

  const meta =
    pageMeta[location] ??
    (location.startsWith("/products/") ? { title: "Product detail", subtitle: "Performance profile", hasDateRange: false, hasFilterBar: false, requiresClient: true } : null) ??
    (location.startsWith("/customers/") ? { title: "Customer detail", subtitle: "Purchase history and behaviour", hasDateRange: false, hasFilterBar: false, requiresClient: true } : null) ??
    (location.startsWith("/sellers/") ? { title: "Seller detail", subtitle: "Revenue, orders and top customers", hasDateRange: true, hasFilterBar: false, requiresClient: true } : null) ??
    { title: "UP Dash", subtitle: "", hasDateRange: false, hasFilterBar: false };
  const subtitleText =
    location === "/" || location === "/dashboard"
      ? `${format(new Date(), "EEEE, MMM d")} · live data`
      : meta.subtitle;

  const analyticsNav = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { name: "Marketing", href: "/marketing", icon: Megaphone },
    { name: "Funnel", href: "/funnel", icon: Filter },
    { name: "Journey", href: "/journey", icon: Route },
    { name: "RFM", href: "/rfm", icon: BarChart3 },
    { name: "UTM", href: "/utm", icon: Link2 },
    { name: "Customers", href: "/customers", icon: Users },
    { name: "Products", href: "/products", icon: Package },
    { name: "Sellers", href: "/sellers", icon: ShoppingBag },
    { name: "Stock", href: "/stock", icon: PackageSearch },
  ];

  const workspaceNav: { name: string; href: string; icon: typeof Users }[] = [
    { name: "Geography", href: "/geography", icon: MapPin },
    { name: "Notifications", href: "/notifications", icon: Bell },
  ];

  if (user?.role === "ADMIN") {
    workspaceNav.unshift({ name: "Platform overview", href: "/overview", icon: Globe2 });
    workspaceNav.push({ name: "Compare brands", href: "/compare", icon: GitCompareArrows });
    workspaceNav.push({ name: "Clients", href: "/clients", icon: Building2 });
    workspaceNav.push({ name: "Acessos", href: "/accesses", icon: KeyRound });
    workspaceNav.push({ name: "Extrações", href: "/extractions", icon: History });
  }

  const NavItem = ({ item }: { item: { name: string; href: string; icon: typeof Users } }) => {
    const isActive =
      location === item.href || (item.href === "/dashboard" && location === "/");
    return (
      <Link href={item.href}>
        <span
          data-testid={`nav-${item.name.toLowerCase().replace(/\s+/g, "-")}`}
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
            Analytics
          </p>
          <div className="space-y-0.5">
            {analyticsNav.map((item) => (
              <NavItem key={item.name} item={item} />
            ))}
          </div>
        </div>

        <div>
          <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
            Workspace
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
              {user?.firstName?.[0]}
              {user?.lastName?.[0]}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate text-foreground">
              {user?.firstName} {user?.lastName?.[0]}.
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {user?.role === "CLIENT" && clientData ? clientData.name : "UP Dash team"}
            </p>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between px-2 text-[11px] text-muted-foreground">
          <span>System</span>
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
              {meta.title}
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
              <span className="truncate">Search SKUs, categories, customers</span>
              <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-mono bg-muted border border-border rounded text-muted-foreground">
                /
              </kbd>
            </button>
          </div>

          <div className="ml-auto flex items-center gap-2">
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
                    <SelectValue placeholder="Select a client" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      value={PLATFORM_PICK}
                      data-testid="client-picker-platform"
                    >
                      <span className="flex items-center gap-2">
                        <Globe2 className="h-3.5 w-3.5 text-primary" />
                        All Clients · Platform
                      </span>
                    </SelectItem>
                    {clientsData && clientsData.data.length > 0 && (
                      <div className="my-1 h-px bg-border" />
                    )}
                    {clientsData?.data.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {meta.hasDateRange && (
              <DateRangePicker value={dateRange} onChange={setDateRange} />
            )}

            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 hover:bg-accent"
              onClick={() => setShortcutsOpen(true)}
              aria-label="Keyboard shortcuts"
              data-testid="open-shortcuts"
            >
              <HelpCircle className="h-4 w-4" />
            </Button>

            <NotificationBell />

            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 hover:bg-accent"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
              data-testid="theme-toggle"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-9 w-9 rounded-full p-0">
                  <Avatar className="h-9 w-9 bg-primary/15">
                    <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">
                      {user?.firstName?.[0]}
                      {user?.lastName?.[0]}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">
                      {user?.firstName} {user?.lastName}
                    </p>
                    <p className="text-xs leading-none text-muted-foreground">
                      {user?.email}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShortcutsOpen(true)} className="cursor-pointer">
                  <HelpCircle className="mr-2 h-4 w-4" />
                  <span>Keyboard shortcuts</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={logout} className="text-destructive cursor-pointer">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
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
                <h2 className="text-lg font-semibold">Select a brand to continue</h2>
                <p className="text-sm text-muted-foreground">
                  This page shows data for one brand at a time. Pick a brand from the
                  selector at the top of the page, or open the platform overview to
                  see how every brand is doing.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => navigate("/overview")} data-testid="link-go-to-overview">
                  Go to platform overview
                </Button>
                <Button variant="outline" onClick={() => navigate("/clients")} data-testid="link-go-to-clients">
                  Browse all brands
                </Button>
              </div>
            </div>
          ) : (
            children
          )}
        </main>
      </div>

      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
