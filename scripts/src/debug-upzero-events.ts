import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type DebugMetric = {
  event_name: string;
  user_id: number | null;
  order_id: number | null;
  total_value: number;
  product: { id: number; name: string; sku: string } | null;
};

type DebugResponse = {
  data?: DebugMetric[];
  total?: number;
};

const COMMERCIAL_EVENTS = new Set([
  "add_to_cart",
  "initiate_checkout",
  "checkout_start",
  "purchase",
  "order_created",
  "order_paid",
  "payment_approved",
]);

function loadEnvFile(fileName: string): void {
  const filePath = resolve(process.cwd(), fileName);
  if (!existsSync(filePath)) return;

  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

function getApiKey(): string {
  loadEnvFile(".env.local");
  loadEnvFile(".env");
  const apiKey = (process.env.UPZERO_API_TOKEN ?? process.env.UPZERO_CELEB_API_KEY)
    ?.trim()
    .replace(/^Bearer\s+/i, "");
  if (!apiKey) {
    throw new Error("UPZERO_API_TOKEN não definido.");
  }
  return apiKey;
}

async function main() {
  const url = new URL("https://api.upzero.com.br/external/v1/analytics/metrics");
  url.searchParams.set("from", process.env.UPZERO_DEBUG_FROM ?? "2026-05-01T00:00:00Z");
  url.searchParams.set("to", process.env.UPZERO_DEBUG_TO ?? "2026-05-31T23:59:59Z");

  const response = await fetch(url.toString(), {
    headers: {
      "X-API-Key": getApiKey(),
      Accept: "application/json",
    },
  });

  const json = (await response.json()) as DebugResponse;
  if (!response.ok) {
    throw new Error(`Erro UP Zero ${response.status}: ${JSON.stringify(json)}`);
  }

  const rows = json.data ?? [];
  const eventCounts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.event_name] = (acc[row.event_name] ?? 0) + 1;
    return acc;
  }, {});
  const commercialEvents = rows.filter((row) => COMMERCIAL_EVENTS.has(row.event_name));

  console.log("Total informado pela API:", json.total ?? rows.length);
  console.log("Total de linhas:", rows.length);
  console.log("Eventos encontrados:");
  console.log(eventCounts);

  console.log("");
  console.log("Eventos comerciais:");
  console.log(JSON.stringify(commercialEvents.slice(0, 20), null, 2));

  console.log("");
  console.log("Eventos com user_id:", rows.filter((row) => row.user_id).length);
  console.log("Eventos sem user_id:", rows.filter((row) => !row.user_id).length);
  console.log("Eventos com order_id:", rows.filter((row) => row.order_id).length);
  console.log("Eventos com valor:", rows.filter((row) => row.total_value > 0).length);
  console.log("Eventos com produto:", rows.filter((row) => row.product).length);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
