import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { report } = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: report }) }) },
  upManagerAdActionsTable: {},
  upManagerArchiveTable: { clientId: "client_id", runId: "run_id", payload: "payload" },
}));
vi.mock("../src/services/up-manager", () => ({
  managerMetaToken: () => "fixture-only-token",
  readMedia: vi.fn(),
}));
vi.mock("../src/services/up-manager-actions", () => ({
  executeManagerGradePause: vi.fn(),
  pauseManagerAd: vi.fn(),
}));

import { budgetAfter, quoteManagerBudget } from "../src/services/up-manager-media-actions";
import type { ManagerClient } from "../src/services/up-manager";

const client = { id: "store", accountId: "act_9", currency: "BRL" } as ManagerClient;
const campaign = { id: "100", name: "AIYU", level: "campaign", recommendation: "scale", status: "active" };
const adset = { id: "200", campaignId: "100", name: "Conjunto 1", level: "adset", recommendation: "maintain", status: "active" };
const ad = { id: "300", campaignId: "100", adsetId: "200", name: "Anúncio", level: "ad", recommendation: "scale", status: "active" };
const window = { dateFrom: "2026-11-14", dateTo: "2026-11-20" };
const ready = { scope: { commerceConfirmed: true }, coverage: { mediaAvailable: true, monitorFresh: true } };

function meta(overrides: Record<string, object>) {
  vi.stubGlobal("fetch", vi.fn(async (request: URL) => {
    const id = request.pathname.split("/").at(-1)!;
    const details = overrides[id];
    if (!details) return new Response(null, { status: 404 });
    return Response.json({ id, name: id, account_id: "9", status: "ACTIVE", effective_status: "ACTIVE", ...details });
  }));
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("escala do orçamento do Up Manager", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T17:00:00Z"));
    report.mockResolvedValue([{ payload: { b2c: { ...ready, media: { roasReview: {
      window, rows: [campaign, adset, ad], accountPriceComparable: true,
    } } } } }]);
  });

  it("aplica apenas 15% a 20% e mantém a proporção após arredondar", () => {
    expect(budgetAfter(10000, 15)).toBe(11500);
    expect(budgetAfter(10000, 20)).toBe(12000);
    expect(budgetAfter(101, 15)).toBe(117);
    expect(budgetAfter(101, 20)).toBe(121);
    expect(budgetAfter(1, 18)).toBeNull();
    expect(budgetAfter(10000, 14)).toBeNull();
    expect(budgetAfter(10000, 21)).toBeNull();
  });

  it("identifica o orçamento herdado da campanha no anúncio", async () => {
    meta({
      "100": { daily_budget: "10000" },
      "200": { campaign_id: "100" },
      "300": { campaign_id: "100", adset_id: "200" },
    });
    await expect(quoteManagerBudget(client, "run", { level: "ad", id: "300" }))
      .resolves.toMatchObject({ options: [{ ownerId: "100", ownerLevel: "campaign", field: "daily_budget", before: 10000 }] });
  });

  it("oferece o conjunto elegível quando a campanha usa orçamentos por conjunto", async () => {
    meta({ "100": {}, "200": { campaign_id: "100", lifetime_budget: "25000" } });
    await expect(quoteManagerBudget(client, "run", { level: "campaign", id: "100" }))
      .resolves.toMatchObject({ options: [{ ownerId: "200", ownerLevel: "adset", field: "lifetime_budget", before: 25000 }] });
  });

  it("retorna a verba compartilhada e o motivo do bloqueio em formato estruturado", async () => {
    const blockedAd = { ...ad, scaleBudgets: [{ ownerId: "100", blockers: ["Helena com grade incompleta"] }] };
    report.mockResolvedValue([{ payload: { b2c: { ...ready, media: { roasReview: {
      window, rows: [campaign, adset, blockedAd], accountPriceComparable: true,
    } } } } }]);
    meta({ "100": { daily_budget: "10000" }, "200": { campaign_id: "100" },
      "300": { campaign_id: "100", adset_id: "200" } });
    await expect(quoteManagerBudget(client, "run", { level: "ad", id: "300" })).resolves.toMatchObject({
      options: [], blocked: [{ ownerId: "100", ownerLevel: "campaign", blockers: ["Helena com grade incompleta"] }],
    });
  });

  it("explica que o fechamento pendente impede a escala antes de consultar a Meta", async () => {
    report.mockResolvedValue([{ payload: { b2c: { ...ready, scope: { commerceConfirmed: false }, media: { roasReview: {
      window, rows: [campaign, adset, ad], accountPriceComparable: true,
    } } } } }]);
    const fetchMeta = vi.fn();
    vi.stubGlobal("fetch", fetchMeta);
    await expect(quoteManagerBudget(client, "run", { level: "ad", id: "300" })).rejects.toThrow("fechamento de pedidos");
    expect(fetchMeta).not.toHaveBeenCalled();
  });

  it("recusa um anúncio de outra conta", async () => {
    meta({ "100": { daily_budget: "10000" }, "200": { campaign_id: "100" },
      "300": { account_id: "8", campaign_id: "100", adset_id: "200" } });
    await expect(quoteManagerBudget(client, "run", { level: "ad", id: "300" })).rejects.toThrow("fora da conta");
  });
});
