import { ReactNode, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useTheme } from "@/components/theme-provider";
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
  Activity
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

export function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();
  const { user, logout, selectedClientId, setSelectedClientId } = useAuth();
  const { theme, setTheme } = useTheme();

  const { data: clientsData } = useListClients(
    { limit: 100 },
    { query: queryOpts({ enabled: user?.role === "ADMIN" }) }
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

  const navigation = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { name: "Funnel", href: "/funnel", icon: Filter },
    { name: "Customers", href: "/customers", icon: Users },
    { name: "Products", href: "/products", icon: Package },
    { name: "Sellers", href: "/sellers", icon: ShoppingBag },
    { name: "Geography", href: "/geography", icon: MapPin },
  ];

  if (user?.role === "ADMIN") {
    navigation.push({ name: "Clients", href: "/clients", icon: Building2 });
  }

  const NavLinks = () => (
    <div className="flex-1 space-y-1">
      {navigation.map((item) => {
        const isActive = location === item.href || (item.href === "/dashboard" && location === "/");
        return (
          <Link key={item.name} href={item.href}>
            <span
              data-testid={`nav-${item.name.toLowerCase()}`}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.name}
            </span>
          </Link>
        );
      })}
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 flex-col border-r bg-card md:flex">
        <div className="flex h-16 items-center px-6 border-b">
          <Link href="/dashboard" className="flex items-center gap-2 font-bold text-xl tracking-tight">
            <div className="bg-primary text-primary-foreground p-1 rounded">
              <Activity className="h-5 w-5" />
            </div>
            UP Dash
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <NavLinks />
        </div>
        <div className="p-4 border-t text-xs text-muted-foreground flex items-center justify-between">
          <span>System Status</span>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${health?.status === 'ok' ? 'bg-green-500' : 'bg-red-500'}`}></span>
            {health?.status || 'checking'}
          </div>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <header className="flex h-16 items-center justify-between border-b bg-card px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Toggle navigation</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <div className="flex h-16 items-center px-6 border-b">
                  <span className="font-bold text-xl tracking-tight">UP Dash</span>
                </div>
                <div className="p-4">
                  <NavLinks />
                </div>
              </SheetContent>
            </Sheet>

            {user?.role === "ADMIN" && (
              <div className="w-56">
                <Select
                  value={selectedClientId ?? undefined}
                  onValueChange={(val) => setSelectedClientId(val)}
                >
                  <SelectTrigger data-testid="client-picker">
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
            {user?.role === "CLIENT" && clientData && (
              <div className="font-medium text-sm">
                {clientData.name}
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? (
                <Sun className="h-5 w-5" />
              ) : (
                <Moon className="h-5 w-5" />
              )}
              <span className="sr-only">Toggle theme</span>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-primary/10">
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
        <main className="flex-1 overflow-y-auto bg-muted/20 p-4 sm:p-6 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
