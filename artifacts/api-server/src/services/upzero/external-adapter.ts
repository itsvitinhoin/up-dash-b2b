const DEFAULT_UPZERO_BASE_URL = "https://api.upzero.com.br";

type JsonRecord = Record<string, unknown>;

export type UpzeroAdapterConfig = {
  apiKey?: string | null;
  baseUrl?: string | null;
};

export type UpzeroListParams = {
  page?: number;
  limit?: number;
  search?: string;
  from?: string;
  to?: string;
  status?: string;
  customerId?: string | number;
  productId?: string | number;
};

export type UpzeroFallbackResult = {
  ok: false;
  fallback: true;
  reason: string;
  todo: string;
};

function normalizeApiKey(apiKey?: string | null): string {
  const value = apiKey?.trim().replace(/^Bearer\s+/i, "");
  if (!value) {
    throw new Error("UP Zero API key não configurada para este cliente.");
  }
  return value;
}

function buildUrl(baseUrl: string, path: string, params?: UpzeroListParams): string {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (!params) return url.toString();
  if (typeof params.page === "number") url.searchParams.set("page", String(params.page));
  if (typeof params.limit === "number") url.searchParams.set("limit", String(params.limit));
  if (params.search) url.searchParams.set("search", params.search);
  if (params.from) url.searchParams.set("from", params.from);
  if (params.to) url.searchParams.set("to", params.to);
  if (params.status) url.searchParams.set("status", params.status);
  if (params.customerId !== undefined) url.searchParams.set("customer_id", String(params.customerId));
  if (params.productId !== undefined) url.searchParams.set("product_id", String(params.productId));
  return url.toString();
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : null;
}

async function parseJsonResponse(response: Response, label: string): Promise<unknown> {
  const text = await response.text();
  let payload: unknown = null;
  if (text.trim().length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Resposta inválida da UP Zero em ${label}: ${text}`);
    }
  }
  if (!response.ok) {
    throw new Error(`Erro UP Zero ${label} ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

export class UpzeroExternalAdapter {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: UpzeroAdapterConfig) {
    this.apiKey = normalizeApiKey(config.apiKey);
    this.baseUrl = config.baseUrl?.trim() || process.env.UPZERO_BASE_URL || DEFAULT_UPZERO_BASE_URL;
  }

  private async request<T = unknown>(path: string, options: RequestInit = {}, params?: UpzeroListParams): Promise<T> {
    const response = await fetch(buildUrl(this.baseUrl, path, params), {
      ...options,
      headers: {
        "X-API-Key": this.apiKey,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    return parseJsonResponse(response, path) as Promise<T>;
  }

  listCustomers(params?: UpzeroListParams) {
    return this.request("/external/v1/customers", undefined, params);
  }

  getCustomer(customerId: string | number) {
    return this.request(`/external/v1/customers/${customerId}`);
  }

  createCustomer(payload: JsonRecord) {
    return this.request("/external/v1/customers", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  updateCustomer(customerId: string | number, payload: JsonRecord) {
    return this.request(`/external/v1/customers/${customerId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  listProducts(params?: UpzeroListParams) {
    return this.request("/external/v1/products", undefined, params);
  }

  getProduct(productId: string | number) {
    return this.request(`/external/v1/products/${productId}`);
  }

  getProductByCode(code: string) {
    return this.request(`/external/v1/products/by-code/${encodeURIComponent(code)}`);
  }

  listProductImages(productId: string | number) {
    return this.request(`/external/v1/products/${productId}/images`);
  }

  listCategories(params?: UpzeroListParams) {
    return this.request("/external/v1/categories", undefined, params);
  }

  getCategory(categoryId: string | number) {
    return this.request(`/external/v1/categories/${categoryId}`);
  }

  listInventoryAvailability(params?: UpzeroListParams) {
    return this.request("/external/v1/inventory/availability", undefined, params);
  }

  listOrders(params?: UpzeroListParams) {
    return this.request("/external/v1/orders", undefined, params);
  }

  getOrder(orderId: string | number) {
    return this.request(`/external/v1/orders/${orderId}`);
  }

  createOrder(payload: JsonRecord) {
    return this.request("/external/v1/orders", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  updateOrderStatus(orderId: string | number, payload: JsonRecord) {
    return this.request(`/external/v1/orders/${orderId}/status`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  listWebhooks() {
    return this.request("/external/v1/webhooks");
  }

  createWebhook(payload: JsonRecord) {
    return this.request("/external/v1/webhooks", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async createCart(): Promise<UpzeroFallbackResult> {
    return {
      ok: false,
      fallback: true,
      reason: "A documentação pública atual da UP Zero não expõe endpoint de carrinho.",
      todo: "Mapear endpoint de cart/checkout quando a UP Zero publicar a rota oficial.",
    };
  }

  async createCheckout(): Promise<UpzeroFallbackResult> {
    return {
      ok: false,
      fallback: true,
      reason: "A documentação pública atual da UP Zero não expõe endpoint de checkout.",
      todo: "Mapear endpoint de checkout/link de pagamento quando a UP Zero publicar a rota oficial.",
    };
  }
}

export function extractRows(payload: unknown): unknown[] {
  const record = asRecord(payload);
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(record?.data)) return record.data;
  if (Array.isArray(record?.items)) return record.items;
  if (Array.isArray(record?.results)) return record.results;
  return [];
}
