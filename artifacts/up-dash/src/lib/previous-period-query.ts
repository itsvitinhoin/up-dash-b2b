import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { precedingPeriod } from "@/lib/metric-comparison";

export function periodQuery(path: string, params: Record<string, string | number | boolean | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined) query.set(key, String(value)); });
  return `${path}?${query}`;
}

/** One cached read per endpoint/filter set; card components never issue requests. */
export function usePreviousPeriodQuery<T>(url: string, enabled = true) {
  const [path, query] = url.split("?");
  const params = new URLSearchParams(query);
  const from = params.get("dateFrom"), to = params.get("dateTo");
  if (from && to) {
    const previous = precedingPeriod(from, to);
    params.set("dateFrom", previous.dateFrom);
    params.set("dateTo", previous.dateTo);
  }
  const previousUrl = `${path}?${params}`;
  return useQuery<T>({ queryKey: ["metric-previous-period", previousUrl], queryFn: ({ signal }) => customFetch<T>(previousUrl, { signal }), enabled: enabled && Boolean(from && to), staleTime: 120_000, refetchOnWindowFocus: false, retry: 1 });
}
