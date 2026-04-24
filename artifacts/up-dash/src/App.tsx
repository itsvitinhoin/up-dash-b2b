import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/components/theme-provider";
import { AppLayout } from "@/components/app-layout";
import { AuthGuard } from "@/components/auth-guard";
import { handleApiError } from "@/lib/api-error";
import { DashboardFiltersProvider } from "@/lib/dashboard-filters";
import { useMemo, useEffect, useState } from "react";

import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import FunnelPage from "@/pages/funnel";
import CustomersPage from "@/pages/customers";
import ProductsPage from "@/pages/products";
import SellersPage from "@/pages/sellers";
import GeographyPage from "@/pages/geography";
import ClientsPage from "@/pages/clients";

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
  return (
    <Switch>
      <Route path="/login">
        <LoginPage />
      </Route>
      
      <Route path="/dashboard">
        <AuthGuard>
          <AppLayout>
            <DashboardPage />
          </AppLayout>
        </AuthGuard>
      </Route>

      <Route path="/">
        <AuthGuard>
          <AppLayout>
            <DashboardPage />
          </AppLayout>
        </AuthGuard>
      </Route>

      <Route path="/funnel">
        <AuthGuard>
          <AppLayout>
            <FunnelPage />
          </AppLayout>
        </AuthGuard>
      </Route>

      <Route path="/customers">
        <AuthGuard>
          <AppLayout>
            <CustomersPage />
          </AppLayout>
        </AuthGuard>
      </Route>

      <Route path="/products">
        <AuthGuard>
          <AppLayout>
            <ProductsPage />
          </AppLayout>
        </AuthGuard>
      </Route>

      <Route path="/sellers">
        <AuthGuard>
          <AppLayout>
            <SellersPage />
          </AppLayout>
        </AuthGuard>
      </Route>

      <Route path="/geography">
        <AuthGuard>
          <AppLayout>
            <GeographyPage />
          </AppLayout>
        </AuthGuard>
      </Route>

      <Route path="/clients">
        <AuthGuard adminOnly>
          <AppLayout>
            <ClientsPage />
          </AppLayout>
        </AuthGuard>
      </Route>

      <Route>
        <NotFound />
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="updash-theme">
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <AuthProvider>
          <ApiErrorBoundary>
            <DashboardFiltersProvider>
              <TooltipProvider>
                <Router />
                <Toaster />
              </TooltipProvider>
            </DashboardFiltersProvider>
          </ApiErrorBoundary>
        </AuthProvider>
      </WouterRouter>
    </ThemeProvider>
  );
}

export default App;
