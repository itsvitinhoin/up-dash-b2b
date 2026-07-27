// Cache em memória simples com TTL, pra evitar bater no BigQuery de novo a
// cada refetch do React Query com os mesmos filtros (BigQuery cobra por
// bytes escaneados e cada query leva ~2-3s). Não sobrevive a restart do
// processo e não é compartilhado entre instâncias — suficiente pra reduzir
// carga de uso normal (usuário navegando/trocando datas), não substitui
// uma solução de cache distribuído se o tráfego crescer bastante.

type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

export async function cached<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value as T;
  }
  const value = await compute();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}
