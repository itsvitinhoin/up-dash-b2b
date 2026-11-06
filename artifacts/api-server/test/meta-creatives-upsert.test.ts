import { beforeEach, describe, expect, it, vi } from "vitest";

// Gravação dos criativos no Postgres: tem que ser em LOTES. A tela de Marketing (e o card de Investimento da Visão geral) só responde depois
// dela; uma ida ao banco por anúncio, em série, deixava a tela esperando segundos.

const calls = vi.hoisted(() => ({
  inserts: [] as Array<{ values: Array<Record<string, unknown>>; conflict: { target: unknown; set: Record<string, unknown> } }>,
  updates: [] as Array<{ set: Record<string, unknown> }>,
}));

vi.mock("@workspace/db", () => {
  const col = (name: string) => ({ name });
  return {
    db: {
      insert: () => ({
        values: (values: Array<Record<string, unknown>>) => ({
          onConflictDoUpdate: async (conflict: { target: unknown; set: Record<string, unknown> }) => {
            calls.inserts.push({ values, conflict });
          },
        }),
      }),
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          where: async () => {
            calls.updates.push({ set });
          },
        }),
      }),
    },
    creativesTable: {
      id: col("id"), clientId: col("client_id"), platform: col("platform"), name: col("name"), status: col("status"), clicks: col("clicks"),
      impressions: col("impressions"), spend: col("spend"), leads: col("leads"), approvedLeads: col("approved_leads"),
      activeFrom: col("active_from"), activeTo: col("active_to"),
    },
  };
});

import { upsertMetaCreatives, type MetaAdMetric } from "../src/services/meta-ads";

const ad = (n: number, over: Partial<MetaAdMetric> = {}): MetaAdMetric => ({
  id: String(n), name: `Anúncio ${n}`, spend: n, impressions: n * 10, clicks: n, leads: 1, purchases: 1, revenue: n * 3, roas: 3, cpl: 1, cpa: 1,
  dateStart: "2026-10-01", dateStop: "2026-10-27", ...over,
});

beforeEach(() => {
  calls.inserts.length = 0;
  calls.updates.length = 0;
});

describe("upsertMetaCreatives (em lotes)", () => {
  it("94 anúncios vão numa ÚNICA gravação (não 94)", async () => {
    await upsertMetaCreatives("c1", Array.from({ length: 94 }, (_, i) => ad(i + 1)));
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0].values).toHaveLength(94);
  });

  it("acima de 200 divide em lotes de 200 (250 = 200 + 50)", async () => {
    await upsertMetaCreatives("c1", Array.from({ length: 250 }, (_, i) => ad(i + 1)));
    expect(calls.inserts.map((c) => c.values.length)).toEqual([200, 50]);
  });

  it("cada linha leva o id composto, o cliente, a plataforma e os números do anúncio", async () => {
    await upsertMetaCreatives("c1", [ad(7)]);
    expect(calls.inserts[0].values[0]).toMatchObject({
      id: "meta:c1:7", clientId: "c1", name: "Anúncio 7", platform: "META", status: "ACTIVE", clicks: 7, impressions: 70, spend: 7, leads: 1, approvedLeads: 1,
      activeFrom: "2026-10-01", activeTo: "2026-10-27",
    });
  });

  it("anúncio repetido no mesmo comando é gravado uma vez só, valendo o último (o banco recusaria o mesmo id duas vezes)", async () => {
    await upsertMetaCreatives("c1", [ad(1, { spend: 10 }), ad(2), ad(1, { spend: 99 })]);
    const rows = calls.inserts[0].values;
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === "meta:c1:1")).toMatchObject({ spend: 99 });
  });

  it("em conflito atualiza todas as colunas de números a partir do valor novo (excluded.*) e o horário", async () => {
    await upsertMetaCreatives("c1", [ad(1)]);
    const { target, set } = calls.inserts[0].conflict;
    expect(target).toMatchObject({ name: "id" });
    expect(Object.keys(set).sort()).toEqual(["activeFrom", "activeTo", "approvedLeads", "clicks", "impressions", "leads", "name", "spend", "status", "updatedAt"]);
    expect(set.updatedAt).toBeInstanceOf(Date);
    // cada coluna vem do `excluded` (valor da linha nova), não de um valor colado no comando
    const rendered = JSON.stringify(set.spend);
    expect(rendered).toContain("excluded");
    expect(rendered).toContain("spend");
  });

  it("sem anúncios: não grava nada e marca os criativos do Meta como inativos", async () => {
    await upsertMetaCreatives("c1", []);
    expect(calls.inserts).toHaveLength(0);
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].set).toMatchObject({ status: "INACTIVE" });
  });
});
