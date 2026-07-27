export type OrchestratorMetric = {
  label: string;
  value: string;
  detail: string;
  trend?: string;
};

export type OrchestratorBrand = {
  id: string;
  name: string;
  status: "active" | "setup" | "paused";
  commercialMode: "Assistido" | "Rascunho" | "Pausado";
  conversations: number;
  openConversations: number;
  registrations: number;
  approvedRegistrations: number;
  orders: number;
  revenue: number;
  quality: number;
  handoffs: number;
  activeAutomations: number;
};

export type CrmStageId =
  | "new_contact"
  | "no_registration"
  | "qualification"
  | "registration_pending"
  | "registration_approved"
  | "consultative_sale"
  | "waiting_stock"
  | "waiting_payment"
  | "handoff"
  | "closed"
  | "lost";

export type CrmStage = {
  id: CrmStageId;
  label: string;
  description: string;
};

export type CrmCard = {
  id: string;
  brandId: string;
  stage: CrmStageId;
  customer: string;
  phone: string;
  document: string;
  source: string;
  score: number;
  agent: string;
  updatedAt: string;
  lastMessage: string;
  nextAction: string;
  tags: string[];
  value?: string;
};

export type RegistrationStatus = "approved" | "pending" | "rejected" | "draft";

export type RegistrationRow = {
  id: string;
  brandId: string;
  customer: string;
  document: string;
  type: "CPF" | "CNPJ";
  source: string;
  status: RegistrationStatus;
  createdAt: string;
  owner: string;
  nextStep: string;
};

export type AutomationStatus = "ready" | "draft" | "paused" | "needs_review";

export type AutomationCard = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  template: string;
  delay: string;
  status: AutomationStatus;
  sent: number;
  blocked: number;
  conversionRate: string;
};

export type WhatsappTemplateOption = {
  id: string;
  name: string;
  status: "approved" | "pending" | "rejected";
  category: string;
};

export type CommercialRule = {
  id: string;
  name: string;
  description: string;
  value: string;
  owner: string;
};

export type AgentCard = {
  id: string;
  name: string;
  role: string;
  status: "active" | "draft";
  objective: string;
  tone: string;
  limits: string[];
};

export type QualitySignal = {
  title: string;
  value: string;
  status: "good" | "attention" | "risk";
  description: string;
};

export type Insight = {
  title: string;
  description: string;
  action: string;
  impact: string;
};

export type OperationLog = {
  id: string;
  createdAt: string;
  type: string;
  message: string;
  status: "ok" | "blocked" | "review" | "info";
};

export type ClientOperation = {
  brand: OrchestratorBrand;
  agents: AgentCard[];
  quality: QualitySignal[];
  insights: Insight[];
  logs: OperationLog[];
};

export const orchestratorMetrics: OrchestratorMetric[] = [
  { label: "Marcas B2B", value: "4", detail: "3 ativas, 1 em setup", trend: "+1 este mês" },
  { label: "Conversas assistidas", value: "428", detail: "73 aguardando ação", trend: "24h" },
  { label: "Cadastros criados", value: "156", detail: "129 aprovados", trend: "82,7%" },
  { label: "Pedidos influenciados", value: "31", detail: "R$ 18.240 solicitados", trend: "+14%" },
];

