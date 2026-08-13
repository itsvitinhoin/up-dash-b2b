# Sync UpZero (pedidos/faturamento) — falhas encontradas em 13/08/2026

Investigação disparada por: MX Fashion reportou Marketing e faturamento
zerados mesmo com conta de anúncio "conectada". Ao checar o job de sync
transacional (`/api/extractions?jobType=upzero_transactional`), descobrimos
que o problema é **sistêmico** — afeta 7 de 8 clientes com integração UpZero,
não só a MX Fashion.

Como conferir o estado atual: `GET /api/extractions?clientId=...` (admin,
já existente em `artifacts/api-server/src/routes/extractions.ts`). Olhar não
só `status`, mas se `result.ordersCreated/ordersUpdated/customersCreated/...`
é maior que zero — um job pode aparecer `"done"` sem ter sincronizado nada.

## 1. Timeout estrutural — ✅ CORRIGIDO em 13/08/2026

**Causa:** o orçamento interno da fase de estoque (`INVENTORY_BUDGET_MS`,
`lib.../upzero-sync.ts`) estava em **60s**, maior que o timeout externo que
envolve `syncUpZeroClient()` inteiro (`UPZERO_TRANSACTIONAL_CLIENT_TIMEOUT_MS`,
`extraction-runner.ts`, **45s**). A fase de busca de imagem de produto não
tinha orçamento nenhum (podia rodar indefinidamente). Resultado: qualquer
cliente com catálogo grande o suficiente pra fase de estoque/imagem demorar
estourava o timeout externo antes de terminar — quase sempre, não só às
vezes.

Evidência (jobs `status: "failed"`, `trigger: "cron"`, 12/08–13/08):

| Cliente | Falhou / Total |
|---|---|
| Sline Spoorte | 12/13 |
| Phize | 12/13 |
| MX Fashion | 12/13 |
| Lipcem | 11/12 |
| Kalli Fashion | 11/12 |
| CELEB | 11/12 |
| Bela Noite | 11/12 |

**Fix aplicado** (`artifacts/api-server/src/services/upzero-sync.ts`):
- `INVENTORY_BUDGET_MS`: 60s → **15s**.
- Nova constante `IMAGE_BUDGET_MS` (**10s**) aplicada à fase de imagem de
  produto, que antes não tinha limite — mesmo padrão de "pula o resto e loga
  não-fatal" já usado na fase de estoque.

**Ainda não confirmado:** se isso sozinho é suficiente pros catálogos maiores
(CELEB, Kalli Fashion) completarem dentro dos 45s. Vale acompanhar
`/api/extractions?jobType=upzero_transactional&status=failed` nos próximos
dias — se continuar falhando, o próximo suspeito é a fase de busca inicial
(`Promise.all` de customers/orders/products/events, até 30s por chamada) ou
o loop de gravação no banco por produto (sequencial, um `await` por produto,
sem batching).

## 2. `TypeError: fetch failed` intermitente — ❌ NÃO INVESTIGADO

Aparece espalhado em quase todo cliente (inclusive nos que majoritariamente
funcionam: Phize, Lipcem, CELEB, MX Fashion), não só nos problemáticos.
Quando acontece cedo na função (na busca inicial via `Promise.all`), derruba
o sync inteiro pro clientId="0 trabalho real" mesmo com `status: "done"`.

Suspeitas a checar: falha de rede intermitente genuína do lado do UpZero,
ou algo no nosso client HTTP (falta de retry, keep-alive, DNS). Não tem
`try/catch` por-endpoint dentro do `Promise.all` inicial — uma falha em
qualquer um dos 4 fetches (customers/orders/products/events) derruba os
outros 3 junto (comportamento padrão do `Promise.all`). Candidato a virar
`Promise.allSettled` com tratamento individual, parecido com o que já existe
pra estoque/imagem.

## 3. Obzee: `401 Unauthorized` em todos os endpoints — ❌ NÃO RESOLVIDO

31 jobs `"done"` seguidos, **zero com trabalho real** — sempre
`UP Zero API error: 401 Unauthorized`. A API key do UpZero desse cliente
(`upZeroApiKey` na tabela `clients`) provavelmente expirou ou foi revogada.
Diferente dos outros: não é timeout, é autenticação. Precisa gerar uma chave
nova com o time da Obzee e atualizar via `PATCH /api/clients/:id`.

## 4. MX Fashion: formato de resposta não reconhecido — ❌ NÃO RESOLVIDO

Aviso já existente no próprio código (`upzero-sync.ts`), disparado algumas
vezes pra esse cliente especificamente:

> "All three UP Zero endpoints returned 0 records with no API error. This
> usually means the response envelope field names do not match
> expectations. Check the server logs for '[upzero-sync]' lines showing the
> actual top-level keys returned by each endpoint, then update
> resolveItems() in upzero-sync.ts."

