/** Information architecture only. Legacy URLs stay valid. */
export const architectureRoutes = [
  {
    path: "/erp/geografia",
    page: "erp-geography",
    group: "ERP",
    title: "Geografia",
    legacy: "/erp",
    b2bOnly: true,
  },
  {
    path: "/performance/funil",
    page: "performance-funnel",
    group: "Desempenho",
    title: "Funil de Conversão",
    legacy: "/funnel",
  },
  {
    path: "/performance/novos-clientes",
    page: "acquisition",
    group: "Desempenho",
    title: "Novos Clientes",
    legacy: "/performance",
  },
  {
    path: "/performance/cadastros",
    page: "registrations",
    group: "Desempenho",
    title: "Cadastros",
    legacy: "/customers",
  },
  {
    path: "/performance/anuncios",
    page: "ads",
    group: "Desempenho",
    title: "Anúncios",
    legacy: "/marketing",
  },
  {
    path: "/performance/jornada",
    page: "attribution",
    group: "Desempenho",
    title: "Jornada & Atribuição",
    legacy: "/journey",
    b2bOnly: true,
  },
  {
    path: "/ecommerce",
    page: "ecommerce",
    group: "E-commerce",
    title: "Visão Geral",
    legacy: "/dashboard",
  },
  {
    path: "/ecommerce/pedidos",
    page: "orders",
    group: "E-commerce",
    title: "Pedidos",
    legacy: "/orders",
  },
  {
    path: "/ecommerce/cadastros",
    page: "registrations",
    group: "E-commerce",
    title: "Cadastros",
    legacy: "/customers",
  },
  {
    path: "/ecommerce/produtos",
    page: "products",
    group: "E-commerce",
    title: "Produtos",
    legacy: "/products",
  },
  {
    path: "/ecommerce/estoque",
    page: "stock",
    group: "E-commerce",
    title: "Estoque",
    legacy: "/stock",
  },
  {
    path: "/ecommerce/vendedores",
    page: "sellers",
    group: "E-commerce",
    title: "Vendedores",
    legacy: "/sellers",
    b2bOnly: true,
  },
  {
    path: "/ecommerce/geografia",
    page: "geography",
    group: "E-commerce",
    title: "Geografia",
    legacy: "/geography",
  },
  {
    path: "/ecommerce/inteligencia-clientes",
    page: "customer-intelligence",
    group: "E-commerce",
    title: "Inteligência de Clientes",
    legacy: "/rfm",
  },
  {
    path: "/ecommerce/historico-mensal",
    page: "monthly-history",
    group: "E-commerce",
    title: "Histórico Mensal",
    legacy: "/dashboard",
  },
] as const;

export type ArchitecturePage = (typeof architectureRoutes)[number]["page"];
export function architectureForPath(path: string) {
  return architectureRoutes.find((route) => route.path === path);
}
export function legacyPath(path: string): string {
  return architectureForPath(path)?.legacy ?? path;
}
export function navigationPath(path: string): string {
  const old: Record<string, string> = {
    "/": "/dashboard",
    "/orders": "/ecommerce/pedidos",
    "/products": "/ecommerce/produtos",
    "/customers": "/ecommerce/cadastros",
    "/stock": "/ecommerce/estoque",
    "/sellers": "/ecommerce/vendedores",
    "/geography": "/ecommerce/geografia",
    "/rfm": "/ecommerce/inteligencia-clientes",
    "/funnel": "/performance/funil",
    "/marketing": "/performance/anuncios",
    "/journey": "/performance/jornada",
    "/utm": "/performance/jornada",
  };
  if (path.startsWith("/products/")) return "/ecommerce/produtos";
  if (path.startsWith("/customers/")) return "/ecommerce/inteligencia-clientes";
  if (path.startsWith("/sellers/")) return "/ecommerce/vendedores";
  return old[path] ?? path;
}
