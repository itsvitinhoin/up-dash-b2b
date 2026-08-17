import { describe, expect, it } from "vitest";
import { serializeErrorForLog } from "../src/lib/safe-error";

describe("serializeErrorForLog", () => {
  it("keeps the database error code without logging query parameters", () => {
    const accessToken = `EAA${"secret".repeat(20)}`;
    const error = new Error(
      `Failed query: insert into whatsapp_integrations (...) values (...) params: client-1,${accessToken}`,
      {
        cause: Object.assign(
          new Error("there is no unique or exclusion constraint matching the ON CONFLICT specification"),
          { code: "42P10" },
        ),
      },
    );

    const serialized = serializeErrorForLog(error);

    expect(serialized.code).toBe("42P10");
    expect(serialized.message).toContain("no unique or exclusion constraint");
    expect(JSON.stringify(serialized)).not.toContain(accessToken);
    expect(JSON.stringify(serialized)).not.toContain("params:");
  });

  it("redacts Meta and query-string tokens from ordinary errors", () => {
    const accessToken = `AQ${"private".repeat(15)}`;
    const error = new Error(
      `Meta request failed authorization=Bearer ${accessToken} at https://example.test?access_token=${accessToken}`,
    );

    const serialized = serializeErrorForLog(error);

    expect(serialized.message).toContain("[REDACTED]");
    expect(JSON.stringify(serialized)).not.toContain(accessToken);
  });
});
