export type WhatsappIntegrationCandidate = {
  id: string;
  wabaId: string | null;
  phoneNumberId: string | null;
};

export type WhatsappPhoneCandidate = {
  integrationId: string | null;
  wabaId: string | null;
  phoneNumberId: string;
};

function isWabaCompatible(
  integration: WhatsappIntegrationCandidate,
  phone: WhatsappPhoneCandidate,
) {
  return !phone.wabaId || !integration.wabaId || phone.wabaId === integration.wabaId;
}

/**
 * Selects an integration only when it belongs to the requested phone/WABA.
 * It intentionally has no client-wide fallback because a token from another
 * WABA may read the wrong templates or send from the wrong business account.
 */
export function selectWhatsappIntegrationForPhone<T extends WhatsappIntegrationCandidate>(
  integrations: T[],
  phone: WhatsappPhoneCandidate,
): T | null {
  if (phone.integrationId) {
    const bound = integrations.find(
      (integration) => integration.id === phone.integrationId && isWabaCompatible(integration, phone),
    );
    if (bound) return bound;
  }

  const exactPhone = integrations.find(
    (integration) =>
      integration.phoneNumberId === phone.phoneNumberId && isWabaCompatible(integration, phone),
  );
  if (exactPhone) return exactPhone;

  if (phone.wabaId) {
    return integrations.find((integration) => integration.wabaId === phone.wabaId) ?? null;
  }

  return null;
}

