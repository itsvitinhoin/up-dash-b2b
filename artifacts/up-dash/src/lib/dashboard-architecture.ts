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
    group: "Performance",
    title: "Funil de Conversão",
    legacy: "/funnel",
  },
  {
    path: "/performance/novos-clientes",
    page: "acquisition",
    group: "Performance",
    title: "Novos Clientes",
    legacy: "/performance",
  },
  {
    path: "/performance/cadastros",
    page: "registrations",
    group: "Performance",
    title: "Cadastros",
    legacy: "/customers",
  },
  {
    path: "/performance/anuncios",
    page: "ads",
    group: "Performance",
    title: "Anúncios",
    legacy: "/marketing",
  },
  {
    path: "/performance/jornada",
    page: "attribution",
    group: "Performance",
    title: "Jornada & Atribuição",
    legacy: "/journey",
    b2bOnly: true,
  },
  {
    path: "/ecommerce",
    page: "ecommerce",
    group: "Ecommerce",
    title: "Visão Geral",
    legacy: "/dashboard",
  },
  {
    path: "/ecommerce/pedidos",
    page: "orders",
    group: "Ecommerce",
    title: "Pedidos",
    legacy: "/orders",
  },
  {
    path: "/ecommerce/cadastros",
    page: "registrations",
    group: "Ecommerce",
    title: "Cadastros",
    legacy: "/customers",
  },
  {
    path: "/ecommerce/produtos",
    page: "products",
    group: "Ecommerce",
    title: "Produtos",
    legacy: "/products",
  },
  {
    path: "/ecommerce/estoque",
    page: "stock",
    group: "Ecommerce",
    title: "Estoque",
    legacy: "/stock",
  },
  {
    path: "/ecommerce/vendedores",
    page: "sellers",
    group: "Ecommerce",
    title: "Vendedores",
    legacy: "/sellers",
    b2bOnly: true,
  },
  {
    path: "/ecommerce/geografia",
    page: "geography",
    group: "Ecommerce",
    title: "Geografia",
    legacy: "/geography",
  },
  {
    path: "/ecommerce/inteligencia-clientes",
    page: "customer-intelligence",
    group: "Ecommerce",
    title: "Inteligência de Clientes",
    legacy: "/rfm",
  },
  {
    path: "/ecommerce/historico-mensal",
    page: "monthly-history",
    group: "Ecommerce",
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
