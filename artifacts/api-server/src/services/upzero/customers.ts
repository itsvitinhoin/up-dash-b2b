import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { customersTable, db } from "@workspace/db";

const UPZERO_BASE_URL = process.env.UPZERO_BASE_URL ?? "https://api.upzero.com.br";

type UpzeroCustomerProfile = {
  cpf?: string | null;
  cnpj?: string | null;
  state?: string | null;
  city?: string | null;
  address_state?: string | null;
  address_city?: string | null;
};

export type UpzeroCustomerDetail = {
  id: string | number;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  customer_type?: string | null;
  approved?: boolean | string | number | null;
  is_approved?: boolean | string | number | null;
  rejected?: boolean | string | number | null;
  is_rejected?: boolean | string | number | null;
  status?: string | null;
  registration_status?: string | null;
  approval_status?: string | null;
  lead_status?: string | null;
  created_at?: string | null;
  registered_at?: string | null;
  registration_date?: string | null;
  lead_created_at?: string | null;
  approved_at?: string | null;
  approval_date?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  utm?: {
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    content?: string | null;
    term?: string | null;
  } | null;
  retail_profile?: UpzeroCustomerProfile | null;
  wholesale_profile?: UpzeroCustomerProfile | null;
};

export type HydratedUpzeroCustomer = {
  id: string;
  externalId: string | null;
  email: string;
  name: string | null;
  phone: string | null;
  documentType: "CPF" | "CNPJ" | null;
  documentHash: string | null;
  documentLast4: string | null;
  state: string | null;
  city: string | null;
  registrationStatus: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: Date;
  totalOrders: number;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
};

export function normalizeDocument(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length > 0 ? digits : null;
}

export function hashDocument(value: string | null | undefined): string | null {
  const normalized = normalizeDocument(value);
  if (!normalized) return null;
  return createHash("sha256").update(normalized).digest("hex");
}

export function documentLast4(value: string | null | undefined): string | null {
  const normalized = normalizeDocument(value);
  return normalized ? normalized.slice(-4) : null;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const parsed = cleanString(value);
    if (parsed) return parsed;
  }
  return null;
}

function boolLike(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  const s = cleanString(value)?.toLowerCase();
  if (!s) return null;
  if (["true", "1", "yes", "sim", "approved", "aprovado"].includes(s)) return true;
  if (["false", "0", "no", "nao", "não", "rejected", "recusado"].includes(s)) return false;
  return null;
}

