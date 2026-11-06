import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async () => ({
  ...(await import("@workspace/db/schema")),
  db: {},
}));

import { mapOrderStatus } from "../src/services/upzero-sync";

// MX Fashion, set/2026: pedido 2305 pago na UP Zero (payment_status = paid) mas com status operacional RESERVED. O dash o tratava como pendente
// (R$ 7.829,72 e 1 pedido a menos que o painel da UP Zero).
describe("status do pedido UP Zero com pagamento", () => {
  it("pedido RESERVED e pago vira APPROVED (conta como venda paga)", () => {
    expect(mapOrderStatus("RESERVED", "paid")).toBe("APPROVED");
    expect(mapOrderStatus("RESERVED", "PAID")).toBe("APPROVED");
  });

  it("pedido RESERVED sem pagamento continua PENDING", () => {
    expect(mapOrderStatus("RESERVED")).toBe("PENDING");
    expect(mapOrderStatus("RESERVED", null)).toBe("PENDING");
    expect(mapOrderStatus("RESERVED", "pending")).toBe("PENDING");
  });

  it("o pagamento não muda os outros status, nem reabre pedido cancelado", () => {
    expect(mapOrderStatus("SHIPPED", "paid")).toBe("SHIPPED");
    expect(mapOrderStatus("DELIVERED", "paid")).toBe("DELIVERED");
    expect(mapOrderStatus("CONFIRMED", "paid")).toBe("APPROVED");
    expect(mapOrderStatus("CANCELED", "paid")).toBe("REJECTED");
  });
});
