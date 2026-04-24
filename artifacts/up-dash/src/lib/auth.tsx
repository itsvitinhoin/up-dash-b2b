import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useLocation } from "wouter";
import { AuthUser, setAuthTokenGetter } from "@workspace/api-client-react";

// Generated client URLs already include the "/api" prefix (set via orval baseUrl).
// We only need to register a token getter — same-origin requests in the browser.
setAuthTokenGetter(() => {
  return localStorage.getItem("updash.token");
});

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  login: (token: string, user: AuthUser) => void;
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
    const storedToken = localStorage.getItem("updash.token");
    const storedUser = localStorage.getItem("updash.user");
    const storedClientId = localStorage.getItem("updash.clientId");

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
        localStorage.removeItem("updash.token");
        localStorage.removeItem("updash.user");
      }
    }
    setIsLoading(false);
  }, []);

  const login = (newToken: string, newUser: AuthUser) => {
    localStorage.setItem("updash.token", newToken);
    localStorage.setItem("updash.user", JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
    
    if (newUser.role === 'CLIENT' && newUser.clientId) {
      setSelectedClientId(newUser.clientId);
      localStorage.setItem("updash.clientId", newUser.clientId);
    }
  };

  const logout = () => {
    localStorage.removeItem("updash.token");
    localStorage.removeItem("updash.user");
    localStorage.removeItem("updash.clientId");
    setToken(null);
    setUser(null);
    setSelectedClientId(null);
    setLocation("/login");
  };

  const handleSetSelectedClientId = (id: string | null) => {
    setSelectedClientId(id);
    if (id) {
      localStorage.setItem("updash.clientId", id);
    } else {
      localStorage.removeItem("updash.clientId");
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