export const orchestratorBrands: OrchestratorBrand[] = [
  {
    id: "preview-celeb",
    name: "CELEB",
    status: "active",
    commercialMode: "Assistido",
    conversations: 184,
    openConversations: 27,
    registrations: 92,
    approvedRegistrations: 81,
    orders: 14,
    revenue: 4129.29,
    quality: 91,
    handoffs: 7,
    activeAutomations: 5,
  },
  {
    id: "preview-sline",
    name: "Sline Sports",
    status: "setup",
    commercialMode: "Rascunho",
    conversations: 96,
    openConversations: 16,
    registrations: 38,
    approvedRegistrations: 25,
    orders: 8,
    revenue: 2980.5,
    quality: 74,
    handoffs: 5,
    activeAutomations: 2,
  },
  {
    id: "preview-cocci",
    name: "Cocci",
    status: "active",
    commercialMode: "Assistido",
    conversations: 112,
    openConversations: 19,
    registrations: 21,
    approvedRegistrations: 18,
    orders: 6,
    revenue: 2460,
    quality: 86,
    handoffs: 4,
    activeAutomations: 4,
  },
  {
    id: "preview-up-store",
    name: "UP Store",
    status: "paused",
    commercialMode: "Pausado",
    conversations: 36,
    openConversations: 11,
    registrations: 5,
    approvedRegistrations: 5,
    orders: 3,
    revenue: 870,
    quality: 62,
    handoffs: 3,
    activeAutomations: 0,
  },
];

export const crmStages: CrmStage[] = [
  { id: "new_contact", label: "Novo contato", description: "Primeira mensagem recebida" },
  { id: "no_registration", label: "Sem cadastro", description: "Lead ainda não iniciou cadastro" },
  { id: "qualification", label: "Qualificação", description: "Validando perfil B2B" },
  { id: "registration_pending", label: "Cadastro pendente", description: "Dados enviados e aguardando análise" },
  { id: "registration_approved", label: "Cadastro aprovado", description: "Cliente pode comprar" },
  { id: "consultative_sale", label: "Venda consultiva", description: "Dúvidas de produto, grade e mix" },
  { id: "waiting_stock", label: "Aguardando estoque", description: "Disponibilidade pendente" },
  { id: "waiting_payment", label: "Aguardando pagamento", description: "Pedido criado, pagamento pendente" },
  { id: "handoff", label: "Handoff", description: "Humano precisa assumir" },
  { id: "closed", label: "Fechado", description: "Atendimento resolvido" },
  { id: "lost", label: "Perdido", description: "Sem resposta ou sem fit" },
];

export const crmCards: CrmCard[] = [
  {
    id: "crm-1",
    brandId: "preview-celeb",
    stage: "new_contact",
    customer: "Thaísa Soares Atacado",
    phone: "+55 11 98888-0101",
    document: "CNPJ ****0001",
    source: "Instagram Ads",
    score: 71,
    agent: "Prospecção",
    updatedAt: "2026-06-09T11:20:00-03:00",
    lastMessage: "Queria saber como comprar no atacado.",
    nextAction: "Validar CNPJ e enviar link de cadastro",
    tags: ["Novo lead", "Empresa"],
  },
  {
    id: "crm-2",
    brandId: "preview-celeb",
    stage: "qualification",
    customer: "Malu Concept",
    phone: "+55 21 97777-0144",
    document: "CNPJ ****4420",
    source: "WhatsApp orgânico",
    score: 64,
    agent: "Qualificação",
    updatedAt: "2026-06-09T10:02:00-03:00",
    lastMessage: "Tenho loja feminina, vocês vendem grade fechada?",
    nextAction: "Confirmar segmento e pedido mínimo",
    tags: ["Vestuário", "Pedido mínimo"],
  },
  {
    id: "crm-3",
    brandId: "preview-celeb",
    stage: "registration_pending",
    customer: "Rosângela Damasceno",
    phone: "+55 11 95555-8877",
    document: "CPF ****9912",
    source: "Meta Ads",
    score: 82,
    agent: "Cadastro",
    updatedAt: "2026-06-09T09:42:00-03:00",
    lastMessage: "Já enviei meus dados, consegue ver se foi aprovado?",
    nextAction: "Checar retorno do UP Zero",
    tags: ["Cadastro enviado", "Alta intenção"],
  },
  {
    id: "crm-4",
    brandId: "preview-celeb",
    stage: "registration_approved",
    customer: "Fernanda Lima",
    phone: "+55 11 96666-3030",
    document: "CPF ****1830",
    source: "Campanha UP.ZERO",
    score: 91,
    agent: "Vendas",
    updatedAt: "2026-06-09T08:55:00-03:00",
    lastMessage: "Meu cadastro foi aprovado, como vejo os produtos?",
    nextAction: "Enviar catálogo e sugerir primeira compra",
    tags: ["Aprovado", "Sem pedido"],
  },
  {
    id: "crm-5",
    brandId: "preview-celeb",
    stage: "consultative_sale",
    customer: "Mariana Garcia",
    phone: "+55 11 94444-1212",
    document: "CNPJ ****2301",
    source: "Remarketing",
    score: 88,
    agent: "Vendas",
    updatedAt: "2026-06-09T08:12:00-03:00",
    lastMessage: "Separa 12 peças e vê cor/tamanho pra mim?",
    nextAction: "Confirmar disponibilidade e valor solicitado",
    tags: ["Negociação", "Mix"],
    value: "R$ 1.240",
  },
  {
    id: "crm-6",
    brandId: "preview-celeb",
    stage: "waiting_payment",
    customer: "Izabela Soares",
    phone: "+55 31 98888-5544",
    document: "CNPJ ****7781",
    source: "Meta Ads",
    score: 94,
    agent: "Vendas",
    updatedAt: "2026-06-08T17:30:00-03:00",
    lastMessage: "Pedido gerado, vou finalizar o pagamento hoje.",
    nextAction: "Acompanhar pagamento sem pressionar",
    tags: ["Pedido criado", "Pagamento"],
    value: "R$ 2.180",
  },
  {
    id: "crm-7",
    brandId: "preview-sline",
    stage: "handoff",
    customer: "Loja Ponto Fit",
    phone: "+55 11 91111-0022",
    document: "CNPJ ****6670",
    source: "Google Ads",
    score: 58,
    agent: "Vendas",
    updatedAt: "2026-06-08T15:10:00-03:00",
    lastMessage: "Preciso negociar prazo e frete.",
    nextAction: "Humano assumir condições comerciais",
    tags: ["Frete", "Handoff"],
  },
];

