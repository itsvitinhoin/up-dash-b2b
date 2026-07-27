export type ErpOrderStatus =
  | "FATURADO"
  | "PAGO"
  | "PARCIAL"
  | "PENDENTE"
  | "CANCELADO";

export type AttributionState = "ATRIBUIDO" | "ASSISTIDO" | "SEM_ORIGEM";

export interface ErpOrderMock {
  id: string;
  createdAt: string;
  customer: string;
  company: string;
  document: string;
  seller: string;
  status: ErpOrderStatus;
  requestedQuantity: number;
  fulfilledQuantity: number;
  grossAmount: number;
  discountAmount: number;
  shippingAmount: number;
  netAmount: number;
  state: string;
  source: string;
  medium: string;
  campaign: string;
  attribution: AttributionState;
  customerOrigin: "Mídia paga" | "Orgânico" | "Não identificado";
  buyerType: "Novo" | "Recorrente";
}

export interface ErpCustomerMock {
  id: string;
  name: string;
  company: string;
  document: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  firstOrderAt: string;
  lastOrderAt: string;
  orders: number;
  totalSpent: number;
  averageTicket: number;
  daysSinceLastOrder: number;
  segment: "Campeões" | "Leais" | "Potenciais" | "Em risco";
  seller: string;
}

export interface ErpProductMock {
  id: string;
  image: string;
  name: string;
  sku: string;
  category: string;
  color: string;
  size: string;
  units: number;
  revenue: number;
  averagePrice: number;
  discountPct: number;
  stock: number;
  stockCoverageDays: number;
  status: "Saudável" | "Atenção" | "Sem estoque";
}

export const erpDailySeries = [
  { day: "01 Jul", revenue: 12480, orders: 8, attributedRevenue: 7310, spend: 1710 },
  { day: "02 Jul", revenue: 15320, orders: 10, attributedRevenue: 9620, spend: 1890 },
  { day: "03 Jul", revenue: 11890, orders: 7, attributedRevenue: 6290, spend: 1540 },
  { day: "04 Jul", revenue: 17940, orders: 12, attributedRevenue: 11200, spend: 2050 },
  { day: "05 Jul", revenue: 14310, orders: 9, attributedRevenue: 8840, spend: 1760 },
  { day: "06 Jul", revenue: 19670, orders: 13, attributedRevenue: 12890, spend: 2180 },
  { day: "07 Jul", revenue: 16780, orders: 11, attributedRevenue: 10420, spend: 1960 },
];

