import { ApiError } from "@workspace/api-client-react";

export function handleApiError(error: unknown, logout: () => void) {
  if (error instanceof ApiError && error.status === 401) {
    logout();
  }
}
