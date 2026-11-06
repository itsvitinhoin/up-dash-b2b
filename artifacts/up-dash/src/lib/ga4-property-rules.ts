// Regras do campo "Propriedade GA4" na edicao do cliente (painel B2C e B2B).
// O job ga4_daily so precisa do ID NUMERICO da propriedade (Administrador > Detalhes da propriedade); o erro mais comum
// e colar o ID de medicao (G-XXXXXXXX), que serve para enviar eventos e nao para ler relatorios.

export type Ga4PropertyParse = { ok: true; value: string | null } | { ok: false; message: string };

export function parseGa4PropertyInput(raw: string): Ga4PropertyParse {
  const text = raw.trim().replace(/^properties\//i, "").trim();
  // Vazio = remover a propriedade do cliente (o job para de buscar o GA4 dele).
  if (!text) return { ok: true, value: null };
  if (/^G-[A-Z0-9]+$/i.test(text)) {
    return {
      ok: false,
      message: "Isso é o ID de medição (G-…), não o ID da propriedade. Use o número em Administrador → Detalhes da propriedade.",
    };
  }
  if (/^UA-/i.test(text)) {
    return { ok: false, message: "UA-… é do Universal Analytics antigo. Use o ID numérico da propriedade GA4." };
  }
  if (!/^\d{6,15}$/.test(text)) {
    return { ok: false, message: "O ID da propriedade GA4 tem só números (ex.: 387817325)." };
  }
  return { ok: true, value: text };
}

/** Conta de servico do job: precisa ser Leitor da propriedade para o GA4 ser lido. */
export const GA4_READER_ACCOUNT = "928204832932-compute@developer.gserviceaccount.com";
