import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCorsOptions } from "../src/lib/security";

const configuredOrigin = "https://www.grupoup-dash.com.br";
const previewHost = "updash-stage-example.vercel.app";
const probe = async (origin: string) => {
  const check = buildCorsOptions().origin;
  if (typeof check !== "function") throw new Error("Expected origin callback");
  return new Promise<boolean>((resolve) =>
    check(origin, (error, allowed) => {
      resolve(!error && allowed === true);
    }),
  );
};

describe("CORS for a staged Vercel deployment", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts the configured origin and only its own HTTPS Vercel origin", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_URL", previewHost);
    vi.stubEnv("ALLOWED_ORIGINS", configuredOrigin);

    expect(await probe(configuredOrigin)).toBe(true);
    expect(await probe(`https://${previewHost}`)).toBe(true);
    expect(await probe(`http://${previewHost}`)).toBe(false);
    expect(await probe("https://different-project.vercel.app")).toBe(false);
  });

  it("keeps the startup allowlist requirement and ignores a Vercel hostname outside Vercel", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "0");
    vi.stubEnv("VERCEL_URL", previewHost);
    vi.stubEnv("ALLOWED_ORIGINS", configuredOrigin);
    expect(await probe(`https://${previewHost}`)).toBe(false);

    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("ALLOWED_ORIGINS", "*");
    expect(() => buildCorsOptions()).toThrow(
      /concrete comma-separated allowlist/,
    );
  });
});
