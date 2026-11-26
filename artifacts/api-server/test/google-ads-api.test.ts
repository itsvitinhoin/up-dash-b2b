import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readGoogleAdsAccount, readGoogleAdsCampaigns } from "../src/services/google-ads-api";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ids = { customerId: "1234567890", managerId: "2345678901" };
const dates = { dateFrom: "2026-10-26", dateTo: "2026-11-24" };
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GOOGLE_ADS_SERVICE_ACCOUNT_JSON", JSON.stringify({
    client_email: "test@up-dash.example",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    testVersion: Date.now(),
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function mockGoogle(payload: unknown, status = 200) {
  fetchMock
    .mockResolvedValueOnce(Response.json({ access_token: "test-access-token", expires_in: 3600 }))
    .mockResolvedValueOnce(Response.json(payload, { status, headers: { "request-id": "test-request" } }));
}

describe("Google Ads reporting API", () => {
  it("uses the adwords scope and sends the manager ID only for manager-mediated access", async () => {
    mockGoogle([{ results: [{
      customer: { id: ids.customerId, descriptiveName: "Teste", currencyCode: "BRL", timeZone: "America/Sao_Paulo" },
    }] }]);
    await expect(readGoogleAdsAccount(ids)).resolves.toEqual({
      accountName: "Teste", currency: "BRL", timeZone: "America/Sao_Paulo",
    });
    const [tokenUrl, tokenRequest] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe("https://oauth2.googleapis.com/token");
    expect(jwt.decode(tokenRequest.body.get("assertion"))).toMatchObject({
      scope: "https://www.googleapis.com/auth/adwords",
    });
    const [url, options] = fetchMock.mock.calls[1];
    expect(url).toBe("https://googleads.googleapis.com/v26/customers/1234567890/googleAds:searchStream");
    expect(options.headers).toEqual({
      Authorization: "Bearer test-access-token",
      "Content-Type": "application/json",
      "login-customer-id": ids.managerId,
    });
  });

  it("preserves cost in micros and fractional conversions across batches", async () => {
    const row = { campaign: { id: "123", name: "PMax" }, segments: { date: "2026-11-24" } };
    mockGoogle([
      { results: [{ ...row, metrics: { costMicros: "10250000", conversions: 2.5, conversionsValue: 81.43 } }] },
      { results: [{ ...row, segments: { date: "2026-11-23" }, metrics: { impressions: "42" } }] },
    ]);
    await expect(readGoogleAdsCampaigns({ ...ids, managerId: null }, dates)).resolves.toEqual([
      { day: "2026-11-24", campaignId: "123", name: "PMax", channel: "UNKNOWN",
        costMicros: 10250000, conversions: 2.5, conversionValue: 81.43, impressions: 0, clicks: 0 },
      { day: "2026-11-23", campaignId: "123", name: "PMax", channel: "UNKNOWN",
        costMicros: 0, conversions: 0, conversionValue: 0, impressions: 42, clicks: 0 },
    ]);
    expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty("login-customer-id");
  });

  it("reports authorization failures without exposing Google's raw diagnostics", async () => {
    mockGoogle({ error: {
      message: "raw details",
      details: [{ errors: [{ errorCode: { authorizationError: "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION" } }] }],
    } }, 403);
    await expect(readGoogleAdsCampaigns(ids, dates)).rejects.toThrow(
      "O Google Ads recusou a consulta (CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION · test-request).",
    );
  });
});
