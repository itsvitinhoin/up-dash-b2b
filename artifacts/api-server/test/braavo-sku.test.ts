import { describe, expect, it } from "vitest";
import { BraavoRecordError } from "../src/services/braavo-api";
import { persistSku } from "../src/services/braavo-sync";

describe("Braavo SKU whose product is not in the catalog", () => {
  it("is a quarantinable record error, not a failure that stops the whole load", async () => {
    const tx = {} as never; // nunca é tocado: falha antes de qualquer gravação
    const promise = persistSku(tx, "client-1", { id: "10", produto_id: "999" }, new Map());
    await expect(promise).rejects.toBeInstanceOf(BraavoRecordError);
    await expect(promise).rejects.toMatchObject({ code: "SKU_WITHOUT_PRODUCT" });
  });
});
