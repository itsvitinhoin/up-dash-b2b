import type { QueryKey, UseQueryOptions } from "@tanstack/react-query";

export type QueryOpts<TData = unknown, TError = unknown> = Omit<
  UseQueryOptions<TData, TError, TData, QueryKey>,
  "queryKey" | "queryFn"
>;

export function queryOpts<TData = unknown, TError = unknown>(
  opts: QueryOpts<TData, TError>,
): UseQueryOptions<TData, TError, TData, QueryKey> {
  return opts as UseQueryOptions<TData, TError, TData, QueryKey>;
}
