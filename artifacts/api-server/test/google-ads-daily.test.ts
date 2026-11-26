import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { googleAdsDailyTable as daily } from "@workspace/db/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: null as ReturnType<typeof drizzle> | null,
  configured: vi.fn(() => true),
  readCampaigns: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@workspace/db", async () => ({
  ...await import("@workspace/db/schema"),
  get db() { return mocks.db; },
}));
vi.mock("../src/lib/logger", () => ({ logger: { warn: mocks.warn } }));
vi.mock("../src/services/google-ads-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/services/google-ads-api")>(),
  googleAdsConfigured: mocks.configured,
  readGoogleAdsCampaigns: mocks.readCampaigns,
}));

import { GoogleAdsError } from "../src/services/google-ads-api";
import { refreshDailyGoogleAdsReports } from "../src/services/google-ads-report";

let pg: PGlite;
const runAt = new Date("2026-11-26T15:30:00Z");

beforeEach(async () => {
  mocks.configured.mockReset().mockReturnValue(true);
  mocks.readCampaigns.mockReset();
  mocks.warn.mockReset();
  pg = new PGlite();
  mocks.db = drizzle(pg);
  await pg.exec(`
    CREATE TABLE clients (
      id text PRIMARY KEY, is_active boolean NOT NULL, archived_at timestamptz
    );
    CREATE TABLE google_ads_connections (
      client_id text PRIMARY KEY,
      customer_id text UNIQUE NOT NULL,
      manager_id text,
      account_name text NOT NULL,
      currency text NOT NULL,
      time_zone text NOT NULL
    );
    CREATE TABLE google_ads_daily (
      customer_id text NOT NULL,
      day date NOT NULL,
      campaigns jsonb NOT NULL,
      fetched_at timestamptz NOT NULL,
      PRIMARY KEY (customer_id, day)
    );
    INSERT INTO clients VALUES
      ('a', true, NULL), ('b', true, NULL), ('c', true, NULL),
      ('archived', true, '2026-11-20'), ('inactive', false, NULL), ('unlinked', true, NULL);
    INSERT INTO google_ads_connections VALUES
      ('a', '1000000001', NULL, 'Brasil', 'BRL', 'America/Sao_Paulo'),
      ('b', '1000000002', NULL, 'Sem acesso', 'BRL', 'America/Sao_Paulo'),
      ('c', '1000000003', '1000000099', 'Austrália', 'BRL', 'Australia/Darwin'),
      ('archived', '1000000004', NULL, 'Arquivado', 'BRL', 'America/Sao_Paulo'),
      ('inactive', '1000000005', NULL, 'Inativo', 'BRL', 'America/Sao_Paulo');
  `);
});

afterEach(async () => {
  await pg.close();
});

describe("sincronização diária de Google Ads", () => {
  it("usa dias fechados no fuso da conta e continua após a falha de uma conexão", async () => {
    mocks.readCampaigns.mockImplementation(({ customerId }: { customerId: string }) => {
      if (customerId === "1000000002") throw new GoogleAdsError("Acesso retirado.", 502);
      return Promise.resolve([]);
    });

    const expected = { clients: 3, updated: 2, failed: 1 };
    await expect(refreshDailyGoogleAdsReports(runAt)).resolves.toEqual(expected);
    await expect(refreshDailyGoogleAdsReports(runAt)).resolves.toEqual(expected);

    expect(mocks.readCampaigns).toHaveBeenCalledTimes(6);
    expect(mocks.readCampaigns).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "1000000001", managerId: null }),
      { dateFrom: "2026-10-27", dateTo: "2026-11-25" },
    );
    expect(mocks.readCampaigns).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "1000000003", managerId: "1000000099" }),
      { dateFrom: "2026-10-28", dateTo: "2026-11-26" },
    );
    const rows = await mocks.db!.select().from(daily);
    expect(rows).toHaveLength(60);
    const failedRows = await mocks.db!.select().from(daily).where(eq(daily.customerId, "1000000002"));
    expect(failedRows).toEqual([]);
    expect(mocks.warn).toHaveBeenCalledWith(expect.objectContaining({ clientId: "b" }), expect.any(String));
  });

  it("retorna erro de configuração sem iniciar as consultas ao Google", async () => {
    mocks.configured.mockReturnValue(false);

    await expect(refreshDailyGoogleAdsReports(runAt)).rejects.toMatchObject({ status: 503 });
    expect(mocks.readCampaigns).not.toHaveBeenCalled();
  });
});
