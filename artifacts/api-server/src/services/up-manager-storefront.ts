import { z } from "zod";

export const AIYU_STORE_ID = "7229794";
export const AIYU_SHIPPING_VARIANT = 1618201420;
export const shippingRoutes = [
  { label: "São Paulo", zip: "01001-000" },
  { label: "Rio de Janeiro", zip: "20040-020" },
  { label: "Belo Horizonte", zip: "30130-010" },
] as const;

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatFreight = (cents: number) => currency.format(cents / 100);
const money = z.string().regex(/^\d+\.\d{2}$/).transform((price) => Math.round(Number(price) * 100));
const days = z.number().int().nonnegative();
const optionSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  detail: z.string().nullable().optional(),
  price: money,
  days_until: z.object({ working_start: days, working_end: days }).nullable().optional(),
});

export type ShippingOption = {
  code: string;
  name: string;
  priceCents: number;
  minDays: number | null;
  maxDays: number | null;
};
export type ShippingSnapshot = {
  storeId: string;
  variantId: number;
  quantity: 1;
  observedAt: string;
  routes: { label: string; zip: string; options: ShippingOption[] | null }[];
};

export class StorefrontError extends Error {
  constructor(readonly status: number) {
    super(`Storefront Nuvemshop HTTP ${status}`);
  }
}

export async function storefrontRequest(
  storeId: string,
  path: string,
  body?: Record<string, unknown>,
) {
  if (!/^\d+$/.test(storeId) || !path.startsWith("/")) throw new Error("Loja inválida.");
  const response = await fetch(
    `https://storefront-api.tiendanube.com/2026-11/stores/${storeId}${path}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok) throw new StorefrontError(response.status);
  return response.json();
}

export async function readShippingSnapshot(storeId: string, variantId: number): Promise<ShippingSnapshot> {
  const routes = await Promise.all(shippingRoutes.map(async ({ label, zip }) => {
    try {
      const raw = z.object({ shipping_options: z.array(optionSchema) }).parse(
        await storefrontRequest(storeId, "/shipping-options", { zip_code: zip, quantity: 1, variant_id: variantId }),
      );
      const options = raw.shipping_options.map(({ code, name, detail, price, days_until }) => ({
        code,
        name: detail && !name.includes(detail) ? `${name} · ${detail}` : name,
        priceCents: price,
        minDays: days_until?.working_start ?? null,
        maxDays: days_until?.working_end ?? null,
      })).sort((a, b) => a.priceCents - b.priceCents || a.code.localeCompare(b.code));
      return { label, zip, options };
    } catch {
      return { label, zip, options: null };
    }
  }));
  return { storeId, variantId, quantity: 1, observedAt: new Date().toISOString(), routes };
}

export const cartSchema = z.object({
  cart: z.object({
    id: z.string().regex(/^cart_[A-Za-z0-9_.-]+$/),
    currency: z.literal("BRL"),
    line_items: z.array(z.object({ variant_id: z.number(), product_id: z.number(), quantity: z.number() })),
    cost: z.object({ subtotal: money }),
  }),
});
