import { createContext } from "react";
import type { AuthUser } from "@workspace/api-client-react";

export type DashboardMode = "B2B" | "B2C";

export interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  login: (token: string, refreshToken: string, user: AuthUser) => void;
  logout: () => void;
  isLoading: boolean;
  selectedClientId: string | null;
  setSelectedClientId: (id: string | null) => void;
  selectedDashboardMode: DashboardMode;
  setSelectedDashboardMode: (mode: DashboardMode) => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
