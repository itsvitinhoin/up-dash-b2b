export type WhatsappConnectionOperationalStatus =
  | "healthy"
  | "warning"
  | "error";

export type WhatsappConnectionHealthInput = {
  phoneWabaId: string | null;
  integrationStatus: string | null;
  hasAccessToken: boolean;
  tokenError: string | null;
  lastSuccessfulDispatchAt: Date | null;
  lastFailureAt: Date | null;
  lastFailureMessage: string | null;
};

export type WhatsappConnectionHealth = {
  status: WhatsappConnectionOperationalStatus;
  message: string;
  lastDispatchAt: Date | null;
};

function latestDate(first: Date | null, second: Date | null) {
  if (!first) return second;
  if (!second) return first;
  return first.getTime() >= second.getTime() ? first : second;
}

export function deriveWhatsappConnectionHealth(
  input: WhatsappConnectionHealthInput,
): WhatsappConnectionHealth {
  const lastDispatchAt = latestDate(
    input.lastSuccessfulDispatchAt,
    input.lastFailureAt,
  );

  if (!input.phoneWabaId) {
    return {
      status: "error",
      message: "WABA não identificado para este número.",
      lastDispatchAt,
    };
  }

  if (!input.hasAccessToken) {
    return {
      status: "error",
      message:
        "Token ausente para a WABA deste número. Reconecte somente esta conta.",
      lastDispatchAt,
    };
  }

  if (input.integrationStatus === "failed" || input.tokenError) {
    return {
      status: "error",
      message: input.tokenError ?? "A conexão com a Meta está com erro.",
      lastDispatchAt,
    };
  }

  const failureIsLatest = Boolean(
    input.lastFailureAt &&
    (!input.lastSuccessfulDispatchAt ||
      input.lastFailureAt.getTime() >=
        input.lastSuccessfulDispatchAt.getTime()),
  );
  if (failureIsLatest) {
    return {
      status: "error",
      message: input.lastFailureMessage ?? "O último disparo apresentou erro.",
      lastDispatchAt,
    };
  }

  if (input.integrationStatus !== "connected") {
    return {
      status: "warning",
      message: "Conexão aguardando confirmação da Meta.",
      lastDispatchAt,
    };
  }

  return {
    status: "healthy",
    message: input.lastSuccessfulDispatchAt
      ? "Conexão ativa e último disparo aceito pela Meta."
      : "Conexão ativa; nenhum disparo registrado ainda.",
    lastDispatchAt,
  };
}
