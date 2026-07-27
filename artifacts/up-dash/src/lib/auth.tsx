import { useContext, useEffect, useState, ReactNode } from "react";
import { useLocation } from "wouter";
import {
  AuthUser,
  setAuthTokenGetter,
  setUnauthorizedHandler,
  logout as apiLogout,
} from "@workspace/api-client-react";
import { AuthContext, type AuthContextType, type DashboardMode } from "./auth-context";
import { mergeDashboardUrlContext, parseDashboardUrlContext } from "./dashboard-context-url";

export type { AuthContextType, DashboardMode };

const TOKEN_KEY = "updash.token";
const REFRESH_KEY = "updash.refresh";
const USER_KEY = "updash.user";
const CLIENT_KEY = "updash.clientId";
const DASHBOARD_MODE_KEY = "updash.dashboardMode";
const LOCAL_UI_PREVIEW =
  import.meta.env.DEV && import.meta.env.VITE_UI_PREVIEW === "1";

async function performRefresh(refresh: string): Promise<{
  accessToken: string;
  refreshToken: string;
} | null> {
  try {
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { accessToken?: string; refreshToken?: string };
    if (typeof data.accessToken !== "string" || typeof data.refreshToken !== "string") {
      return null;
    }
    return { accessToken: data.accessToken, refreshToken: data.refreshToken };
  } catch {
    return null;
  }
}

// One-time initialisation of the API client interceptors.
// Using a module-scoped flag avoids repeated calls on HMR re-renders while
// keeping all side-effects inside the component file (no module-top-level
// calls, which break Vite Fast Refresh).
let _apiClientReady = false;
function initApiClient() {
  if (_apiClientReady) return;
  _apiClientReady = true;
  setAuthTokenGetter(() => localStorage.getItem(TOKEN_KEY));
  setUnauthorizedHandler(async () => {
    const refresh = localStorage.getItem(REFRESH_KEY);
    if (!refresh) return false;
    const rotated = await performRefresh(refresh);
    if (!rotated) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(CLIENT_KEY);
      localStorage.removeItem(DASHBOARD_MODE_KEY);
      return false;
    }
    localStorage.setItem(TOKEN_KEY, rotated.accessToken);
    localStorage.setItem(REFRESH_KEY, rotated.refreshToken);
    return true;
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  initApiClient();

  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [, setLocation] = useLocation();
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedDashboardMode, setSelectedDashboardModeState] = useState<DashboardMode>("B2B");

  useEffect(() => {
    if (LOCAL_UI_PREVIEW) {
      setToken("local-ui-preview");
      setUser({
        id: "local-preview-admin",
        email: "admin@updash.com",
        firstName: "Grupo",
        lastName: "UP",
        role: "ADMIN",
        clientId: null,
      });
      setSelectedClientId("preview-celeb");
      setSelectedDashboardModeState("B2B");
      setIsLoading(false);
      return;
    }

    const storedToken = localStorage.getItem(TOKEN_KEY);
    const storedUser = localStorage.getItem(USER_KEY);
    const storedClientId = localStorage.getItem(CLIENT_KEY);
    const storedDashboardMode = localStorage.getItem(DASHBOARD_MODE_KEY);
    const urlContext = parseDashboardUrlContext(window.location.search);

    if (storedToken && storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        setToken(storedToken);
        setUser(parsedUser);
        const initialMode = urlContext.dashboardMode ?? storedDashboardMode;
        if (initialMode === "B2B" || initialMode === "B2C") {
          setSelectedDashboardModeState(initialMode);
          localStorage.setItem(DASHBOARD_MODE_KEY, initialMode);
        }

        if (parsedUser.role === 'CLIENT' && parsedUser.clientId) {
          setSelectedClientId(parsedUser.clientId);
          localStorage.setItem(CLIENT_KEY, parsedUser.clientId);
        } else if (urlContext.clientId ?? storedClientId) {
          const initialClientId = urlContext.clientId ?? storedClientId;
          setSelectedClientId(initialClientId);
          if (initialClientId) localStorage.setItem(CLIENT_KEY, initialClientId);
        }
      } catch (e) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_KEY);
        localStorage.removeItem(USER_KEY);
      }
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const syncFromUrl = () => {
      const context = parseDashboardUrlContext(window.location.search);
      if (context.dashboardMode) {
        setSelectedDashboardModeState(context.dashboardMode);
        localStorage.setItem(DASHBOARD_MODE_KEY, context.dashboardMode);
      }
      if (user?.role === "CLIENT" && user.clientId) {
        setSelectedClientId(user.clientId);
        return;
      }
      setSelectedClientId(context.clientId);
      if (context.clientId) localStorage.setItem(CLIENT_KEY, context.clientId);
      else localStorage.removeItem(CLIENT_KEY);
    };
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [user]);

  const login = (newToken: string, newRefresh: string, newUser: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(REFRESH_KEY, newRefresh);
    localStorage.setItem(USER_KEY, JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);

    if (newUser.role === 'CLIENT' && newUser.clientId) {
      setSelectedClientId(newUser.clientId);
      localStorage.setItem(CLIENT_KEY, newUser.clientId);
    } else {
      setSelectedClientId(null);
      localStorage.removeItem(CLIENT_KEY);
      setSelectedDashboardModeState("B2B");
      localStorage.setItem(DASHBOARD_MODE_KEY, "B2B");
    }
  };

  const logout = () => {
    const refresh = localStorage.getItem(REFRESH_KEY);
    if (refresh) {
      apiLogout({ refreshToken: refresh }).catch(() => undefined);
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(CLIENT_KEY);
    localStorage.removeItem(DASHBOARD_MODE_KEY);
    setToken(null);
    setUser(null);
    setSelectedClientId(null);
    setSelectedDashboardModeState("B2B");
    setLocation("/login");
  };

  const handleSetSelectedClientId = (id: string | null) => {
    setSelectedClientId(id);
    if (id) {
      localStorage.setItem(CLIENT_KEY, id);
    } else {
      localStorage.removeItem(CLIENT_KEY);
    }
    const params = mergeDashboardUrlContext(window.location.search, { clientId: id });
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  };

  const handleSetSelectedDashboardMode = (mode: DashboardMode) => {
    setSelectedDashboardModeState(mode);
    setSelectedClientId(null);
    localStorage.setItem(DASHBOARD_MODE_KEY, mode);
    localStorage.removeItem(CLIENT_KEY);
    const params = mergeDashboardUrlContext(window.location.search, {
      dashboardMode: mode,
      clientId: null,
    });
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        logout,
        isLoading,
        selectedClientId,
        setSelectedClientId: handleSetSelectedClientId,
        selectedDashboardMode,
        setSelectedDashboardMode: handleSetSelectedDashboardMode,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
