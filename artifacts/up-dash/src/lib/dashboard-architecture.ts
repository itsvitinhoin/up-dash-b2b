/**
 * Fatia 2 do redesign: a arquitetura de informacao NOVA (menu reagrupado e URLs como /performance/funil)
 * ainda NAO esta ativa. Este modulo mantem a mesma interface que o app-layout espera, mas sem rotas:
 * o menu e as URLs continuam exatamente como na main. A reorganizacao entra numa fatia propria.
 */
export type ArchitectureRoute = {
  path: string;
  page: string;
  group: string;
  title: string;
  legacy: string;
  b2bOnly?: boolean;
};

export const architectureRoutes: ArchitectureRoute[] = [];

export type ArchitecturePage = string;

export function architectureForPath(_path: string): ArchitectureRoute | undefined {
  return undefined;
}

export function legacyPath(path: string): string {
  return path;
}

export function navigationPath(path: string): string {
  return path === "/" ? "/dashboard" : path;
}
