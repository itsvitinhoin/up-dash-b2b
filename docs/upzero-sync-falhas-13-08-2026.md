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

**Atualização 14/08/2026 — confirmado insuficiente sozinho:** ver seção 7
abaixo. Combinado com os fixes 2-4 (retry de rede, janela de eventos,
orçamento de páginas), o sync **só passou a completar de verdade pra
Kalli Fashion**. Phize, CELEB, Lipcem e MX Fashion continuam travando nos
60s mesmo com todos os fixes de código aplicados — a causa raiz restante
é a latência do banco (`docs/cloud-sql-regiao-errada-14-08-2026.md`), não
mais um bug de código.

## 2. `TypeError: fetch failed` intermitente — ✅ PARCIALMENTE CORRIGIDO em 13/08/2026

Aparece espalhado em quase todo cliente (inclusive nos que majoritariamente
funcionam: Phize, Lipcem, CELEB, MX Fashion), não só nos problemáticos.
Quando acontece cedo na função (na busca inicial via `Promise.all`), derruba
o sync inteiro pro clientId="0 trabalho real" mesmo com `status: "done"`.

**Fix aplicado**: nova função `fetchWithNetworkRetry()` em `upzero-sync.ts`
— faz 1 retry (com 500ms de espera) especificamente pra erros de rede
(`TypeError`, distinto de timeout/HTTP), aplicado nos dois pontos de busca
paginada principais (`fetchAllPages`, usado por customers/orders/events, e
`fetchAllCursorPages`, usado por products). HTTP 401/404/5xx continuam
propagando na primeira tentativa (retry não ajudaria nesses casos).

**Ainda não corrigido**: não tem `try/catch` por-endpoint dentro do
`Promise.all` inicial em `syncUpZeroClient` — uma falha em qualquer um dos
4 fetches (customers/orders/products/events), mesmo depois de esgotar o
retry, ainda derruba os outros 3 junto (comportamento padrão do
`Promise.all`). Candidato a virar `Promise.allSettled` com tratamento
individual, parecido com o que já existe pra estoque/imagem. Não deu pra
confirmar se o retry sozinho já resolve a maioria dos casos ou se ainda
precisa disso — só vamos saber observando os próximos dias de sync.

## 3. Obzee: `401 Unauthorized` em todos os endpoints — ❌ NÃO RESOLVIDO

31 jobs `"done"` seguidos, **zero com trabalho real** — sempre
`UP Zero API error: 401 Unauthorized`. A API key do UpZero desse cliente
(`upZeroApiKey` na tabela `clients`) provavelmente expirou ou foi revogada.
Diferente dos outros: não é timeout, é autenticação. Precisa gerar uma chave
nova com o time da Obzee e atualizar via `PATCH /api/clients/:id`.

## 4. MX Fashion: formato de resposta não reconhecido — 🟡 DIAGNÓSTICO MELHORADO, causa raiz ainda não confirmada

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
sem erro nenhum.

**Testado em 13/08/2026**: chamei `/external/v1/customers`,
`/external/v1/orders` e `/external/v1/products` direto pra MX Fashion
(usando a `upZeroApiKey` dela) com parâmetros básicos — os três
devolveram `{"data": [...]}` normal, exatamente o formato que
`resolveItems()` já reconhece. **Não reproduzi o problema** — parece
intermitente (talvez só com certos parâmetros de data, ou uma instabilidade
pontual da API do UpZero), não um mismatch estrutural permanente.

**Fix aplicado**: em vez de continuar caçando, o código agora **captura o
diagnóstico de verdade** (chaves de nível raiz devolvidas + de onde os
itens foram resolvidos) e anexa no `result.errors` do job — visível via
`GET /api/extractions?clientId=...`, sem precisar de acesso a log da
Vercel. Da próxima vez que isso acontecer, o diagnóstico completo já vai
estar ali, em vez de só uma instrução genérica pra "checar o log".

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

## 6. Painel `/extractions` escondia jobs "done" sem trabalho real — ✅ CORRIGIDO em 13/08/2026

A página admin de extrações já existia (`artifacts/up-dash/src/pages/extractions.tsx`)
e mostra status/erro por job — mas só lia o campo `error` de nível
superior (preenchido quando o job falha com exceção). Os casos do dia
(Obzee 401, MX Fashion envelope) terminam com `status: "done"` — sem
exceção nenhuma — e o aviso real fica só dentro de `result.errors`, nunca
lido pela tela. Na prática, esses jobs apareciam **verdes**, indistinguíveis
de um sync que funcionou de verdade.

**Fix**: a tabela agora lê `result.errors` mesmo em jobs `"done"`, mostra
badge amarelo "concluído c/ aviso" em vez de verde, e inclui o texto do
aviso na coluna de resultado. Sem precisar consultar a API na mão (como
fizemos a sessão inteira hoje) pra descobrir isso.

## 7. Resultado real do sync (não a leitura, o backfill em si) pós-fixes — 14/08/2026

**Importante — correção de um erro meu:** eu tinha marcado Phize, Lipcem,
CELEB e Kalli Fashion como "confirmados funcionando" mais cedo hoje, mas
essa conclusão veio de testar a *leitura* (`/api/analytics/orders-page`,
seção 5 acima), não o *sync* em si (`POST /clients/:id/sync/upzero`, que é
quem realmente busca dado novo na UpZero e grava no banco). São coisas
diferentes — uma tela pode ficar rápida lendo dado já salvo enquanto o
processo que traria dado novo continua quebrado.