function firstDate(...values: unknown[]): Date | null {
  for (const value of values) {
    const s = cleanString(value);
    if (!s) continue;
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function mapRegistrationStatus(c: UpzeroCustomerDetail): "PENDING" | "APPROVED" | "REJECTED" | null {
  if (boolLike(c.rejected) === true || boolLike(c.is_rejected) === true) return "REJECTED";
  if (boolLike(c.approved) === true || boolLike(c.is_approved) === true) return "APPROVED";
  const raw = firstString(c.registration_status, c.approval_status, c.lead_status, c.status)?.toLowerCase();
  if (!raw) return null;
  if (["approved", "aprovado", "accepted", "active", "qualified"].some((v) => raw.includes(v))) return "APPROVED";
  if (["rejected", "recusado", "declined", "denied", "canceled", "cancelado"].some((v) => raw.includes(v))) return "REJECTED";
  return "PENDING";
}

function customerDocument(c: UpzeroCustomerDetail): {
  type: "CPF" | "CNPJ" | null;
  value: string | null;
} {
  const cnpj = firstString(c.wholesale_profile?.cnpj, (c as { cnpj?: string | null }).cnpj);
  if (cnpj || c.customer_type?.toUpperCase() === "WHOLESALE") return { type: "CNPJ", value: cnpj };
  const cpf = firstString(c.retail_profile?.cpf, (c as { cpf?: string | null }).cpf);
  if (cpf || c.customer_type?.toUpperCase() === "RETAIL") return { type: "CPF", value: cpf };
  return { type: null, value: null };
}

function customerState(c: UpzeroCustomerDetail): string | null {
  return firstString(
    c.wholesale_profile?.state,
    c.wholesale_profile?.address_state,
    c.retail_profile?.state,
    c.retail_profile?.address_state,
  );
}

function customerCity(c: UpzeroCustomerDetail): string | null {
  return firstString(
    c.wholesale_profile?.city,
    c.wholesale_profile?.address_city,
    c.retail_profile?.city,
    c.retail_profile?.address_city,
  );
}

function customerUtm(c: UpzeroCustomerDetail): {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
} {
  return {
    utmSource: firstString(c.utm_source, c.utm?.source),
    utmMedium: firstString(c.utm_medium, c.utm?.medium),
    utmCampaign: firstString(c.utm_campaign, c.utm?.campaign),
    utmContent: firstString(c.utm_content, c.utm?.content),
    utmTerm: firstString(c.utm_term, c.utm?.term),
  };
}

function parseCustomerPayload(payload: unknown): UpzeroCustomerDetail | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const candidate = typeof record.data === "object" && record.data !== null
    ? record.data
    : payload;
  if (typeof candidate !== "object" || candidate === null) return null;
  const customer = candidate as UpzeroCustomerDetail;
  return customer.id !== undefined && customer.id !== null ? customer : null;
}

export async function fetchUpzeroCustomerById(
  apiKey: string,
  id: number,
): Promise<UpzeroCustomerDetail | null> {
  const response = await fetch(`${UPZERO_BASE_URL}/external/v1/customers/${id}`, {
    headers: {
      "X-API-Key": apiKey.trim().replace(/^Bearer\s+/i, ""),
      Accept: "application/json",
    },
  });
  if (response.status === 404) return null;
  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Resposta inválida da UP Zero customer ${id}: ${text}`);
  }
  if (!response.ok) {
    throw new Error(`UP Zero customer ${id} failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  return parseCustomerPayload(payload);
}

async function upsertUpzeroCustomer(
  clientId: string,
  detail: UpzeroCustomerDetail,
): Promise<HydratedUpzeroCustomer | null> {
  const externalId = String(detail.id);
  const email = detail.email ?? `upzero-${externalId}@noemail.internal`;
  const registrationStatus = mapRegistrationStatus(detail) ?? "PENDING";
  const createdAt =
    firstDate(detail.lead_created_at, detail.registered_at, detail.registration_date, detail.created_at) ??
    new Date();
  const approvalDate =
    firstDate(detail.approved_at, detail.approval_date) ??
    (registrationStatus === "APPROVED" ? createdAt : null);
  const document = customerDocument(detail);
  const documentHash = hashDocument(document.value);
  const documentLast4Value = documentLast4(document.value);
  const utm = customerUtm(detail);

  const [row] = await db
    .insert(customersTable)
    .values({
      clientId,
      externalId,
      email,
      name: firstString(detail.name),
      phone: firstString(detail.phone),
      documentType: document.type,
      documentHash,
      documentLast4: documentLast4Value,
      state: customerState(detail),
      city: customerCity(detail),
      ...utm,
      registrationStatus,
      approvalDate,
      createdAt,
    })
    .onConflictDoUpdate({
      target: [customersTable.clientId, customersTable.externalId],
      set: {
        email,
        name: firstString(detail.name),
        phone: firstString(detail.phone),
        documentType: document.type,
        documentHash: documentHash ? documentHash : sql`${customersTable.documentHash}`,
        documentLast4: documentLast4Value ? documentLast4Value : sql`${customersTable.documentLast4}`,
        state: customerState(detail),
        city: customerCity(detail),
        ...utm,
        registrationStatus,
        approvalDate,
        createdAt: sql`LEAST(${customersTable.createdAt}, EXCLUDED.created_at)`,
      },
    })
    .returning({
      id: customersTable.id,
      externalId: customersTable.externalId,
      email: customersTable.email,
      name: customersTable.name,
      phone: customersTable.phone,
      documentType: customersTable.documentType,
      documentHash: customersTable.documentHash,
      documentLast4: customersTable.documentLast4,
      state: customersTable.state,
      city: customersTable.city,
      registrationStatus: customersTable.registrationStatus,
      createdAt: customersTable.createdAt,
      totalOrders: customersTable.totalOrders,
      utmSource: customersTable.utmSource,
      utmMedium: customersTable.utmMedium,
      utmCampaign: customersTable.utmCampaign,
      utmContent: customersTable.utmContent,
      utmTerm: customersTable.utmTerm,
    });

  return row ?? null;
}

export async function ensureUpzeroCustomersByIds(params: {
  clientId: string;
  apiKey?: string | null;
  userIds: number[];
}): Promise<HydratedUpzeroCustomer[]> {
  const apiKey = params.apiKey?.trim().replace(/^Bearer\s+/i, "");
  if (!apiKey) return [];

  const ids = Array.from(new Set(params.userIds.filter((id) => Number.isFinite(id) && id > 0)));
  if (ids.length === 0) return [];

  const existing = await db
    .select({ externalId: customersTable.externalId })
    .from(customersTable)
    .where(
      and(
        eq(customersTable.clientId, params.clientId),
        inArray(customersTable.externalId, ids.map(String)),
      ),
    );
  const existingIds = new Set(existing.map((row) => row.externalId).filter(Boolean));
  const missingIds = ids.filter((id) => !existingIds.has(String(id)));
  if (missingIds.length === 0) return [];

  const hydrated: HydratedUpzeroCustomer[] = [];
  for (const id of missingIds) {
    try {
      const detail = await fetchUpzeroCustomerById(apiKey, id);
      if (!detail) continue;
      const row = await upsertUpzeroCustomer(params.clientId, detail);
      if (row) hydrated.push(row);
    } catch (err) {
      console.warn(`[upzero-customers] hydrate customer ${id} failed:`, err instanceof Error ? err.message : err);
    }
  }

  if (hydrated.length > 0) {
    console.log({
      upzeroHydratedMissingCustomers: hydrated.length,
      upzeroHydratedCustomerIds: hydrated.map((row) => row.externalId).slice(0, 20),
    });
  }

  return hydrated;
}
