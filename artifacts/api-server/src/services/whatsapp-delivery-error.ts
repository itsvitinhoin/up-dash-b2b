type MetaWhatsappError = {
  code?: number;
  message?: string;
  title?: string;
  error_data?: {
    details?: string;
  };
};

export function describeWhatsappDeliveryError(error: MetaWhatsappError | null | undefined): string {
  if (error?.code === 131026) {
    return "Meta 131026: o destinatário não pode receber a mensagem. Confirme se o telefone possui WhatsApp, está atualizado e não bloqueou a empresa.";
  }

  const detail =
    error?.error_data?.details ??
    error?.message ??
    error?.title;

  if (detail && error?.code) return `Meta ${error.code}: ${detail}`;
  if (detail) return detail;
  if (error?.code) return `Falha de entrega informada pela Meta (${error.code}).`;
  return "Falha de entrega informada pela Meta.";
}
