# Plano de publicação (21/10/2026)

Estado da `main` no GitHub: `ae7e147` (16/10, login por cookie). Tudo abaixo está só no computador do Marcelo. **Nada é publicado sem OK explícito.** O push na `main` faz o deploy de produção na Vercel.

## O que existe e em que estado

| Linha de trabalho | Branch (local) | Precisa de infra? | Situação |
|---|---|---|---|
| **A. Conciliação + Vesti 100% do dado guardado** | `feature/vesti-campanhas-anuncios-guardados` (`ef1c72d`) | Não (sem migration, sem job) | Pronta, falta conferência com dados reais (seção 1) |
| **B. GA4 guardado** | `feature/ga4-guardado` (`523b30c`, 6 commits) | Sim: migration 0044, build da imagem do job, acesso nas lojas, backfill | Pronta, falta a ordem de infra (seção 2) |
| **C. Docs do cookie** | `feature/sessao-por-cookie` (`b824cb5`) | Não | Só documentação, junta com a A |
| Victor: atribuição unificada | `origin/codex/mx-unified-attribution` | Sim (migration 0043 dele) | Não é nosso; ver seção 3 |
| Victor: `03408ed` | `origin/codex/reconcile-dashboard-metrics` | Não | **Absorvida** na linha A (sem o Facebook ao vivo e sem remover o cache). O Victor disse para deixar. |

A linha A contém, em ordem: gasto Vesti do guardado (`df7d869`), conciliação do Victor adaptada (`081d541`), doc (`59b8637`) e campanhas/anúncios/criativos do guardado (`ef1c72d`).

Verificado: as linhas A e B se juntam com **um único conflito**, nas linhas de importação de `routes/analytics.ts` (resolução abaixo). A junção das duas compila e passa **372 testes** (só o `smoke.test.ts` falha, como sempre, por precisar de admin no banco).

## 1. Publicar a linha A

### 1.1 Antes do push

1. **Cruzar as contas de anúncio** (a principal causa de R$ 0,00 depois da troca). No Postgres do dash novo:

   ```sql
   SELECT name, meta_ad_account_id FROM clients
   WHERE commerce_platform = 'VESTI' AND meta_ad_account_id IS NOT NULL AND archived_at IS NULL
   ORDER BY name;
   ```

   Comparar com as contas que a coleta guarda (37 em 19/10; 24 delas com anúncios por dia desde 01/09). Quem não estiver na lista vai mostrar investimento 0 e campanhas vazias, porque a coleta lê as contas do cadastro do **dash legado**. Se for uma marca ativa, a conta precisa entrar na coleta (ver `docs/fase2-coleta-facebook-no-dash-novo.md`).
2. **Medir a velocidade de hoje** (para comparar depois): na produção, aba Rede do navegador, tempo de `analytics/dashboard`, `analytics/daily-report`, `analytics/marketing`, `clients` em 2 clientes (um B2B, um B2C). Anotar.
3. **Conferir quem usa o Meta ao vivo**: depois desta publicação as telas Vesti não usam mais o token do Meta. As telas B2C/B2B (UpZero) ainda usam e agora devolvem erro 503 "Investimento indisponível" quando a leitura falha, em vez de R$ 0,00.

### 1.2 Push (quem faz: Marcelo, com OK explícito)

```bash
git -C C:/trabalho/up-glass-dev push origin feature/vesti-campanhas-anuncios-guardados:main
```

### 1.3 Depois do push (10 minutos)

- **Números iguais entre telas** (cliente B2B e cliente B2C, mesmo dia de ontem): faturamento e pedidos do **Dashboard**, **Clientes** (lista) e **Diário** têm que ser iguais. Cadastros e aprovados do **Dashboard**, **Funil** e **Cadastros** também.
- **Vesti, 3 marcas**: Relatório diário e Marketing carregam, mostram campanhas, anúncios com imagem e investimento; marca sem conta mostra tudo vazio, sem erro.
- **Cliente sem Meta** (B2C/B2B sem conta): Diário e Marketing carregam normalmente.
- **Velocidade**: refazer a medição do passo 1.1.2. Se o Dashboard B2B estiver bem mais lento, o motivo provável é ele calcular direto dos pedidos (a conciliação tirou o resumo diário); reportar antes de mexer.
- **Cache**: uma mudança de pedido ou cadastro leva até 5 minutos para aparecer no Dashboard (cache de resposta de 5 min, por usuário e filtros).

