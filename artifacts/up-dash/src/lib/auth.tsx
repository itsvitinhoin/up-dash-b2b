import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useLocation } from "wouter";
import {
  AuthUser,
  setAuthTokenGetter,
  setUnauthorizedHandler,
  logout as apiLogout,
} from "@workspace/api-client-react";

const TOKEN_KEY = "updash.token";
const REFRESH_KEY = "updash.refresh";
const USER_KEY = "updash.user";
const CLIENT_KEY = "updash.clientId";

// Bearer-token getter — reads the latest access token on every request.
setAuthTokenGetter(() => localStorage.getItem(TOKEN_KEY));

// 401 retry: refresh once with the stored refresh token, persist the rotated
// pair, and tell `customFetch` to replay the original request. On failure,
// clear local state so the route guard punts the user to /login.
//
// IMPORTANT: this handler must NOT route the refresh call back through
// `customFetch` (which is what the orval-generated `apiRefreshToken` does).
// `customFetch` already holds an in-flight promise pointing at THIS handler;
// a nested 401 from inside the refresh call would await that same promise
// and deadlock. Using raw `fetch` here breaks the cycle.
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

setUnauthorizedHandler(async () => {
  const refresh = localStorage.getItem(REFRESH_KEY);
  if (!refresh) return false;
  const rotated = await performRefresh(refresh);
  if (!rotated) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(CLIENT_KEY);
    return false;
  }
  localStorage.setItem(TOKEN_KEY, rotated.accessToken);
  localStorage.setItem(REFRESH_KEY, rotated.refreshToken);
  return true;
});

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  login: (token: string, refreshToken: string, user: AuthUser) => void;
  logout: () => void;
  isLoading: boolean;
  selectedClientId: string | null;
  setSelectedClientId: (id: string | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [, setLocation] = useLocation();
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    const storedUser = localStorage.getItem(USER_KEY);
    const storedClientId = localStorage.getItem(CLIENT_KEY);

    if (storedToken && storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        setToken(storedToken);
        setUser(parsedUser);

        if (storedClientId) {
          setSelectedClientId(storedClientId);
        } else if (parsedUser.role === 'CLIENT' && parsedUser.clientId) {
          setSelectedClientId(parsedUser.clientId);
        }
      } catch (e) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_KEY);
        localStorage.removeItem(USER_KEY);
      }
    }
    setIsLoading(false);
  }, []);

  const login = (newToken: string, newRefresh: string, newUser: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(REFRESH_KEY, newRefresh);
    localStorage.setItem(USER_KEY, JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);

    if (newUser.role === 'CLIENT' && newUser.clientId) {
      setSelectedClientId(newUser.clientId);
      localStorage.setItem(CLIENT_KEY, newUser.clientId);
    }
  };

  const logout = () => {
    const refresh = localStorage.getItem(REFRESH_KEY);
    // Best-effort server revocation; never block UI on this network call.
    if (refresh) {
      apiLogout({ refreshToken: refresh } as never).catch(() => undefined);
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(CLIENT_KEY);
    setToken(null);
    setUser(null);
    setSelectedClientId(null);
    setLocation("/login");
  };

  const handleSetSelectedClientId = (id: string | null) => {
    setSelectedClientId(id);
    if (id) {
      localStorage.setItem(CLIENT_KEY, id);
    } else {
      localStorage.removeItem(CLIENT_KEY);
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isLoading, selectedClientId, setSelectedClientId: handleSetSelectedClientId }}>
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
