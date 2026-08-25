export type AutomationSenderPhoneCandidate = {
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  integrationId: string | null;
  wabaId: string | null;
  isDefault: boolean;
};

export type AutomationSenderSelection = {
  phone: AutomationSenderPhoneCandidate | null;
  source:
    | "seller_phone"
    | "seller_phone_not_matched"
    | "default_phone"
    | "default_phone_not_configured";
  blockedReason:
    | "seller_phone_not_matched"
    | "default_phone_not_configured"
    | null;
};

export type AutomationAudience = "customer" | "internal_seller";

export type AutomationDeliveryRouting = {
  audience: AutomationAudience;
  senderStrategy: "assigned_seller" | "default_phone";
  recipientStrategy: "event_customer" | "assigned_seller";
  recipientPhone: string | null;
};

export function getAutomationAudience(conditions: unknown): AutomationAudience {
  if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)) {
    return "customer";
  }

  return (conditions as Record<string, unknown>).audience === "internal_seller"
    ? "internal_seller"
    : "customer";
}

export function resolveAutomationDeliveryRouting(params: {
  conditions: unknown;
  customerPhone: string | null;
  sellerPhone: string | null;
}): AutomationDeliveryRouting {
  const audience = getAutomationAudience(params.conditions);
  if (audience === "internal_seller") {
    return {
      audience,
      senderStrategy: "default_phone",
      recipientStrategy: "assigned_seller",
      recipientPhone: params.sellerPhone,
    };
  }

  return {
    audience,
    senderStrategy: "assigned_seller",
    recipientStrategy: "event_customer",
    recipientPhone: params.customerPhone,
  };
}

export function hasAssignedSellerSenderMismatch(params: {
  audience: AutomationAudience;
  sellerPhone: string | null;
  senderSource: string | null;
}) {
  return params.audience === "customer"
    && Boolean(params.sellerPhone)
    && params.senderSource !== "seller_phone";
}

export function buildAutomationWabaCandidates(
  ...values: Array<string | null | undefined>
) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim() ?? "")
        .filter((value) => value.length > 0),
    ),
  );
}

export function selectAutomationTemplateByWaba<
  T extends { wabaId: string | null },
>(templates: T[], preferredWabaIds: string[] = []) {
  for (const wabaId of preferredWabaIds) {
    const template = templates.find((row) => row.wabaId === wabaId);
    if (template) return template;
  }

  return preferredWabaIds.length === 0 ? templates[0] : undefined;
}

function phoneDigits(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits || null;
}

function phoneDigitsMatch(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  const leftDigits = phoneDigits(left);
  const rightDigits = phoneDigits(right);
  if (!leftDigits || !rightDigits) return false;
  return (
    leftDigits === rightDigits ||
    leftDigits.slice(-11) === rightDigits.slice(-11)
  );
}

export function selectAutomationSenderPhone(
  phones: AutomationSenderPhoneCandidate[],
  sellerPhone: string | null,
): AutomationSenderSelection {
  if (sellerPhone) {
    const matchedPhone =
      phones.find((phone) =>
        phoneDigitsMatch(phone.displayPhoneNumber, sellerPhone),
      ) ?? null;
    return matchedPhone
      ? { phone: matchedPhone, source: "seller_phone", blockedReason: null }
      : {
          phone: null,
          source: "seller_phone_not_matched",
          blockedReason: "seller_phone_not_matched",
        };
  }

  const defaultPhone = phones.find((phone) => phone.isDefault) ?? null;
  return defaultPhone
    ? { phone: defaultPhone, source: "default_phone", blockedReason: null }
    : {
        phone: null,
        source: "default_phone_not_configured",
        blockedReason: "default_phone_not_configured",
      };
}
