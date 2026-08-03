import type { QueryKey, UseQueryOptions } from "@tanstack/react-query";

export type QueryOpts<TData = unknown, TError = unknown> = Omit<
  UseQueryOptions<TData, TError, TData, QueryKey>,
  "queryKey" | "queryFn"
>;

function getHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

export function retryTransientQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 3) return false;

  const status = getHttpStatus(error);
  if (status === null) return true;

  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function transientQueryRetryDelay(attemptIndex: number): number {
  return Math.min(5_000, 500 * 2 ** attemptIndex);
}

export function queryOpts<TData = unknown, TError = unknown>(
  opts: QueryOpts<TData, TError>,
): UseQueryOptions<TData, TError, TData, QueryKey> {
  return {
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: retryTransientQuery,
    retryDelay: transientQueryRetryDelay,
    ...opts,
  } as UseQueryOptions<TData, TError, TData, QueryKey>;
}
