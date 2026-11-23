export type BlingChannel = { id: string; name: string; type: string };
export type BlingStatus = {
  selected: boolean;
  appClientId: string | null;
  credentialsSource: "server" | "client";
  redirectUri: string;
  appConfigured: boolean;
  connected: boolean;
  companyName: string | null;
  companyId: string | null;
  historyDays: number;
  nuvemshopChannelId: string | null;
  completedAt: string | null;
  cursor: { phase: string; page: number; pendingItems?: number } | null;
  error: string | null;
  busy: boolean;
  retryAt: string | null;
  channels: BlingChannel[];
};
export type BlingOrder = {
  id: string;
  number: string;
  storeNumber: string;
  day: string;
  channelId: string;
  channelName: string;
  customerName: string;
  statusId: string;
  statusValue: string;
  total: number;
  invoiceId: string;
  reconciliation: "matched" | "unmatched" | "ambiguous" | "other_channel";
  items: Array<{
    id: string;
    name: string;
    sku: string;
    quantity: number;
    unitPrice: number;
  }>;
};
export type BlingCustomer = {
  id: string;
  name: string;
  orders: number;
  value: number;
  last_day: string;
};
export type BlingProduct = {
  id: string;
  name: string;
  sku: string;
  price: number;
  status: string;
  parentId: string | null;
  stock: {
    physical: number;
    available: number;
    warehouses: Array<{ id: string; physical: number; available: number }>;
  } | null;
};
export type BlingDashboard = {
  status: BlingStatus;
  summary: {
    orders: number;
    orderValue: number;
    customers: number;
    matched: number;
    unmatched: number;
    ambiguous: number;
    channels: Array<{
      id: string;
      name: string;
      orders: number;
      value: number;
    }>;
  };
  rows: Array<BlingOrder | BlingCustomer | BlingProduct>;
  total: number;
  page: number;
  channels: BlingChannel[];
};

/** Retry only an explicitly resumable short cooldown. Daily quotas never loop. */
export function blingRetryDelay(
  data: unknown,
  now = Date.now(),
): number | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Record<string, unknown>;
  if (
    value.code !== "BLING_RATE_LIMIT" ||
    value.rateLimitPeriod === "day" ||
    typeof value.retryAt !== "string"
  )
    return null;
  const delay = Date.parse(value.retryAt) - now;
  return Number.isFinite(delay) && delay >= -1000 && delay <= 60000
    ? Math.max(1000, delay)
    : null;
}

/** Limit repeated failures, while allowing a large import to keep making progress. */
export class BlingRetryBudget {
  private checkpoint: string;
  private pauses = 0;
  constructor(cursor: BlingStatus["cursor"]) {
    this.checkpoint = JSON.stringify(cursor);
  }
  batchSucceeded() {
    this.pauses = 0;
  }
  canResume(cursor: BlingStatus["cursor"]) {
    const checkpoint = JSON.stringify(cursor);
    this.pauses = checkpoint === this.checkpoint ? this.pauses + 1 : 0;
    this.checkpoint = checkpoint;
    return this.pauses <= 3;
  }
}
