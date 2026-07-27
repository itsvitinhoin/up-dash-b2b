import { localDateToDateOnly } from "./dashboard-context-url";

export interface ProductsPeriodInput {
  clientId?: string;
  from: Date;
  to: Date;
}

export function buildProductsPeriodParams(input: ProductsPeriodInput) {
  return {
    clientId: input.clientId,
    dateFrom: localDateToDateOnly(input.from),
    dateTo: localDateToDateOnly(input.to),
  };
}