export const registrations: RegistrationRow[] = [
  {
    id: "reg-1",
    brandId: "preview-celeb",
    customer: "Thaísa Soares Atacado",
    document: "CNPJ ****0001",
    type: "CNPJ",
    source: "Instagram Ads",
    status: "pending",
    createdAt: "2026-06-09T11:03:00-03:00",
    owner: "Agente de Prospecção",
    nextStep: "Aguardar análise do cadastro",
  },
  {
    id: "reg-2",
    brandId: "preview-celeb",
    customer: "Fernanda Lima",
    document: "CPF ****1830",
    type: "CPF",
    source: "Campanha UP.ZERO",
    status: "approved",
    createdAt: "2026-06-09T08:32:00-03:00",
    owner: "Agente de Cadastro",
    nextStep: "Enviar catálogo aprovado",
  },
  {
    id: "reg-3",
    brandId: "preview-sline",
    customer: "Loja Ponto Fit",
    document: "CNPJ ****6670",
    type: "CNPJ",
    source: "Google Ads",
    status: "draft",
    createdAt: "2026-06-08T15:02:00-03:00",
    owner: "Agente de Prospecção",
    nextStep: "Completar dados fiscais",
  },
  {
    id: "reg-4",
    brandId: "preview-cocci",
    customer: "Boutique Maria Flor",
    document: "CNPJ ****9101",
    type: "CNPJ",
    source: "WhatsApp orgânico",
    status: "rejected",
    createdAt: "2026-06-07T18:21:00-03:00",
    owner: "Agente de Cadastro",
    nextStep: "Humano revisar motivo de recusa",
  },
];

