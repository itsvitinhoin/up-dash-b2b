# UP Zero analytics: HTTP 503 em 19/10/2026

## Causa observada

Os logs de produção do job `upzero-sync-job-paid-touchpoints`, execução iniciada às 18:00 UTC, registram a resposta do endpoint `/external/v1/analytics/facts`:

> Consulta de eventos de analytics temporariamente desativada

A execução terminou com oito lojas com falha. Os logs da Vercel também registram a mensagem equivalente para `/analytics/metrics`. Isso comprova desativação das leituras no serviço de origem; não comprova o motivo administrativo dessa desativação. O backend responsável por `api.upzero.com.br` não foi localizado nos projetos/repositórios acessíveis durante a investigação.

## Por que o painel repetia chamadas

O relatório lê `paid_touchpoints` quando `paid_touchpoints_sync` comprova cobertura até o pedido. Uma consulta incompleta não amplia essa cobertura. Como resultados parciais não ficam no cache do relatório, recarregamentos repetiam as consultas que falharam. O job de seis em seis horas também consultava os dez anos completos mesmo para históricos já sincronizados e buscava compradores ERP usando `bigqueryDataset` em vez de `erpDataset`.

## Correção

- `analytics-availability.ts` aplica uma pausa compartilhada em Postgres para facts e metrics. A chave da integração é representada somente pelo SHA-256, sem armazenamento adicional da credencial.
- HTTP 503 que informa desativação pausa novas chamadas por 30 minutos. Outros 503 e HTTP 429 pausam por pelo menos cinco minutos; `Retry-After` pode ampliar esse prazo até 24 horas.
- A pausa é por integração e endpoint. Uma loja não bloqueia outra. Consultas já em voo podem terminar, mas novas consultas observam a pausa; não se trata de uma trava de exclusão mútua.
- Ao vencer o prazo, a próxima consulta tenta a origem normalmente. Falha não é convertida em resultado vazio nem em cobertura bem-sucedida. Evidências já cobertas continuam sendo lidas do banco.
- O job usa `erpDataset` e atualiza só o trecho novo de históricos existentes, com sobreposição de 24 horas.

## Implantação

A migration `0043_upzero_analytics_availability.sql` precisa estar aplicada antes do novo código do painel e do job serem usados. `TASK=setup_analytics_availability` aplica exclusivamente esse SQL idempotente dentro do job, usando sua conexão já configurada. Não aplica outras migrations pendentes nem exporta credenciais. A execução de setup deve ser confirmada como concluída antes de publicar o painel.

A correção reduz chamadas durante a indisponibilidade. Restaurar a consulta na origem exige localizar a configuração ou alteração que desativou analytics no backend UP Zero. O repositório `itsvitinhoin/upzero-back` estava vazio durante a investigação.

## Validação local

40 testes focados em disponibilidade, cobertura do cache, touchpoints, métricas UP Zero e atribuição por pedido passaram. Typecheck e build do backend passaram. Uma execução ampla acidental também encontrou testes de rotas que não conseguem abrir portas no sandbox e testes preexistentes que exigem configuração do banco; esses resultados não substituem os testes focados nem confirmam implantação.
