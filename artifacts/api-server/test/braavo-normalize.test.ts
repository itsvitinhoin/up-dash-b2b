import { describe, expect, it } from "vitest";
import {
  braavoDate,
  braavoDay,
  braavoProductGroup,
  normalizeBraavoCustomer,
  normalizeBraavoOrder,
  money,
  quantity,
  stockQuantity,
} from "../src/services/braavo-normalize";

import { sampleOrder } from "./fixtures/braavo";
import { BraavoRecordError } from "../src/services/braavo-api";

describe("Braavo normalization", () => {
  it.each([-1, "-1", "0", 12, "12.0", -2147483648, 2147483647])("preserves signed inventory balances: %s", (value) => {
    expect(stockQuantity(value)).toBe(Number(value));
  });
  it.each([null, undefined, "", " ", true, [], {}, "abc", "0x10", 1.5, "-1.5", Infinity, NaN, -2147483649, 2147483648])("rejects missing, malformed or out-of-range stock: %s", (value) => {
    expect(() => stockQuantity(value)).toThrow("estoque");
  });
  it("still rejects negative order-item quantities", () => {
    expect(() => quantity(-1)).toThrow();
    expect(() => normalizeBraavoOrder({
      ...sampleOrder,
      produtos: sampleOrder.produtos.map((item) => ({ ...item, quantidade: "-1" })),
    })).toThrow("Quantidade");
  });
  it("converts store timestamps to UTC without depending on the machine timezone", () => {
    expect(braavoDate("2026-01-10 23:30:00")?.toISOString()).toBe(
      "2026-01-11T02:30:00.000Z",
    );
    expect(braavoDay(braavoDate("2026-01-10 23:30:00")!)).toBe("2026-01-10");
    expect(braavoDate("2026-01-10T23:30:00Z")?.toISOString()).toBe(
      "2026-01-10T23:30:00.000Z",
    );
    expect(braavoDate("", false)).toBeNull();
  });
  it.each([
    "",
    "2026-02-30 10:00:00",
    "2026-13-01 10:00:00",
    "2026-01-01 25:00:00",
  ])("rejects missing or invalid date %s", (date) =>
    expect(() => braavoDate(date)).toThrow(),
  );
  it("keeps shipping and coupon discounts from being counted twice", () => {
    const order = normalizeBraavoOrder(sampleOrder);
    expect(order).toMatchObject({
      amount: 100,
      fulfilledAmount: 100,
      grossAmount: 100,
      discountAmount: 10,
      shippingAmount: 10,
      status: "APPROVED",
      requestedQuantity: 2,
      fulfilledQuantity: 2,
    });
    expect(order.items[0]).toMatchObject({
      priceAtSale: 45,
      grossPriceAtSale: 50,
      discountAmount: 10,
    });
    expect(order.utmCampaign).toBe("verao");
    expect(order.createdAt).not.toEqual(order.approvalDate);
  });
  it.each(["0", "1", "2"])(
    "keeps payment %s pending regardless of delivery status",
    (payment) => {
      expect(
        normalizeBraavoOrder({
          ...sampleOrder,
          status_pagamento: payment,
          status_entrega: "23",
        }),
      ).toMatchObject({
        status: "PENDING",
        paid: false,
        fulfilledAmount: 0,
        fulfilledQuantity: 0,
      });
    },
  );
  it("removes paid revenue and quantities when canceled", () => {
    expect(
      normalizeBraavoOrder({ ...sampleOrder, status_pagamento: "6" }),
    ).toMatchObject({
      status: "REJECTED",
      paid: false,
      amount: 0,
      fulfilledAmount: 0,
      cancelledAmount: 100,
      refundedAmount: 0,
      fulfilledQuantity: 0,
    });
    expect(
      normalizeBraavoOrder({ ...sampleOrder, status_entrega: "41" }).paid,
    ).toBe(false);
  });
  it("recognizes delivery only after payment approval", () => {
    expect(
      normalizeBraavoOrder({ ...sampleOrder, status_entrega: "20" }).status,
    ).toBe("SHIPPED");
    expect(
      normalizeBraavoOrder({ ...sampleOrder, status_entrega: "23" }).status,
    ).toBe("DELIVERED");
  });
  it("refuses unknown statuses, missing details and missing approval dates", () => {
    expect(() =>
      normalizeBraavoOrder({ ...sampleOrder, status_pagamento: "99" }),
    ).toThrow();
    expect(() =>
      normalizeBraavoOrder({ ...sampleOrder, produtos: undefined }),
    ).toThrow();
    expect(() =>
      normalizeBraavoOrder({ ...sampleOrder, data_aprovado: "" }),
    ).toThrow();
  });
  it("uses the stable customer ID and stores a document hash instead of plaintext", () => {
    const customer = normalizeBraavoCustomer({
      id: 12,
      nome: "Ana",
      pessoa: "1",
      cpf: "111.222.333-44",
      email: "ANA@example.invalid",
      tel_1_pais: "55",
      tel_1: "11999990000",
      data_criado: "2026-01-01 10:00:00",
    });
    expect(customer).toMatchObject({
      externalId: "braavo:12",
      email: "ana@example.invalid",
      documentLast4: "3344",
      documentType: "CPF",
      phone: "+5511999990000",
      registrationStatus: "PENDING",
    });
    expect(customer.documentHash).toHaveLength(64);
    expect(JSON.stringify(customer)).not.toContain("11122233344");
  });
  it("groups Braavo variants by product and preserves Nuvemshop grouping", () => {
    expect(braavoProductGroup("braavo:100:501")).toBe("braavo:100");
    expect(braavoProductGroup("braavo:101:502")).toBe("braavo:101");
    expect(braavoProductGroup("100:501")).toBe("100");
  });
  it("does not silently replace absent money with zero", () => {
    expect(() => money(undefined, true)).toThrow();
    expect(() => money("R$100")).toThrow();
    expect(money(0)).toBe(0);
    expect(money(0.1 + 0.2)).toBe(0.3);
  });
  it("limits a cancelled amount above the total instead of refusing the order", () => {
    // Real legacy case: 300.00 cancelled on a 299.90 order. Net revenue is
    // max(0, total - cancelled), so limiting to the total changes nothing.
    const order = normalizeBraavoOrder({
      ...sampleOrder,
      pedido_total: 299.9,
      pedido_geral: 299.9,
      frete_valor: 0,
      pedido_cancelado: 300,
    });
    expect(order.cancelledAmount).toBe(299.9);
    expect(order.amount).toBe(0);
    expect(order.sourceMetadata.pedido_cancelado).toBe(300);
    expect(order.sourceMetadata.data_quality).toEqual([
      "cancelado_maior_que_total",
    ]);
    expect(normalizeBraavoOrder(sampleOrder).sourceMetadata).not.toHaveProperty(
      "data_quality",
    );
  });
  it("reads the order discount from pedido_desconto and falls back to desconto_valor", () => {
    // On a real shop desconto_valor was always 0 while pedido_desconto held the coupon.
    expect(
      normalizeBraavoOrder({ ...sampleOrder, desconto_valor: 0, pedido_desconto: 20 })
        .discountAmount,
    ).toBe(20);
    expect(
      normalizeBraavoOrder({ ...sampleOrder, pedido_desconto: undefined, desconto_valor: 10 })
        .discountAmount,
    ).toBe(10);
    expect(
      normalizeBraavoOrder({ ...sampleOrder, pedido_desconto: 0, desconto_valor: 10 })
        .discountAmount,
    ).toBe(0);
  });
  it("marks bad data as a record error so a batch can quarantine it", () => {
    expect(() =>
      normalizeBraavoOrder({ ...sampleOrder, status_pagamento: "99" }),
    ).toThrow(BraavoRecordError);
    expect(() =>
      normalizeBraavoOrder({ ...sampleOrder, pedido_geral: -1 }),
    ).toThrow(BraavoRecordError);
    expect(() => stockQuantity("abc")).toThrow(BraavoRecordError);
    expect(() => normalizeBraavoCustomer({ id: 0 })).toThrow(BraavoRecordError);
  });
});
