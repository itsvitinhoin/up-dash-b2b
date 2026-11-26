import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";

export function useUpManagerBrands() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["up-manager", "brands", user?.id],
    queryFn: () => customFetch<{ id: string; name: string; commercePlatform: "NUVEMSHOP" | "BRAAVO" }[]>("/api/up-manager/brands"),
    enabled: Boolean(user),
    staleTime: 60_000,
  });
}
