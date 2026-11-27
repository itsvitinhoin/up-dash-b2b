import { randomUUID } from "node:crypto";
import { db, upManagerArchiveTable as archive } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { fetchManagerCatalogProduct } from "./product-campaign-sources";
import {
  testStorefrontCheckout,
  type CheckoutTestResult,
} from "./up-manager-checkout-browser";
import type { ManagerClient } from "./up-manager";
import type { CheckoutDiagnosis } from "./up-manager-funnel-diagnostic";
import type { CatalogSnapshot } from "./up-manager-b2c-products";

export const checkoutTestsEnabled = () => process.env.UP_MANAGER_CHECKOUT_TEST_ENABLED === "1";

export function findCheckoutTestVariant(
  diagnosis: CheckoutDiagnosis | null,
  catalog: CatalogSnapshot | null,
) {
  if (!diagnosis || !catalog) return null;
  // Older reports contain the exact variant in the recommendation and its catalog snapshot.
  const matches = catalog.filter(({ key, name, options }) => {
    if (!/^\d+:\d+$/.test(key)) return false;
    const variantId = key.split(":")[1];
    return diagnosis.targetVariantId
      ? variantId === diagnosis.targetVariantId
      : diagnosis.action.includes(` com ${name} (${options.split(" / ").join(", ")}).`);
  });
  if (matches.length !== 1) return null;
  const [{ key, name, options, productId }] = matches;
  return { variantId: key.split(":")[1], productId, label: `${name} · ${options}` };
}

type SavedTest = { attemptId: string; startedAt: number; result?: CheckoutTestResult };

export async function checkoutTestForReport(clientId: string, runId: string) {
  const [report] = await db.select({
    diagnosis: sql<CheckoutDiagnosis | null>`${archive.payload}#>'{b2c,cro,evaluation,checkoutDiagnosis}'`,
    catalog: sql<CatalogSnapshot | null>`${archive.payload}#>'{commercialSnapshot,catalog}'`,
    saved: sql<SavedTest | null>`${archive.payload}->'checkoutTest'`,
  }).from(archive).where(and(eq(archive.clientId, clientId), eq(archive.runId, runId)));
  return {
    variant: findCheckoutTestVariant(report?.diagnosis ?? null, report?.catalog ?? null),
    result: report?.saved?.result ?? null,
  };
}

export async function runManagerCheckoutTest(client: ManagerClient, runId: string) {
  const { variant } = await checkoutTestForReport(client.id, runId);
  if (!variant || !client.storeId || !client.storeToken) return { status: "unavailable" as const };
  const { variantId, productId, label } = variant;

  const scope = and(eq(archive.clientId, client.id), eq(archive.runId, runId));
  const attemptId = randomUUID();
  const now = Date.now();
  const attempt = JSON.stringify({ attemptId, startedAt: now });
  const [reserved] = await db.update(archive).set({
    payload: sql`jsonb_set(${archive.payload}, '{checkoutTest}',
      COALESCE(${archive.payload}->'checkoutTest', '{}'::jsonb) || ${attempt}::jsonb)`,
  }).where(and(scope, sql`
    COALESCE((${archive.payload}#>>'{checkoutTest,startedAt}')::bigint, 0)
      < ${now - 120_000}`)).returning({ runId: archive.runId });
  if (!reserved) return { status: "recent" as const };

  let result: CheckoutTestResult;
  try {
    const product = await fetchManagerCatalogProduct(client.storeId, client.storeToken, productId);
    const selected = product.variants?.find(({ id }) => String(id) === variantId);
    if (!selected) {
      throw new Error("Variante não encontrada no catálogo da loja.");
    }
    result = await testStorefrontCheckout({
      storeId: client.storeId, productId, variantId, name: label,
    });
  } catch {
    result = {
      status: "inconclusive",
      product: label,
      testedAt: new Date().toISOString(),
      steps: [{ label: "Variante", status: "inconclusive", detail: "A Nuvemshop não confirmou o produto e a variante para iniciar o teste." }],
    };
  }
  const saved = JSON.stringify({ attemptId, startedAt: now, result });
  await db.update(archive).set({
    payload: sql`jsonb_set(${archive.payload}, '{checkoutTest}', ${saved}::jsonb)`,
  }).where(and(scope, sql`${archive.payload}#>>'{checkoutTest,attemptId}' = ${attemptId}`));
  return { status: "saved" as const, result };
}
