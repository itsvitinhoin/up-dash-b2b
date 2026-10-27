import { describe, expect, it } from "vitest";
// Import relativo de proposito: confere o contrato desta árvore (o pacote @workspace/api-zod pode apontar para outra cópia).
import { GetClientResponse, ListClientsResponse } from "../../../lib/api-zod/src/generated/api";

const listItemShape = ListClientsResponse.shape.data.element.shape;

describe.each([
  ["GetClientResponse", GetClientResponse.shape.archivedAt],
  ["ListClientsResponse (item)", listItemShape.archivedAt],
])("contrato do cliente: archivedAt em %s", (_name, field) => {
  it("cliente em uso continua null (não vira 1970)", () => {
    expect(field.parse(null)).toBeNull();
  });

  it("cliente arquivado mantém a data (texto ISO vindo da API ou Date do banco)", () => {
    expect(field.parse("2026-10-13T12:00:00.000Z")?.toISOString()).toBe("2026-10-13T12:00:00.000Z");
    expect(field.parse(new Date("2026-10-13T12:00:00.000Z"))?.toISOString()).toBe("2026-10-13T12:00:00.000Z");
  });

  it("aceita resposta sem o campo (cliente montado por código antigo)", () => {
    expect(field.parse(undefined)).toBeUndefined();
  });
});
