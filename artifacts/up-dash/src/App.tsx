import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { AppLayout } from "@/components/app-layout";
import { AuthGuard } from "@/components/auth-guard";
import { handleApiError } from "@/lib/api-error";
import { DashboardFiltersProvider } from "@/lib/dashboard-filters";
import { KeyboardShortcutsProvider } from "@/lib/keyboard-shortcuts";
import { PageTransition } from "@/components/page-transition";
import { useMemo } from "react";

import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import PrivacyPolicyPage from "@/pages/privacy-policy";
import TermsOfServicePage from "@/pages/terms-of-service";
import DashboardPage from "@/pages/dashboard";
import FunnelPage from "@/pages/funnel";
import CustomersPage from "@/pages/customers";
import CustomerDetailPage from "@/pages/customer-detail";
import ProductsPage from "@/pages/products";
import ProductDetailPage from "@/pages/product-detail";
import SellersPage from "@/pages/sellers";
import SellerDetailPage from "@/pages/seller-detail";
import GeographyPage from "@/pages/geography";
import ClientsPage from "@/pages/clients";
import NotificationsPage from "@/pages/notifications";
import ComparePage from "@/pages/compare";
import OverviewPage from "@/pages/overview";
import MarketingPage from "@/pages/marketing";
import WhatsappPage from "@/pages/whatsapp";
import WhatsappConversationsPage from "@/pages/whatsapp-conversations";
import WhatsappConnectionsPage from "@/pages/whatsapp-connections";
import WhatsappSendsPage from "@/pages/whatsapp-sends";
import StockIntelligencePage from "@/pages/stock-intelligence";
import JourneyPage from "@/pages/journey";
import RfmPage from "@/pages/rfm";
import UtmPage from "@/pages/utm";
import AccessesPage from "@/pages/accesses";
import ExtractionsPage from "@/pages/extractions";

function ApiErrorBoundary({ children }: { children: React.ReactNode }) {
  const { logout } = useAuth();

  const queryClient = useMemo(() => {
    return new QueryClient({
      queryCache: new QueryCache({
        onError: (error) => handleApiError(error, logout),
      }),
      mutationCache: new MutationCache({
        onError: (error) => handleApiError(error, logout),
      }),
    });
  }, [logout]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

function Router() {
  const [location] = useLocation();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <Switch key={location} location={location}>
        <Route path="/login">
          <LoginPage />
        </Route>

        <Route path="/privacy-policy">
          <PrivacyPolicyPage />
        </Route>

        <Route path="/terms-of-service">
          <TermsOfServicePage />
        </Route>

        <Route path="/dashboard">
          <AuthGuard>
            <AppLayout>
              <PageTransition routeKey="dashboard"><DashboardPage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/">
          <AuthGuard>
            <AppLayout>
              <PageTransition routeKey="dashboard"><DashboardPage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/funnel">
          <AuthGuard>
            <AppLayout>
              <PageTransition routeKey="funnel"><FunnelPage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/customers/:customerId">
          <AuthGuard>
            <AppLayout>
              <PageTransition routeKey="customer-detail"><CustomerDetailPage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/customers">
          <AuthGuard>
            <AppLayout>
              <PageTransition routeKey="customers"><CustomersPage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/products/:productId">
          <AuthGuard>
            <AppLayout>
              <PageTransition routeKey="product-detail"><ProductDetailPage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/products">
          <AuthGuard>
            <AppLayout>
              <PageTransition routeKey="products"><ProductsPage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/sellers/:sellerId">
          <AuthGuard>
            <AppLayout>
              <PageTransition routeKey="seller-detail"><SellerDetailPage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/sellers">
          <AuthGuard>
            <AppLayout>
              <PageTransition routeKey="sellers"><SellersPage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/geography">
          <AuthGuard>
            <AppLayout>
              <PageTransition routeKey="geography"><GeographyPage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/notifications">
          <AuthGuard>
            <AppLayout>
              <PageTransition routeKey="notifications"><NotificationsPage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/compare">
          <AuthGuard adminOnly>
            <AppLayout>
              <PageTransition routeKey="compare"><ComparePage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/overview">
          <AuthGuard adminOnly>
            <AppLayout>
              <PageTransition routeKey="overview"><OverviewPage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/clients">
          <AuthGuard adminOnly>
            <AppLayout>
              <PageTransition routeKey="clients"><ClientsPage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/accesses">
          <AuthGuard adminOnly>
            <AppLayout>
              <PageTransition routeKey="accesses"><AccessesPage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/extractions">
          <AuthGuard adminOnly>
            <AppLayout>
              <PageTransition routeKey="extractions"><ExtractionsPage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/marketing">
          <AuthGuard>
            <AppLayout>
              <PageTransition routeKey="marketing"><MarketingPage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/whatsapp/conversas">
          <AuthGuard>
            <AppLayout>
              <PageTransition routeKey="whatsapp-conversations"><WhatsappConversationsPage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/whatsapp/conexoes">
          <AuthGuard>
            <AppLayout>
              <PageTransition routeKey="whatsapp-connections"><WhatsappConnectionsPage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/whatsapp/envios">
          <AuthGuard>
            <AppLayout>
              <PageTransition routeKey="whatsapp-sends"><WhatsappSendsPage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/whatsapp">
          <AuthGuard>
            <AppLayout>
              <PageTransition routeKey="whatsapp"><WhatsappPage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/stock">
          <AuthGuard>
            <AppLayout>
              <PageTransition routeKey="stock"><StockIntelligencePage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/journey">
          <AuthGuard>
            <AppLayout>
              <PageTransition routeKey="journey"><JourneyPage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/rfm">
          <AuthGuard>
            <AppLayout>
              <PageTransition routeKey="rfm"><RfmPage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route path="/utm">
          <AuthGuard>
            <AppLayout>
              <PageTransition routeKey="utm"><UtmPage /></PageTransition>
            </AppLayout>
          </AuthGuard>
        </Route>

        <Route>
          <NotFound />
        </Route>
      </Switch>
    </AnimatePresence>
  );
}

function ShortcutsBridge({ children }: { children: React.ReactNode }) {
  const { theme, setTheme } = useTheme();
  return (
    <KeyboardShortcutsProvider
      onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
      onFocusSearch={() => {
        const focus = (window as unknown as { __focusSearch?: () => void }).__focusSearch;
        focus?.();
      }}
    >
      {children}
    </KeyboardShortcutsProvider>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="updash-theme">
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <AuthProvider>
          <ApiErrorBoundary>
            <DashboardFiltersProvider>
              <ShortcutsBridge>
                <TooltipProvider>
                  <Router />
                  <Toaster />
                </TooltipProvider>
              </ShortcutsBridge>
            </DashboardFiltersProvider>
          </ApiErrorBoundary>
        </AuthProvider>
      </WouterRouter>
    </ThemeProvider>
  );
}

export default App;