Ou seja: às vezes a API do UpZero responde 200 OK pra MX Fashion mas com um
envelope de resposta (nomes de campo no nível raiz) diferente do que
`resolveItems()` espera, e o parser silenciosamente conta zero registros
sem erro nenhum. Precisa chamar a API do UpZero pra esse cliente
especificamente (usando a `upZeroApiKey` dele) e comparar o JSON bruto
devolvido com o que `resolveItems()` em `upzero-sync.ts` espera.

## 5. `/api/analytics/orders-page` lento pra QUALQUER cliente UpZero — ✅ CORRIGIDO em 13/08/2026

Achado ao testar o fix do item 1: mesmo clientes que sincronizam bem
(Phize) levavam **~53s** pra abrir a página de Pedidos, mesmo com range de
data pequeno e zero pedidos no resultado. **Não tinha relação com a
migração pra Cloud SQL** (banco respondia rápido, índice existia, sem
esgotamento de conexão — tudo checado e descartado).

**Causa real:** `upzeroAttributionHistoryRange()` (`analytics.ts`) sempre
busca atribuição de campanha do UpZero desde **01/05/2026 fixo** até agora,
**independente do período que o usuário pediu na tela**. Isso é quebrado em
janelas de 12h (`UPZERO_ANALYTICS_CHUNK_MS`) processadas em lotes de 4 por
vez (`UPZERO_ANALYTICS_CONCURRENCY`). De 01/05 até hoje são ~104 dias =
~208 janelas = **52 lotes sequenciais**. Cada dia que passa, essa janela
só cresce (o início é fixo, o fim é "agora") — ou seja, esse endpoint vinha
ficando mais lento progressivamente desde maio, não é uma regressão de
hoje.

**Fix aplicado** (`artifacts/api-server/src/routes/analytics.ts`):
- `UPZERO_ANALYTICS_CONCURRENCY`: 4 → **16** (~13 lotes em vez de 52).
- Novo orçamento de parede `UPZERO_ANALYTICS_FETCH_BUDGET_MS` (**20s**) nos
  dois pontos que fazem esse loop de lotes (`getUpzeroAnalyticsMetricsChunked`
  e `getUpzeroAnalyticsFactsChunked`) — se estourar, para de buscar mais
  janelas e segue com a atribuição parcial já coletada, em vez de travar a
  página inteira. Mesmo padrão usado no item 1.

**Atualização (mesmo dia):** confirmado na prática — mesmo depois do fix
acima, a Kalli Fashion continuava travando `/api/analytics/orders-page`
(40s+, sem resposta) enquanto Phize e MX Fashion melhoraram bem (27s e
11.7s). Causa: as chamadas individuais pra API do UpZero dentro desse
fetch (`getUpzeroAnalyticsMetrics`/`getUpzeroAnalyticsFactsAsMetrics`, em
`services/upzero/analytics-metrics.ts` e `analytics-facts.ts`) não tinham
timeout próprio nenhum — se uma trava de verdade (não só fica lenta), o
orçamento entre lotes nunca chega a rodar porque a função fica presa
esperando essa chamada terminar. **Corrigido**: adicionado
`AbortSignal.timeout(10_000)` nas duas, mesmo padrão já usado em
`upzero-sync.ts`.

**Pergunta em aberto pro produto:** por que a atribuição sempre olha desde
01/05 fixo? Se não há razão de negócio pra isso, o fix de verdade seria
limitar essa janela (ex.: X dias antes do período pedido) em vez de só
tornar a busca mais rápida/resiliente.

**Resultado confirmado em produção após os dois fixes** (`/api/analytics/orders-page`, range de 13 dias):

| Cliente | Antes | Depois |
|---|---|---|
| Phize (range largo, 2000–2026) | nunca completava (>20s, provavelmente 60s+) | 27s |
| MX Fashion | não teria completado | 11.7s |
| CELEB | não teria completado | 16s |
| Kalli Fashion | nunca completava (>60s, `FUNCTION_INVOCATION_TIMEOUT`) | **43s — funciona, mas ainda lento** |

Kalli Fashion segue notavelmente mais lenta que os outros mesmo depois dos
dois fixes — indício de que a API do UpZero é particularmente lenta/instável
especificamente pros dados dessa marca (provavelmente batendo no timeout de
10s por chamada algumas vezes antes de completar dentro do orçamento de
20s). Não é mais uma falha total, mas vale investigar depois se quiser
deixar rápido de verdade.

## Resumo de prioridade sugerida

1. ~~Timeout estrutural (sync)~~ — feito.
2. ~~Orders-page lento (atribuição UpZero)~~ — feito.
3. ~~Timeout por chamada individual na atribuição UpZero~~ — feito.
4. Obzee (401) — mais simples de resolver, só precisa de uma chave nova.
5. MX Fashion (envelope) — precisa investigação ativa na API do UpZero.
6. `fetch failed` intermitente — precisa mais dados/observação pra saber se
   é rede ou código antes de decidir o fix.