export const erpOrders: ErpOrderMock[] = [
  {
    id: "MIR-18492",
    createdAt: "07/07/2026 16:42",
    customer: "Marina Duarte",
    company: "Duarte Concept",
    document: "CNPJ **.***.***/****-42",
    seller: "Paula Mendes",
    status: "FATURADO",
    requestedQuantity: 18,
    fulfilledQuantity: 18,
    grossAmount: 4290,
    discountAmount: 210,
    shippingAmount: 160,
    netAmount: 4240,
    state: "SP",
    source: "Instagram",
    medium: "Instagram Stories",
    campaign: "ATACADO | CADASTRO | JULHO",
    attribution: "ATRIBUIDO",
    customerOrigin: "Mídia paga",
    buyerType: "Novo",
  },
  {
    id: "MIR-18488",
    createdAt: "07/07/2026 14:18",
    customer: "Bianca Teles",
    company: "Bia Store",
    document: "CNPJ **.***.***/****-07",
    seller: "Carla Dias",
    status: "PAGO",
    requestedQuantity: 12,
    fulfilledQuantity: 12,
    grossAmount: 2980,
    discountAmount: 120,
    shippingAmount: 0,
    netAmount: 2860,
    state: "MG",
    source: "Meta",
    medium: "Facebook Feed",
    campaign: "RMKT | COMPRADORES | 30D",
    attribution: "ATRIBUIDO",
    customerOrigin: "Mídia paga",
    buyerType: "Recorrente",
  },
  {
    id: "MIR-18481",
    createdAt: "07/07/2026 10:05",
    customer: "Luciana Prado",
    company: "LP Moda",
    document: "CPF ***.***.***-16",
    seller: "Paula Mendes",
    status: "PARCIAL",
    requestedQuantity: 24,
    fulfilledQuantity: 20,
    grossAmount: 5310,
    discountAmount: 265,
    shippingAmount: 190,
    netAmount: 4470,
    state: "GO",
    source: "Google",
    medium: "CPC",
    campaign: "PMax | Atacado | Brasil",
    attribution: "ASSISTIDO",
    customerOrigin: "Mídia paga",
    buyerType: "Recorrente",
  },
  {
    id: "MIR-18476",
    createdAt: "06/07/2026 17:31",
    customer: "Renata Campos",
    company: "Closet RC",
    document: "CNPJ **.***.***/****-93",
    seller: "Carla Dias",
    status: "FATURADO",
    requestedQuantity: 15,
    fulfilledQuantity: 15,
    grossAmount: 3640,
    discountAmount: 0,
    shippingAmount: 140,
    netAmount: 3780,
    state: "BA",
    source: "Direto",
    medium: "Não identificado",
    campaign: "Não identificada",
    attribution: "SEM_ORIGEM",
    customerOrigin: "Não identificado",
    buyerType: "Novo",
  },
  {
    id: "MIR-18469",
    createdAt: "06/07/2026 11:22",
    customer: "Sabrina Leal",
    company: "SL Multimarcas",
    document: "CNPJ **.***.***/****-61",
    seller: "Juliana Reis",
    status: "PENDENTE",
    requestedQuantity: 10,
    fulfilledQuantity: 0,
    grossAmount: 2210,
    discountAmount: 110,
    shippingAmount: 120,
    netAmount: 2220,
    state: "PR",
    source: "Instagram",
    medium: "Instagram Reels",
    campaign: "LOOKALIKE | LOJISTAS | JULHO",
    attribution: "ATRIBUIDO",
    customerOrigin: "Mídia paga",
    buyerType: "Novo",
  },
  {
    id: "MIR-18455",
    createdAt: "05/07/2026 15:09",
    customer: "Fernanda Lopes",
    company: "Fê Fashion",
    document: "CPF ***.***.***-38",
    seller: "Juliana Reis",
    status: "CANCELADO",
    requestedQuantity: 8,
    fulfilledQuantity: 0,
    grossAmount: 1760,
    discountAmount: 0,
    shippingAmount: 90,
    netAmount: 0,
    state: "RJ",
    source: "Orgânico",
    medium: "Social",
    campaign: "Não identificada",
    attribution: "SEM_ORIGEM",
    customerOrigin: "Orgânico",
    buyerType: "Novo",
  },
];

export const erpCustomers: ErpCustomerMock[] = [
  {
    id: "CUS-0182",
    name: "Bianca Teles",
    company: "Bia Store",
    document: "CNPJ **.***.***/****-07",
    email: "bia@biastore.com.br",
    phone: "(31) 99842-1034",
    city: "Belo Horizonte",
    state: "MG",
    firstOrderAt: "14/03/2025",
    lastOrderAt: "07/07/2026",
    orders: 9,
    totalSpent: 26420,
    averageTicket: 2935.56,
    daysSinceLastOrder: 0,
    segment: "Campeões",
    seller: "Carla Dias",
  },
  {
    id: "CUS-0441",
    name: "Luciana Prado",
    company: "LP Moda",
    document: "CPF ***.***.***-16",
    email: "luciana@lpmoda.com.br",
    phone: "(62) 99118-2097",
    city: "Goiânia",
    state: "GO",
    firstOrderAt: "22/08/2025",
    lastOrderAt: "07/07/2026",
    orders: 5,
    totalSpent: 18790,
    averageTicket: 3758,
    daysSinceLastOrder: 0,
    segment: "Leais",
    seller: "Paula Mendes",
  },
  {
    id: "CUS-0810",
    name: "Marina Duarte",
    company: "Duarte Concept",
    document: "CNPJ **.***.***/****-42",
    email: "marina@duarteconcept.com.br",
    phone: "(11) 99238-4421",
    city: "São Paulo",
    state: "SP",
    firstOrderAt: "07/07/2026",
    lastOrderAt: "07/07/2026",
    orders: 1,
    totalSpent: 4240,
    averageTicket: 4240,
    daysSinceLastOrder: 0,
    segment: "Potenciais",
    seller: "Paula Mendes",
  },
  {
    id: "CUS-0794",
    name: "Renata Campos",
    company: "Closet RC",
    document: "CNPJ **.***.***/****-93",
    email: "renata@closetrc.com.br",
    phone: "(71) 99714-8850",
    city: "Salvador",
    state: "BA",
    firstOrderAt: "06/07/2026",
    lastOrderAt: "06/07/2026",
    orders: 1,
    totalSpent: 3780,
    averageTicket: 3780,
    daysSinceLastOrder: 1,
    segment: "Potenciais",
    seller: "Carla Dias",
  },
  {
    id: "CUS-0317",
    name: "Amanda Peixoto",
    company: "A. Peixoto",
    document: "CNPJ **.***.***/****-28",
    email: "contato@apeixoto.com.br",
    phone: "(85) 98820-4109",
    city: "Fortaleza",
    state: "CE",
    firstOrderAt: "11/01/2025",
    lastOrderAt: "02/05/2026",
    orders: 3,
    totalSpent: 9680,
    averageTicket: 3226.67,
    daysSinceLastOrder: 66,
    segment: "Em risco",
    seller: "Juliana Reis",
  },
];

