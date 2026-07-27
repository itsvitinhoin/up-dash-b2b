import type { QueryKey, UseQueryOptions } from "@tanstack/react-query";

export type QueryOpts<TData = unknown, TError = unknown> = Omit<
  UseQueryOptions<TData, TError, TData, QueryKey>,
  "queryKey" | "queryFn"
>;

export function queryOpts<TData = unknown, TError = unknown>(
  opts: QueryOpts<TData, TError>,
): UseQueryOptions<TData, TError, TData, QueryKey> {
  return {
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
    ...opts,
  } as UseQueryOptions<TData, TError, TData, QueryKey>;
}
