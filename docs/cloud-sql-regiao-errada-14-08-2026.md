# Cloud SQL na região errada — achado 14/08/2026

**Resumo em uma frase:** o banco Cloud SQL (pra onde migramos em 12-13/08) foi
criado em `us-central1` (Iowa, EUA), mas os servidores da Vercel que rodam o
UpDash ficam em São Paulo (`gru1`) — toda query paga ~300-400ms de latência de
rede pura, contra os <20ms que a Supabase (também em São Paulo) tinha. Isso
não é um bug de código, é distância física.

## Como foi descoberto

Durante a investigação de por que a MX Fashion continuava com o sync de
pedidos travando mesmo depois de três rodadas de fix (orçamento de
estoque/imagem, janela de eventos, orçamento de paginação — ver
`upzero-sync-falhas-13-08-2026.md`), todos os testes diretos na API do
UpZero (feitos deste computador) completavam rápido — 1 a 2 segundos cada.
Isso não batia com o servidor continuar travando em 45-60s.

Suspeita: não é a busca de dado que é lenta, é a gravação no banco — mas
paralelizar as gravações não adiantaria nada porque o pool de conexão usa
`max: 1` por instância serverless (uma única conexão física, tudo se
enfileira nela de qualquer jeito). Antes de mudar algo, medimos o custo
real por query, direto do ambiente de produção:

```
30 queries triviais (SELECT 1) sequenciais, mesma conexão do sync:
totalMs: 10.841 | avgMsPerQuery: 361,37ms
```

Uma query desse tipo deveria levar menos de 20ms quando servidor e banco
estão na mesma região. 361ms é ~18x mais lento.

## Por que — a causa geográfica

- Vercel roda os servidores do UpDash na região `gru1` — confirmado pelos
  IDs de erro (`gru1::rm9dn-...`, `gru1::tnbcs-...`, etc, aparecendo em
  todo `FUNCTION_INVOCATION_TIMEOUT` de hoje). `gru` é o código do
  aeroporto de Guarulhos — região São Paulo.
- O Cloud SQL (`up-vesti-report:us-central1:vesti-database`) está em
  `us-central1` — Iowa, EUA. ~9.600 km de São Paulo.
- A Supabase antiga rodava no pooler `aws-1-sa-east-1.pooler.supabase.com`
  — São Paulo, a mesma cidade dos servidores da Vercel. Por isso nunca
  teve esse problema.
- Esse detalhe de latência por região não foi considerado durante o
  planejamento da migração (`migracao-supabase-cloud-sql.md`, que focou em
  `max_connections`, paridade de dado e RLS — nunca menciona região).

## Impacto real

Não é específico do sync da UpZero — **é toda a aplicação**. Toda query,
em toda página, paga esse imposto de ~300-400ms extra. A diferença é
quantas queries cada tela faz:

- Telas com poucas queries (2-3): ainda ficam abaixo de 1s, quase
  imperceptível.
- Telas/jobs com muitas queries sequenciais (sync de pedidos, orders-page
  com atribuição): multiplicam o atraso — 300+ queries × 360ms passa
  fácil de 1-2 minutos, estourando o timeout de 45-60s da Vercel.

Isso explica por que só os fixes de "quantidade de query" (orçamento,
janela de data, paginação) não foram suficientes sozinhos pra MX Fashion e
clientes parecidos — reduzem a conta, mas não zeram ela.

## O que os fixes de hoje ainda valem

Todos os fixes aplicados em 13-14/08 (documentados em
`upzero-sync-falhas-13-08-2026.md`) continuam corretos e válidos — eles
reduzem **quantas** queries/chamadas são feitas, o que ajuda
independente da região do banco. Só não são suficientes sozinhos pra
zerar o problema quando o cliente precisa de centenas de operações.

## Opções consideradas em 14/08/2026 (conversa com o Marcelo)

**A) Recriar a instância Cloud SQL em `southamerica-east1`** (a região do
Google mais perto de São Paulo) e migrar os dados de novo. Resolve de vez,
qualquer consulta em qualquer tela — inclusive problemas que ainda não
descobrimos. Mas é repetir o processo de corte inteiro (dump/restore +
env vars + redeploy), com o mesmo tipo de risco desta semana.

⚠️ **Bloqueio real descoberto:** a instância `vesti-database` **não é
exclusiva do UpDash** — o próprio doc de migração já registrava que ela é
"compartilhada com outros bancos (upflow, etc)", além de sobras de um
projeto Prisma de terceiros (`prisma_migrate_shadow_db_*`). **Antes de
qualquer plano de mover/recriar essa instância**, precisa descobrir quem
mais usa ela, onde esses sistemas rodam, e se mudar a região ajuda ou
atrapalha eles. Isso não é algo que dá pra decidir só olhando o código do
UpDash — precisa perguntar pro time quem mantém o "upflow".

**B) Não mexer no banco — reduzir a quantidade de queries no código.**
Em vez de mover infraestrutura compartilhada, atacar os pontos que fazem
muitas consultas pequenas em vez de poucas grandes (o mesmo padrão do
fix do `/orchestrator/overview` de hoje: 45s com erro → 1,28s, só
reescrevendo consultas em lote). O sync de pedidos UpZero tem esse mesmo
padrão — grava produto/cliente/pedido um de cada vez; dá pra reescrever
pra gravar em lote, reduzindo de ~300 queries pra ~15-20 por sync.

**C) Mover o app inteiro (não só o banco) pra Google Cloud**, no mesmo
projeto/região do Cloud SQL. Resolveria de vez e ainda destravaria o
scheduler noturno que hoje nunca roda em produção (`services/scheduler.ts`,
só funciona no entrypoint `src/index.ts`, que a Vercel não usa). Mas é um
projeto de infraestrutura bem maior — reconstruir deploy automático,
HTTPS/domínio, CDN, preview de branch, tudo que a Vercel hoje dá de
graça. Não é decisão pra tomar no meio de uma resposta a incidente.

## Decisão atual (14/08/2026)

Seguir com a **opção B agora** (reescrever o sync UpZero pra gravação em
lote) — não mexe em infraestrutura compartilhada, resolve o que está
quebrado hoje (Phize, CELEB, Lipcem, MX Fashion). A **opção A** fica como
projeto de médio prazo, condicionada a mapear antes quem mais usa a
instância compartilhada. A **opção C** fica só registrada como ideia de
longo prazo, sem compromisso de fazer.