export const erpProducts: ErpProductMock[] = [
  {
    id: "PRD-129",
    image: "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=120&q=80",
    name: "Vestido Midi Serena",
    sku: "VES-SER-2401",
    category: "Vestidos",
    color: "Preto",
    size: "M",
    units: 86,
    revenue: 18490,
    averagePrice: 215,
    discountPct: 4.2,
    stock: 42,
    stockCoverageDays: 14,
    status: "Saudável",
  },
  {
    id: "PRD-218",
    image: "https://images.unsplash.com/photo-1551232864-3f0890e580d9?auto=format&fit=crop&w=120&q=80",
    name: "Conjunto Alfaiataria Maya",
    sku: "CON-MAY-1108",
    category: "Conjuntos",
    color: "Off White",
    size: "G",
    units: 71,
    revenue: 17466,
    averagePrice: 246,
    discountPct: 3.1,
    stock: 18,
    stockCoverageDays: 8,
    status: "Atenção",
  },
  {
    id: "PRD-341",
    image: "https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?auto=format&fit=crop&w=120&q=80",
    name: "Calça Wide Leg Lina",
    sku: "CAL-LIN-3302",
    category: "Calças",
    color: "Marrom",
    size: "M",
    units: 64,
    revenue: 12096,
    averagePrice: 189,
    discountPct: 5.4,
    stock: 0,
    stockCoverageDays: 0,
    status: "Sem estoque",
  },
  {
    id: "PRD-092",
    image: "https://images.unsplash.com/photo-1564257577054-3a1c734cedbc?auto=format&fit=crop&w=120&q=80",
    name: "Blazer Essential",
    sku: "BLA-ESS-0920",
    category: "Blazers",
    color: "Azul Marinho",
    size: "P",
    units: 52,
    revenue: 14560,
    averagePrice: 280,
    discountPct: 2.8,
    stock: 26,
    stockCoverageDays: 16,
    status: "Saudável",
  },
  {
    id: "PRD-404",
    image: "https://images.unsplash.com/photo-1566206091558-7f218b696731?auto=format&fit=crop&w=120&q=80",
    name: "Camisa Tricoline Liz",
    sku: "CAM-LIZ-8814",
    category: "Camisas",
    color: "Rosa",
    size: "M",
    units: 47,
    revenue: 7473,
    averagePrice: 159,
    discountPct: 6.7,
    stock: 9,
    stockCoverageDays: 5,
    status: "Atenção",
  },
];

export const performanceChannels = [
  { channel: "Meta Ads", revenue: 61870, orders: 39, spend: 11090, roas: 5.58 },
  { channel: "Google Ads", revenue: 24940, orders: 17, spend: 5240, roas: 4.76 },
  { channel: "Orgânico", revenue: 19120, orders: 13, spend: 0, roas: 0 },
  { channel: "Direto", revenue: 11680, orders: 8, spend: 0, roas: 0 },
  { channel: "Não identificado", revenue: 5780, orders: 4, spend: 0, roas: 0 },
];

export const performanceBreakdowns = {
  colors: [
    { name: "Preto", value: 28 },
    { name: "Off White", value: 22 },
    { name: "Marrom", value: 18 },
    { name: "Azul", value: 17 },
    { name: "Outras", value: 15 },
  ],
  sizes: [
    { name: "P", value: 24 },
    { name: "M", value: 36 },
    { name: "G", value: 27 },
    { name: "GG", value: 13 },
  ],
  states: [
    { name: "SP", value: 35 },
    { name: "MG", value: 21 },
    { name: "GO", value: 16 },
    { name: "BA", value: 12 },
    { name: "Outros", value: 16 },
  ],
};

export const sourceReconciliation = [
  { label: "Pedidos no ERP", value: 81, detail: "Fonte comercial", tone: "text-blue-400" },
  { label: "Conciliados com e-commerce", value: 72, detail: "88,9% de cobertura", tone: "text-emerald-400" },
  { label: "Atribuídos à mídia", value: 56, detail: "69,1% dos pedidos", tone: "text-violet-400" },
  { label: "Sem correspondência", value: 9, detail: "Requer revisão", tone: "text-amber-400" },
];
