import { ReactNode, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useTheme } from "@/components/theme-provider";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { DateRangePicker } from "@/components/date-range-picker";
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
  Bell,
  Search,
  Activity,
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

interface AppLayoutProps {
  children: ReactNode;
}

interface PageMeta {
  title: string;
  subtitle: string;
  hasDateRange: boolean;
}

const pageMeta: Record<string, PageMeta> = {
  "/": { title: "Overview", subtitle: "", hasDateRange: true },
  "/dashboard": { title: "Overview", subtitle: "", hasDateRange: true },
  "/funnel": { title: "Conversion funnel", subtitle: "Visit through purchase", hasDateRange: true },
  "/customers": { title: "Customers", subtitle: "RFM segmentation and lifetime value", hasDateRange: false },
  "/products": { title: "Products", subtitle: "Performance and ranking", hasDateRange: false },
  "/sellers": { title: "Sellers", subtitle: "Top performers across the catalog", hasDateRange: false },
  "/geography": { title: "Geography", subtitle: "Sales distribution by region", hasDateRange: true },
  "/clients": { title: "Clients", subtitle: "Brand accounts on the platform", hasDateRange: false },
};

export function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();
  const { user, logout, selectedClientId, setSelectedClientId } = useAuth();
  const { theme, setTheme } = useTheme();
  const { dateRange, setDateRange } = useDashboardFilters();

  const { data: clientsData } = useListClients(
    { limit: 100 },
    { query: queryOpts({ enabled: user?.role === "ADMIN" }) },
  );

  // Admin must always be viewing a specific client — auto-pick the first one
  // when none is selected (the analytics endpoints require a clientId).
  useEffect(() => {
    if (
      user?.role === "ADMIN" &&
      !selectedClientId &&
      clientsData?.data &&
      clientsData.data.length > 0
    ) {
      setSelectedClientId(clientsData.data[0].id);
    }
  }, [user?.role, selectedClientId, clientsData, setSelectedClientId]);

  const { data: clientData } = useGetClient(user?.clientId || "", {
    query: queryOpts({ enabled: user?.role === "CLIENT" && !!user?.clientId }),
  });

  const { data: health } = useHealthCheck({
    query: queryOpts({ refetchInterval: 60000 }),
  });

  const meta = pageMeta[location] ?? { title: "UP Dash", subtitle: "", hasDateRange: false };
  const subtitleText =
    location === "/" || location === "/dashboard"
      ? `${format(new Date(), "EEEE, MMM d")} · live data`
      : meta.subtitle;

  const analyticsNav = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { name: "Funnel", href: "/funnel", icon: Filter },
    { name: "Customers", href: "/customers", icon: Users },
    { name: "Products", href: "/products", icon: Package },
    { name: "Sellers", href: "/sellers", icon: ShoppingBag },
  ];

  const workspaceNav: { name: string; href: string; icon: typeof Users }[] = [
    { name: "Geography", href: "/geography", icon: MapPin },
  ];

  if (user?.role === "ADMIN") {
    workspaceNav.push({ name: "Clients", href: "/clients", icon: Building2 });
  }

  const NavItem = ({ item }: { item: { name: string; href: string; icon: typeof Users } }) => {
    const isActive =
      location === item.href || (item.href === "/dashboard" && location === "/");
    return (
      <Link href={item.href}>
        <span
          data-testid={`nav-${item.name.toLowerCase()}`}
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
        <Link href="/dashboard" className="flex items-center gap-1.5 text-xl font-bold tracking-tight">
          <Activity className="h-5 w-5 text-primary" />
          <span>
            <span className="text-primary">up</span>
            <span className="text-foreground">dash</span>
          </span>
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
      {/* Desktop Sidebar */}
      <aside className="hidden w-60 flex-col border-r border-border bg-sidebar md:flex">
        <SidebarContent />
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-background px-4 sm:px-6">
          {/* Mobile nav trigger */}
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

          {/* Page title */}
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold leading-tight truncate">
              {meta.title}
            </h1>
            {subtitleText && (
              <p className="text-xs text-muted-foreground truncate">{subtitleText}</p>
            )}
          </div>

          {/* Search (decorative for now) */}
          <div className="hidden lg:flex flex-1 max-w-md ml-4">
            <div className="relative w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="search"
                disabled
                placeholder="Search SKUs, categories, campaigns"
                className="w-full h-9 bg-card border border-border rounded-md pl-10 pr-12 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed"
              />
              <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-mono bg-muted border border-border rounded text-muted-foreground">
                ⌘K
              </kbd>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* Client picker (admin) */}
            {user?.role === "ADMIN" && (
              <div className="hidden sm:block w-44">
                <Select
                  value={selectedClientId ?? undefined}
                  onValueChange={(val) => setSelectedClientId(val)}
                >
                  <SelectTrigger
                    data-testid="client-picker"
                    className="h-9 bg-card border-border"
                  >
                    <SelectValue placeholder="Select a client" />
                  </SelectTrigger>
                  <SelectContent>
                    {clientsData?.data.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Date range pill */}
            {meta.hasDateRange && (
              <DateRangePicker value={dateRange} onChange={setDateRange} />
            )}

            {/* Notifications */}
            <Button
              variant="ghost"
              size="icon"
              className="relative h-9 w-9 hover:bg-accent"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
              <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-primary" />
            </Button>

            {/* Theme toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 hover:bg-accent"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            {/* Avatar menu */}
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
                <DropdownMenuItem onClick={logout} className="text-destructive cursor-pointer">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto bg-background p-4 sm:p-6 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
