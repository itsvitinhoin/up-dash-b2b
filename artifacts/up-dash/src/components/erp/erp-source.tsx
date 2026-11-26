import { createContext, useContext } from "react";
import { customFetch } from "@workspace/api-client-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useDashboardFilters } from "@/lib/dashboard-filters";

export const ErpSourceContext = createContext({ isBling: false });
export const useErpSource = () => useContext(ErpSourceContext);

/** Preserve the B2B page contract and use the authenticated, isolated Bling reader. */
export function blingLayoutUrl(url: string, from: string, to: string) {
  const [path, query] = url.split("?");
  const input = new URLSearchParams(query),
    output = new URLSearchParams();
  const layout = path.split("/").pop() ?? "dashboard";
  output.set("layout", layout);
  output.set("from", input.get("dateFrom") ?? from);
  output.set("to", input.get("dateTo") ?? to);
  for (const [key, target] of Object.entries({
    clientId: "clientId",
    search: "search",
    page: "page",
    limit: "limit",
    status: "statusId",
    customerDocument: "customerId",
    category: "category",
    stockStatus: "stockStatus",
    sort: "layoutSort",
    buyerType: "layoutBuyerType",
  })) {
    const value = input.get(key);
    if (value)
      output.set(target, key === "status" ? value.replace(/^ID /, "") : value);
  }
  // Existing export controls ask for 5,000. Export the full bounded Bling result,
  // and explicitly refuse truncation instead of silently exporting one page.
  if (Number(output.get("limit")) >= 5000) output.set("limit", "10000");
  return `/api/analytics/erp/bling?${output}`;
}
export function useErpFetch() {
  const { isBling } = useErpSource();
  const { dateRange } = useDashboardFilters();
  return async <T,>(url: string): Promise<T> => {
    try {
      const result = await customFetch<T>(
        isBling
          ? blingLayoutUrl(
              url,
              format(dateRange.from, "yyyy-MM-dd"),
              format(dateRange.to, "yyyy-MM-dd"),
            )
          : url,
      );
      if (
        isBling &&
        Number(new URLSearchParams(url.split("?")[1]).get("limit")) >= 5000
      ) {
        const payload = result as {
          total?: number;
          filteredTotal?: number;
          rows?: unknown[];
        };
        if (
          (payload.filteredTotal ?? payload.total ?? 0) >
          (payload.rows?.length ?? 0)
        )
          throw new Error(
            "A exportação aceita até 10.000 registros. Refine os filtros para exportar todos os resultados.",
          );
      }
      return result;
    } catch (error) {
      if (isBling)
        toast.error(
          error instanceof Error
            ? error.message
            : "Não foi possível consultar o ERP Bling.",
        );
      throw error;
    }
  };
}
