export type WhatsappRecipientValidation = {
  normalized: string | null;
  isValid: boolean;
  reason: string | null;
};

function digitsOnly(value: string | null | undefined) {
  return value?.replace(/\D/g, "") ?? "";
}

export function normalizeWhatsappRecipient(value: string | null | undefined): string | null {
  let digits = digitsOnly(value);
  if (!digits) return null;

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  // UP Zero sends Brazilian numbers in the local DDD + number format.
  if (digits.length === 10 || digits.length === 11) {
    digits = `55${digits}`;
  }

  return digits || null;
}

export function maskWhatsappRecipient(value: string | null | undefined): string {
  const digits = digitsOnly(value);
  if (!digits) return "não informado";
  if (digits.length <= 4) return digits;
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

export function validateWhatsappRecipient(value: string | null | undefined): WhatsappRecipientValidation {
  const normalized = normalizeWhatsappRecipient(value);
  if (!normalized) {
    return {
      normalized: null,
      isValid: false,
      reason: "telefone do destinatário não informado",
    };
  }

  if (!/^[1-9]\d{7,14}$/.test(normalized)) {
    return {
      normalized,
      isValid: false,
      reason: "telefone fora do formato internacional E.164",
    };
  }

  if (!normalized.startsWith("55")) {
    return { normalized, isValid: true, reason: null };
  }

  const nationalNumber = normalized.slice(2);
  if (nationalNumber.length !== 10 && nationalNumber.length !== 11) {
    return {
      normalized,
      isValid: false,
      reason: "telefone brasileiro deve conter DDD e 8 ou 9 dígitos",
    };
  }

  const areaCode = nationalNumber.slice(0, 2);
  if (!/^[1-9]\d$/.test(areaCode)) {
    return {
      normalized,
      isValid: false,
      reason: "DDD brasileiro inválido",
    };
  }

  const subscriberNumber = nationalNumber.slice(2);
  if (subscriberNumber.length === 9 && !subscriberNumber.startsWith("9")) {
    return {
      normalized,
      isValid: false,
      reason: "celular brasileiro com 9 dígitos deve começar por 9",
    };
  }

  if (subscriberNumber.length === 8 && !/^[2-5]/.test(subscriberNumber)) {
    return {
      normalized,
      isValid: false,
      reason: "telefone fixo brasileiro deve começar entre 2 e 5",
    };
  }

  return { normalized, isValid: true, reason: null };
}