### 1.4 Como voltar atrás

- Sem migration e sem job: o retorno é limpo. Fazer `git revert` do(s) commit(s) e push, ou promover o deploy anterior na Vercel (acesso do chefe).

## 2. Publicar a linha B (GA4 guardado)

Seguir a ordem de `docs/ga4-guardado.md` (na branch):

1. Banco de produção, no Cloud SQL Studio: `lib/db/migrations/0043_ga4_daily_metrics.sql` (**já aplicada em 20/10**) e `0044_ga4_product_views_daily.sql` (idempotentes).
2. Imagem do job (manual): `gcloud builds submit --project=up-vesti-report --config=artifacts/api-server/cloudbuild.job.yaml --substitutions=SHORT_SHA=$(git rev-parse --short HEAD) .` (da raiz do repositório).
3. Acesso: a conta `928204832932-compute@developer.gserviceaccount.com` precisa ser **Leitor** nas propriedades GA4 das lojas que ela ainda não enxerga (Aiyu e Hot Pink). O primeiro backfill mostra quais falham, em `sync_jobs.error`.
4. Backfill uma vez: `gcloud run jobs execute upzero-sync-job --project=up-vesti-report --region=us-central1 --update-env-vars=TASK=ga4_daily,TRIGGER=manual --wait`.
5. **Só então** o push (tabela populada).

Se a linha A já estiver na `main`, trazer a B por cima:

```bash
git checkout feature/ga4-guardado
git merge origin/main
```

O único conflito é o bloco de importações de `artifacts/api-server/src/routes/analytics.ts`. Resolução: manter as **quatro** linhas abaixo, nesta ordem, e apagar os marcadores.

```ts
import { MediaReadError, fetchMetaMarketingData, emptyMetaMarketingData, upsertMetaCreatives, type MetaAdMetric, type MetaMarketingData } from "../services/meta-ads";
import { fetchMetaMarketingDataIfConnected } from "../services/meta-connected";
import type { Ga4DailyMetrics, Ga4FunnelMetrics, Ga4Source } from "../services/ga4";
import { getGa4Daily, getGa4Funnel, getGa4ProductViews } from "../services/ga4-daily-sync";
```

Depois: `tsc` e a suíte (a junção descartável deu 372 testes passando).

## 3. Migrations: aviso de numeração

A branch B usa as migrations **0043** (`ga4_daily_metrics`) e **0044**. A branch do Victor `mx-unified-attribution` também tem uma **0043** (`upzero_analytics_availability`), de outra tabela. No banco não colide (os SQL são aplicados à mão e são idempotentes), mas no `lib/db/migrations/meta/_journal.json` e nos snapshots do drizzle quem entrar na `main` depois precisa **renumerar** a sua (vira 0045) e ajustar o journal. Combinar com o Victor antes de qualquer uma das duas ir para a `main`.

## 4. Itens que dependem de outras pessoas

- **Google Ads parado desde 24/08**: `docs/google-ads-token.md` (passo a passo para o dono da conta).
- **Variáveis `SYNC_SERVICE_URL` e `SYNC_SERVICE_TOKEN` na Vercel**: só o chefe acessa; só importam para o botão "Novo cliente Vesti".
- **Bot do Victor (relatório das 6h)**: confirmar se o e-mail das 6h chegou hoje e ontem (o login por cookie já foi provado do nosso lado).
- **Tokens `upk_` vazados**: desligar na tela de tokens de API (cada um tem um botão para desligar).
