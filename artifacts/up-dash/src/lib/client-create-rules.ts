// Regras do formulário "Novo cliente" (painel B2C). Antes o botão Salvar só liberava com a Nuvemshop E o GA4 completos, o que impedia
// cadastrar um cliente de quem só temos a conta de anúncios (Meta). Agora Nuvemshop e GA4 são opcionais; o mínimo é ter pelo menos uma
// fonte de dados: a Nuvemshop completa OU a conta de anúncios Meta. O servidor já aceitava isso (e os jobs de sync só pegam cliente que
// tem a própria chave), então a trava era só da tela.

export type NewClientForm = {
  dashboardType: "B2B" | "B2C";
  nuvemshopStoreId: string;
  nuvemshopAccessToken: string;
  ga4MeasurementId: string;
  ga4PropertyId: string;
  ga4ApiSecret: string;
  metaAdAccountId: string;
};

const filled = (value: string) => value.trim().length > 0;

export function hasNuvemshop(form: NewClientForm): boolean {
  return filled(form.nuvemshopStoreId) && filled(form.nuvemshopAccessToken);
}

/** Cliente B2C sem Nuvemshop e só com a conta de anúncios Meta. */
export function isAdsOnly(form: NewClientForm): boolean {
  return form.dashboardType === "B2C" && !hasNuvemshop(form) && filled(form.metaAdAccountId);
}

/** O que impede de salvar (texto em português, passa por `tx`), ou `null` se está tudo certo. Só o B2C tem regra extra. */
export function newClientProblem(form: NewClientForm): string | null {
  if (form.dashboardType !== "B2C") return null;
  const nuvemshopCount = [form.nuvemshopStoreId, form.nuvemshopAccessToken].filter(filled).length;
  if (nuvemshopCount === 1) return "Preencha o ID da loja e o token da Nuvemshop juntos, ou deixe os dois em branco.";
  const ga4Count = [form.ga4MeasurementId, form.ga4PropertyId, form.ga4ApiSecret].filter(filled).length;
  if (ga4Count > 0 && ga4Count < 3) return "Preencha os 3 campos do GA4 ou deixe todos em branco.";
  if (!hasNuvemshop(form) && !filled(form.metaAdAccountId)) {
    return "Informe a Nuvemshop completa ou a conta de anúncios Meta (para cliente só de anúncios).";
  }
  return null;
}

/** Plataforma gravada no cliente: B2C sem Nuvemshop vira "Manual" (em vez de "Nuvemshop" sem chave nenhuma). */
export function newClientPlatform(form: NewClientForm): "UPZERO" | "NUVEMSHOP" | "MANUAL" {
  if (form.dashboardType !== "B2C") return "UPZERO";
  return hasNuvemshop(form) ? "NUVEMSHOP" : "MANUAL";
}