export const automations: AutomationCard[] = [
  {
    id: "registration_requested",
    name: "Cadastro Solicitado",
    enabled: true,
    trigger: "Lead solicita cadastro ou envia CNPJ/CPF",
    template: "Orientação de cadastro",
    delay: "Imediato",
    status: "ready",
    sent: 64,
    blocked: 3,
    conversionRate: "41%",
  },
  {
    id: "registration_approved",
    name: "Cadastro Aprovado",
    enabled: true,
    trigger: "UP Zero retorna cadastro aprovado",
    template: "Boas-vindas + catálogo",
    delay: "5 min",
    status: "ready",
    sent: 52,
    blocked: 8,
    conversionRate: "28%",
  },
  {
    id: "cart_abandoned",
    name: "Carrinho Abandonado",
    enabled: false,
    trigger: "Carrinho sem pedido por 2h",
    template: "Recuperação assistida",
    delay: "2h",
    status: "draft",
    sent: 0,
    blocked: 0,
    conversionRate: "-",
  },
  {
    id: "checkout_abandoned",
    name: "Checkout Abandonado",
    enabled: false,
    trigger: "Checkout iniciado sem pedido",
    template: "Dúvida de pagamento/frete",
    delay: "1h",
    status: "needs_review",
    sent: 0,
    blocked: 0,
    conversionRate: "-",
  },
  {
    id: "purchase_requested",
    name: "Compra Solicitada",
    enabled: true,
    trigger: "Pedido solicitado no e-commerce",
    template: "Confirmação de solicitação",
    delay: "Imediato",
    status: "ready",
    sent: 31,
    blocked: 1,
    conversionRate: "100%",
  },
  {
    id: "order_fulfilled",
    name: "Pedido Atendido",
    enabled: true,
    trigger: "Pedido com quantidade atendida",
    template: "Resumo de atendimento",
    delay: "10 min",
    status: "ready",
    sent: 18,
    blocked: 2,
    conversionRate: "74%",
  },
  {
    id: "order_shipped",
    name: "Pedido Enviado",
    enabled: false,
    trigger: "Pedido enviado",
    template: "Rastreio do pedido",
    delay: "Imediato",
    status: "paused",
    sent: 0,
    blocked: 0,
    conversionRate: "-",
  },
  {
    id: "payment_confirmed",
    name: "Pagamento Confirmado",
    enabled: true,
    trigger: "Pagamento aprovado",
    template: "Pagamento confirmado",
    delay: "Imediato",
    status: "ready",
    sent: 22,
    blocked: 0,
    conversionRate: "91%",
  },
];

export const whatsappTemplateOptions: WhatsappTemplateOption[] = [
  { id: "tpl-registration-guide", name: "Orientação de cadastro", status: "approved", category: "UTILITY" },
  { id: "tpl-approved-catalog", name: "Boas-vindas + catálogo", status: "approved", category: "UTILITY" },
  { id: "tpl-cart-recovery", name: "Recuperação assistida", status: "pending", category: "MARKETING" },
  { id: "tpl-payment-confirmed", name: "Pagamento confirmado", status: "approved", category: "UTILITY" },
  { id: "tpl-shipping-tracking", name: "Rastreio do pedido", status: "approved", category: "UTILITY" },
];

export const commercialRules: CommercialRule[] = [
  {
    id: "qualification",
    name: "Lead qualificado",
    description: "Quando considerar que o contato é uma oportunidade B2B válida.",
    value: "Contato informa CNPJ, loja, revenda ou intenção clara de compra no atacado.",
    owner: "Agente de Prospecção",
  },
  {
    id: "handoff",
    name: "Handoff humano",
    description: "Quando o agente deve parar e pedir intervenção humana.",
    value: "Preço, frete, prazo, negociação, exceções comerciais ou reclamações.",
    owner: "Gestor comercial",
  },
  {
    id: "lost",
    name: "Lead perdido",
    description: "Quando classificar uma conversa como perdida.",
    value: "24 horas sem resposta após follow-up final ou cliente sem fit de atacado.",
    owner: "Agente de Qualidade",
  },
  {
    id: "catalog",
    name: "Envio de catálogo",
    description: "Regra para disponibilizar link do site/catálogo.",
    value: "Enviar somente após cadastro aprovado ou orientação explícita do gestor.",
    owner: "Agente de Vendas",
  },
];

