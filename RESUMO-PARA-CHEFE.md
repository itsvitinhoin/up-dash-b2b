# Resumo — integração Vesti no UP Dash B2B

Status do que foi levantado/feito até agora. Atualizado conforme o trabalho avança.

## Objetivo

Trazer os clientes que hoje rodam no `backend-dash` (produção, dados reais
via BigQuery) para dentro do `up-dash-b2b` (o projeto novo), com prioridade
nos clientes da **Vesti**. Meta maior: sair do Supabase.

## O que foi confirmado

- O `up-dash-b2b` já está rodando localmente (banco, backend, frontend) —
  ambiente de dev funcional.
- As métricas do `backend-dash` são **reais**: sync automático (Cloud
  Scheduler + Cloud Run Job) puxa Vesti/Nuvemshop/Braavo/GA4/Meta Ads e
  grava no BigQuery. Único ponto de atenção: o funil GA4 do `up-dash-b2b`
  atual é consultado ao vivo (não via job) e falha silenciosamente se a
  API do Google cair — vale corrigir em algum momento.
- Mapeamos os 3 sistemas envolvidos e como se conectam:
  1. **`script-vesti-nuvem`** (Python) — puxa os dados das APIs de origem
     e grava no BigQuery. Roda como Cloud Run Job, disparado por Cloud
     Scheduler (job diário incremental + backfill sob demanda).
  2. **`backend-dash`** (Fastify/produção) — serve o dashboard atual lendo
     do BigQuery. Usa uma instância Cloud SQL (`vesti-database`, projeto
     `up-vesti-report`) só pra dado operacional (login, cadastro de
     cliente).
  3. **`up-dash-b2b`** (projeto novo) — hoje só sabe ler Nuvemshop/UpZero
     do Postgres próprio dele. Ainda não tem nada de Vesti/BigQuery.
- **Acesso direto confirmado ao BigQuery** (usando a credencial já
  existente no `script-vesti-nuvem`) — dados reais, exemplo: cliente
  "Le Ricard" tem 7.658 pedidos, 2.476 produtos, 16.650 clientes
  sincronizados.
- Existe uma tabela **já pronta pra dashboard** no lado Vesti
  (`dashboard_vendas_cache_final`, uma linha por item de pedido, já
  achatada) — isso simplifica bastante a integração desse lado.
- O lado Nuvemshop no BigQuery **não** tem essa tabela pronta (dados mais
  crus/aninhados) — provável que continue sendo mais simples manter o
  sync próprio que o `up-dash-b2b` já tem pra Nuvemshop, e só trazer Vesti
  via BigQuery.

## Decisões já tomadas

- O `up-dash-b2b` vai usar a **mesma instância Cloud SQL** que o
  `backend-dash` já usa (`vesti-database`), mas num **database separado**
  — não vamos misturar as tabelas de login dos dois sistemas.
- Dado analítico (pedidos, produtos, clientes) do lado Vesti vai ser lido
  **direto do BigQuery**, sem duplicar num Postgres local.

## Primeiro cliente Vesti funcionando de ponta a ponta

Implementamos e testamos com **dado real** (cliente "Le Ricard", não é
mock): criei um client de teste no `up-dash-b2b` apontando pro dataset
`le_ricard` do BigQuery, logei como esse cliente no dashboard, e os números
batem exatamente com uma consulta direta ao BigQuery — receita de
R$496.418,79, 101 pedidos pagos de 131 solicitados (77,1% de aprovação),
89 clientes no período de 28/06 a 27/07/2026.

O que foi construído:
- Client do BigQuery no backend do `up-dash-b2b`, lendo a mesma
  `dashboard_vendas_view` que o `backend-dash` já usa em produção (fonte
  viva, não uma tabela de cache desatualizada)
- Novo campo pra vincular cada cliente ao dataset certo do BigQuery
- A tela de dashboard B2B (a mesma que já existia) passou a funcionar sem
  nenhuma mudança visual — só trocamos de onde o dado vem quando o cliente
  é do tipo Vesti

## Primeiro cliente Vesti oficial cadastrado (27/07/2026)

Não é mais só teste: cadastramos a **Namine** — um cliente Vesti real, com
o login que ele já usa hoje em produção (mesma senha, não precisou
resetar nada, porque os dois sistemas usam o mesmo tipo de criptografia de
senha). Consulta ao BigQuery confirmou dado real e atualizado (até
26/07/2026): R$105.538,20 de receita, 38 pedidos no último mês.

Só falta o próprio cliente (ou o Marcelo) testar o login pela tela — não
temos a senha em texto puro pra fazer esse teste por vocês.

## Dashboard Vesti fechado (23/07/2026)

Completamos os itens que faltavam:
- Filtros por categoria e canal funcionando (testado: filtrar por uma
  categoria específica derrubou de 208 pra 129 pedidos, número batendo
  certinho)
- Gráfico "Top categories" mostrando receita real por categoria de produto
- Alerta automático de "regiões em alta" (ex: "RJ +60%, ES +59%, MG +29%
  essa semana") — confirmado aparecendo na tela
- Cache de consulta: primeira vez ~3,3s (bate no BigQuery), buscas
  repetidas com os mesmos filtros ~0,08s (quase 40x mais rápido)

Tudo confirmado visualmente no dashboard de verdade, não só por trás dos
panos — sem nenhuma mudança na tela pro usuário final, só a origem do dado
que mudou.

## "Clientes atribuídos às campanhas" agora funciona pra Vesti também

Usando a mesma lógica que já existe no `backend-dash` (as tabelas
`clientes_atribuidos_consolidados` e `pedidos_atribuidos_consolidados`,
que já classificam automaticamente cada cliente como "Novo Lead" ou
"Re-impacto" com base em quando foi tocado por um anúncio da agência vs
quando se cadastrou). Testado com a Namine: 30 clientes atribuídos,
R$2.183,80 de receita atribuída, confirmado batendo com o dado real do
BigQuery. Único ponto de atenção: aqui não temos o mesmo nível de detalhe
por campanha/UTM que a UpZero tem — só a classificação novo/re-impacto.

**Fora do escopo por enquanto** (não afeta o dashboard principal, mas vale
saber): o filtro por vendedora funciona se um nome for passado, mas o menu
de seleção ainda não lista as vendedoras da Vesti (isso busca de uma
tabela que hoje só tem dado de vendedores Nuvemshop/UpZero). E as outras
páginas do sistema (produtos, clientes, pedidos, RFM, geografia, estoque)
ainda não foram adaptadas pro BigQuery — continuam funcionando só pra
Nuvemshop/UpZero. Se precisar delas pra Vesti também, é trabalho à parte.

## Pendente / próximos passos

- [ ] Confirmar acesso oficial (não só a credencial local) ao BigQuery e à
  instância Cloud SQL para o ambiente do `up-dash-b2b`.
- [ ] Definir onde o dataset de cada cliente Vesti fica registrado no
  schema do `up-dash-b2b` (hoje essa referência só existe no
  `backend-dash`).
- [ ] Implementar as queries de analytics do `up-dash-b2b` pro lado Vesti,
  usando `dashboard_vendas_cache_final` como base.
- [ ] Decidir se cadastro de cliente Vesti no `up-dash-b2b` reaproveita o
  fluxo que já existe no `script-vesti-nuvem`/`backend-dash`
  (`POST /admin/vesti/create-client`) ou se vira um fluxo próprio.

---
*Ver `NOTAS-DEV.md` (neste repo) e `NOTAS-DEV.md` do `backend-dash` para o
detalhamento técnico completo por trás de cada item acima.*
