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

## O que resolve de verdade

Recriar a instância Cloud SQL numa região próxima a São Paulo —
`southamerica-east1` (a região do Google mais perto, fisicamente em São
Paulo) — e migrar os dados pra lá. Na prática é repetir o processo de
corte feito em 12-13/08 (dump/restore + trocar env vars + redeploy), só
que apontando a nova instância pra região certa dessa vez.

**Ainda não decidido / não feito.** Fica pendente até decisão conjunta
sobre quando e como fazer esse segundo corte.
