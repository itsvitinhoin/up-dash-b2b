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
