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
  cursor: { phase: string; page: number } | null;
  error: string | null;
  busy: boolean;
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