Testado agora, de verdade, disparando o sync manual pra cada um (depois de
TODOS os fixes de código desta e da seção anterior já aplicados):

| Cliente | Resultado |
|---|---|
| Kalli Fashion | ✅ Completa em 43s |
| Phize | ❌ `FUNCTION_INVOCATION_TIMEOUT` aos 60s |
| CELEB | ❌ `FUNCTION_INVOCATION_TIMEOUT` aos 60s |
| Lipcem | ❌ `FUNCTION_INVOCATION_TIMEOUT` aos 60s |
| MX Fashion | ❌ `FUNCTION_INVOCATION_TIMEOUT` aos 60s |

**Conclusão real (14/08, ao longo do dia):** os bugs de código (seções
1-4) eram reais e necessários corrigir, mas não eram suficientes sozinhos
pra clientes com volume maior que o da Kalli Fashion. Em vez de mover o
banco (decisão adiada, ver `docs/cloud-sql-regiao-errada-14-08-2026.md`),
o caminho escolhido foi reduzir drasticamente a QUANTIDADE de idas ao
banco, já que o custo por consulta (~360ms) é fixo mas o número de
consultas não precisava ser um por item.

## 8. Gravação e busca em lote — ✅ CORRIGIDO em 14/08/2026, confirmado nos 4 clientes

Duas rodadas de fix, ambas necessárias:

**Gravação em lote** (`upzero-sync.ts`): produtos, clientes e pedidos
gravavam um item por vez (um `await` por produto/cliente/pedido — com
CELEB tendo até ~250 operações nesse estilo). Reescrito em operações de
lote (`UPDATE ... FROM VALUES` pros grupos de atualização, `INSERT`
multi-linha com fallback linha-a-linha se colidir dentro do próprio
lote) — mesma lógica de decisão, só a gravação virou lote.

**Busca em lote** (orçamento de páginas): depois de corrigir a gravação,
CELEB *ainda* travava — só aí descobrimos que ela tem **milhares de
clientes** (confirmado: 20+ páginas de 200, contagem não terminou).
`fetchAllPages`/`fetchAllCursorPages` não tinham limite de páginas pra
customers/orders/products (só eventos já tinha, do fix de ontem).
Adicionado `budgetMs` em todos, e também no `backfillCustomersByNumericId`
(busca cliente-por-cliente pra preencher lacuna do endpoint de lista —
sem limite nenhum, outro gargalo escondido, achado por último).

**Resultado confirmado em produção, sync real (não só leitura), nos 4
clientes que travavam:**

| Cliente | Antes | Depois | Resultado |
|---|---|---|---|
| CELEB | trava sempre (60s+) | ✅ 33.6s | 216 clientes, 46 produtos, 27 pedidos, 66 itens |
| Phize | trava sempre (60s+) | ✅ 21s | 248 clientes, 64 produtos, 80 pedidos, 236 itens |
| Lipcem | trava sempre (60s+) | ✅ 11s, zero erro | 162 clientes, 60 produtos, 3 pedidos, 26 itens |
| MX Fashion | trava sempre (60s+) | ✅ 33.6s | 200 clientes, 169 produtos, 10 pedidos, 169 itens |

**Ressalva conhecida:** CELEB tem 4000+ clientes reais na UpZero, mas o
orçamento de 15s só cobre uma fração por rodada (confirmado: 216 dessa
vez). Como cada rodada recomeça da página 1 (sem cursor persistido entre
execuções), não é garantido que rodadas futuras cubram clientes das
páginas mais profundas — precisa observar ao longo de vários dias se a
cobertura cresce ou se estabiliza numa fração fixa. Se estabilizar, vale
uma paginação com cursor persistido entre execuções (não implementado
ainda). Mesmo assim, é uma melhora enorme frente ao estado anterior (zero
sync completando).

## Resumo de prioridade sugerida

1. ~~Timeout estrutural (sync)~~ — feito, mas insuficiente sozinho (ver seção 7).
2. ~~Orders-page lento (atribuição UpZero)~~ — feito, isso sim resolvido de verdade (é leitura, não depende tanto de volume).
3. ~~Timeout por chamada individual na atribuição UpZero~~ — feito.
4. ~~`fetch failed` intermitente~~ — retry aplicado, ainda sem confirmação
   se resolve todos os casos.
5. ~~Painel de extrações escondia avisos em jobs "done"~~ — feito.
6. **Obzee (401)** — não dá pra corrigir por código; precisa gerar uma API
   key nova com o time da Obzee e atualizar no cadastro do cliente.
7. **MX Fashion (envelope)** — intermitente, não reproduzido num teste
   direto; o diagnóstico completo agora fica salvo automaticamente da
   próxima vez que acontecer (seção 4 acima), sem precisar caçar de novo.
8. **Sync ainda não completa pra Phize/CELEB/Lipcem/MX Fashion** — bloqueado
   pela região do banco (`docs/cloud-sql-regiao-errada-14-08-2026.md`), não
   é mais bug de código. Dado desses clientes continua desatualizado até lá.