export const agents: AgentCard[] = [
  {
    id: "prospecting",
    name: "Agente de Prospecção",
    role: "Primeiro atendimento e qualificação",
    status: "active",
    objective: "Entender se o contato é lojista, orientar cadastro e reduzir tempo de resposta.",
    tone: "Objetivo, educado e consultivo",
    limits: ["Não aprova cadastro", "Não informa condição especial", "Não envia mensagem sem política ativa"],
  },
  {
    id: "sales",
    name: "Agente de Vendas",
    role: "Apoio comercial consultivo",
    status: "active",
    objective: "Apoiar dúvidas de mix, cor, tamanho, estoque e pedido solicitado.",
    tone: "Comercial, direto e prestativo",
    limits: ["Não cria pedido sozinho", "Não altera estoque", "Handoff em negociação de preço"],
  },
  {
    id: "quality",
    name: "Agente de Qualidade",
    role: "Auditoria e melhoria de operação",
    status: "draft",
    objective: "Monitorar conversas sem resposta, risco de perda e etapas travadas.",
    tone: "Analítico",
    limits: ["Não conversa com clientes", "Apenas recomenda ações"],
  },
];

export const qualitySignals: QualitySignal[] = [
  {
    title: "SLA de primeira resposta",
    value: "93%",
    status: "good",
    description: "Conversas respondidas dentro da meta de 5 minutos.",
  },
  {
    title: "Handoffs pendentes",
    value: "7",
    status: "attention",
    description: "Casos que precisam de decisão humana.",
  },
  {
    title: "Bloqueios de guardrail",
    value: "14",
    status: "attention",
    description: "Mensagens que não deveriam sair sem revisão.",
  },
  {
    title: "Risco de perda",
    value: "4",
    status: "risk",
    description: "Leads sem resposta há mais de 24h.",
  },
];

export const insights: Insight[] = [
  {
    title: "Cadastro aprovado sem pedido",
    description: "Há 18 clientes aprovados sem pedido. O próximo passo ideal é enviar catálogo com mix inicial.",
    action: "Criar sequência assistida",
    impact: "Pode aumentar primeira compra",
  },
  {
    title: "Perguntas de frete geram handoff",
    description: "Frete aparece em 42% dos atendimentos que travam. Vale padronizar uma resposta base.",
    action: "Criar template de frete",
    impact: "Reduz tempo humano",
  },
  {
    title: "Carrinho abandonado ainda está em rascunho",
    description: "A automação existe, mas está pausada. Ative primeiro em modo aprovação humana.",
    action: "Testar com 10 leads",
    impact: "Baixo risco",
  },
];

export const operationLogs: OperationLog[] = [
  {
    id: "log-1",
    createdAt: "2026-06-09T11:22:00-03:00",
    type: "classificação",
    message: "Thaísa Soares movida para Novo contato por intenção de atacado.",
    status: "ok",
  },
  {
    id: "log-2",
    createdAt: "2026-06-09T10:48:00-03:00",
    type: "guardrail",
    message: "Mensagem com condição comercial bloqueada para revisão humana.",
    status: "blocked",
  },
  {
    id: "log-3",
    createdAt: "2026-06-09T09:55:00-03:00",
    type: "cadastro",
    message: "Fernanda Lima aprovada e adicionada à automação de boas-vindas.",
    status: "review",
  },
  {
    id: "log-4",
    createdAt: "2026-06-08T17:35:00-03:00",
    type: "pedido",
    message: "Pedido de Izabela aguardando pagamento, sem envio automático.",
    status: "info",
  },
];

export function getClientOperation(clientId: string): ClientOperation {
  const brand = orchestratorBrands.find((item) => item.id === clientId) ?? orchestratorBrands[0];
  return {
    brand,
    agents,
    quality: qualitySignals,
    insights,
    logs: operationLogs,
  };
}
