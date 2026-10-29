# Anúncios B2C e clientes manuais — métricas do Meta Ads

## Comportamento

- Nos cards de criativos B2C, Compras usa `purchases`, inclusive no comparativo. Rankings de menor custo por compra e mais compras são ordenados antes de limitar os resultados. B2B mantém Leads.
- Nos KPIs B2C, Compras usa a contagem de pedidos para lojas integradas e compras atribuídas Meta para `commercePlatform = MANUAL`. Cadastros aprovados não são usados como contagem de compras nesse caminho.
- Clientes MANUAL usam receita atribuída, compras e investimento Meta para faturamento, ROAS, custo por compra e série de receita, nos períodos atual e anterior. A resposta identifica `revenueSource = META`; lojas UPZERO/NUVEMSHOP/VESTI mantêm seu caminho de e-commerce. Não há fallback baseado em ausência de pedidos.
- A série `purchasesOverTime` representa compras atribuídas Meta no gráfico de anúncios. O resumo `metaSummary` alimenta os cards específicos do Meta sem depender do endpoint de performance B2B. `prevMetaSummary` fornece a comparação.
- Alcance e frequência são consultados apenas pela tela de anúncios, no nível da conta para o período inteiro; alcance diário não é somado. Quando o fuso da conta exige reagrupar horas ou há filtro por campanha, esses dois indicadores permanecem indisponíveis para não misturar recortes. CTR usa cliques no link / impressões, CPC usa investimento / cliques no link e CPM usa investimento / impressões × 1000.
- Quando a consulta Meta falha ou falta a conta de anúncios de um cliente MANUAL, marketing responde 503 (`MEDIA_UNAVAILABLE`, seguindo o tratamento central atual), em vez de converter falha em faturamento zero. Falha somente na leitura do período anterior mantém o período atual disponível e o comparativo como indisponível. O cache, a fila e os limites de chamadas do cliente Graph atual foram preservados.
- A análise de anúncios de clientes MANUAL lê a mesma origem. Para B2C, seu contexto usa compras e custo por compra. Dados geográficos de e-commerce não são atribuídos ao Meta.

## Revisão e validação

Commit original: `e573e34`, criado sobre UP Glass. Em 27/10/2026 a branch `codex/fix-b2c-meta-manual` foi sincronizada com `github/main` em `9f081ff`. Os conflitos foram resolvidos mantendo a versão atual do repositório e adaptando apenas esta correção, sem alterar a branch main.

Testes isolados: `pnpm --filter @workspace/api-server exec vitest run test/meta-marketing.test.ts test/marketing-manual-route.test.ts`.

Os testes simulam Graph API e banco; verificam origem MANUAL, receita e compras nos dois períodos, preservação da origem de lojas integradas (inclusive sem pedidos), erro de conexão, indisponibilidade apenas do comparativo, aliases de ações sem duplicação, alcance do período, rankings B2C e manutenção do ranking B2B. A interface foi conferida localmente com dados simulados em que Leads e Compras são diferentes.

Sem migração de banco e sem alteração de configuração. Nenhum deploy foi realizado. O Dev deve revisar a branch sincronizada e validar a conta Meta real após a integração.
