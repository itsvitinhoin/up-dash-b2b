# Up Manager B2C

O job `TASK=up_manager_daily` roda para as marcas de `UP_MANAGER_CLIENT_IDS`, uma lista de IDs separados por vírgula. Instalações com uma marca podem continuar usando `PRODUCT_CAMPAIGN_REVIEW_CLIENT_ID` quando a lista estiver vazia. Uma execução com `CLIENT_ID` seleciona uma marca habilitada. A janela diária termina ontem em São Paulo, com referência no mesmo dia da semana anterior. Janelas fechadas de 7 e 14 dias alimentam produtos, e o mês até a data de referência registra o faturamento acumulado. Relatórios manuais usam o período anterior de mesma duração.

Em Cloud Run, crie um recurso exclusivo para esse job e use a imagem que contém a tarefa. Reutilize a configuração de conexão do job de extrações do Updash e inclua a credencial Meta que ele já utiliza. Aplique `0052_up_manager_b2c.sql` depois de `0051_up_manager.sql`. Configure o Cloud Scheduler com `0 8,13 * * *` e fuso `America/Sao_Paulo`, POST autenticado via OAuth no endpoint oficial `https://run.googleapis.com/v2/projects/up-vesti-report/locations/us-central1/jobs/up-manager-aiyu-daily:run`. A identidade do Scheduler precisa de `roles/run.invoker` no job. A leitura das 13h recupera um fechamento que veio na sincronização do meio-dia. Configure retries no Cloud Run e dimensione o tempo limite para a execução sequencial das marcas. Com `UP_MANAGER_SCHEDULED_ANALYSIS_HOUR=13`, as leituras das 8h atualizam dados e DPA, e a análise de IA é gerada às 13h quando os pedidos fecharem. A análise de IA concluída é reaproveitada nas tentativas do mesmo dia. Configure `UP_MANAGER_OPENAI_ROUTINE_MODEL=gpt-6-luna` para leituras de rotina. Quedas prioritárias de faturamento, achados críticos e decisões de pausa ou escala confirmadas usam `UP_MANAGER_OPENAI_MODEL`. Se o fechamento da loja estiver sem confirmação, o job salva a leitura parcial e sinaliza falha permitindo nova tentativa.

## O que o Dev precisa montar no BigQuery

1. Execute `up-manager-brain.sql` com processamento em `US`, a mesma localização de `up_global`. O dataset usa o nome `up_manager_brain`.
2. Dê à identidade de execução do job `roles/bigquery.jobUser` no projeto e `roles/bigquery.dataEditor` nesse dataset. Para o fluxo de leitura da IA, use uma identidade de backend com `roles/bigquery.jobUser` no projeto e acesso de leitura na tabela ou em uma view autorizada. O backend precisa aplicar o `client_id` da sessão, e toda consulta deve limitar `date_to`.
3. Defina `UP_MANAGER_BRAIN_DATASET=up_manager_brain` no job para publicar o arquivo histórico. Defina `UP_MANAGER_GA4_BIGQUERY=1` e dê acesso de leitura às tabelas GA4 de `up_global` para habilitar a fonte complementar. Essas variáveis são independentes.
4. Execute o job e confira pelo `run_id` que o diagnóstico tem as mesmas métricas, fontes e achados no Cloud SQL e no BigQuery. Rode de novo sobre o mesmo dia com fechamento confirmado e confira que o registro continua único.

No piloto, a identidade de execução do Cloud Run é `928204832932-compute@developer.gserviceaccount.com`. O recurso que recebe a variável é `up-manager-aiyu-daily`, em `us-central1`.

O Cloud SQL preserva cada revisão em `up_manager_archive` e registra a última leitura exibida em `up_manager_reports` na mesma transação. O job publica os itens pendentes no BigQuery por `MERGE` de `client_id + date_to + run_id`. Enquanto o dataset está desativado ou indisponível, a caixa de saída permanece no Cloud SQL. O histórico inclui execuções manuais e agendadas, com versão da skill, métricas comparadas, fontes, lacunas, hipóteses, evidência e ação sugerida. O payload usa dados agregados da loja e IDs de produtos, variantes e cupons, sem códigos de cupom, IDs de compradores ou credenciais. Revisões ou pausas de anúncios continuam registradas nos controles operacionais do Up Manager.

Exemplo de leitura para a memória da AIYU, com parâmetros tipados:

```sql
SELECT run_id, date_to, analysis_day, skill_version, payload
FROM `up-vesti-report.up_manager_brain.analysis_runs`
WHERE client_id = @client_id
  AND date_to BETWEEN @date_from AND @date_to
  AND trigger = 'scheduled'
QUALIFY ROW_NUMBER() OVER (PARTITION BY client_id, date_to ORDER BY created_at DESC) = 1
ORDER BY date_to DESC;
```

O B2C inicial usa limites ABC de 80% e 95%, configuráveis por `UP_MANAGER_ABC_A` e `UP_MANAGER_ABC_B`. Reativação usa 90 dias, configuráveis por `UP_MANAGER_REACTIVATION_DAYS`. A referência de realização do estoque começa em 30% e é configurável por `UP_MANAGER_REALIZATION_RATE`. Cenários são hipóteses e dependem de cobertura completa do estoque vendável e da confirmação de pedidos. A análise registra a indisponibilidade de sinais por dispositivo, políticas gerais de frete, parcelamento e margem até receber fontes com cobertura verificável.

Os relatórios anteriores à versão B2C continuam no histórico operacional. O envio ao BigQuery começa nas revisões feitas com esta versão. Registros diários guardam os snapshots de catálogo e cupons para que uma queda, alteração ou reposição tenha evidência observável na execução seguinte.

## UP Agent e revisão do gestor

O motor diário usa `gpt-6.1-sol` pela Responses API. O modelo cruza os dados agregados e devolve ações imediatas e futuras com referências à evidência. Os avisos de grade são calculados diretamente a partir das variantes publicadas. Uma opção configurada com estoque zero gera alerta, incluindo produtos fora da Curva A. O vínculo de campanhas informa anúncios ativos com destino afetado quando a verificação do monitor está fresca.

No Cloud Run, monte uma credencial OpenAI existente em `OPENAI_API_KEY` via Secret Manager. Em Vercel o cliente do Updash pode usar a integração OpenAI já configurada. `UP_MANAGER_OPENAI_MODEL` permite configurar o modelo deste módulo. Se a OpenAI estiver indisponível, o relatório mantém os sinais verificáveis e indica a indisponibilidade. O job pode tentar outra geração às 13h.

A revisão guarda loja, execução, insight, gestor e horário em `up_manager_insight_reviews`. A ação de pausa da Meta fica desativada por padrão e reservada ao fluxo de confirmação quando habilitado. A OpenAI recebe agregações e evidências da loja. As revisões dos diagnósticos continuam na fila para o BigQuery.

O agente usa o histórico e os dados da marca para propor testes adicionais para revisão. A mediana de contas B2C comparáveis amplia o repertório e permanece fora dos critérios de execução. Os insights de mídia incluem páginas de destino, rejeição, compras por sessão, engajamento e disponibilidade dos produtos. Os insights de e-commerce investigam as etapas do funil no GA4, incluindo entrega e pagamento quando a perda ocorre no checkout.

O diagnóstico de leilão compara os três dias fechados mais recentes com os dias imediatamente anteriores e com os mesmos dias da semana anterior. Calcula CPM, CTR de link, compras por clique e valor atribuído por compra. O contexto sazonal usa a entrega da própria conta em sete dias, a semana equivalente quatro semanas antes e a janela equivalente do ano anterior quando existe cobertura. Em datas comerciais, a referência anual preserva a distância até o evento. O CPM indica custo de entrega e pode mudar com público, posicionamento e concorrência. Retomadas de curta duração entram como recuperação em validação, com a disponibilidade do destino ainda condicionando a escala.

Para lojas Braavo com vitrine pública verificada, configure `UP_MANAGER_PUBLIC_STOREFRONTS` com pares `client_id=host`, separados por vírgula. Use o host HTTPS canônico da loja. O job consulta os cartões da página de entrada da categoria e cruza os IDs de produtos e variantes com o Braavo. Quando o cartão informa saldo, o Manager usa as variantes exibidas na vitrine. Exibe a cobertura da página consultada. A lista de produtos de outras páginas da categoria depende de leitura própria. Produtos com saldo desconhecido ficam sinalizados.

### Decisões operacionais

A mídia compara duas janelas de sete dias e exclui os dois dias fechados mais recentes para acomodar o atraso de atribuição da Meta. Escala exige volume, comparação de CPA e destino verificado com grade disponível. Pausa por estoque fica no nível de anúncio, ou no nível de campanha se todos os anúncios ativos tiverem destino sem estoque confirmado. Pausa por desempenho exige gasto e ausência de compras atribuídas nas duas janelas. A análise calcula o CAC blended da loja, destaca a etapa do funil com piora comprovada quando há GA4 e mede aprovação de pedidos na Nuvemshop quando o checkout não está instrumentado. Define ainda segmentos de segunda compra e reativação com base no histórico pago. Os avisos exibem saldo e giro por variante. A data de reposição é uma tarefa do fornecedor quando não houver calendário sincronizado.

### Grade agrupada e criativos

O painel agrupa as quebras de grade da loja e prioriza opções com giro confirmado em produtos Curva A ou com anúncio afetado. Cada versão do diagnóstico registra a revisão do grupo. O detalhe preserva produtos e variantes, inclusive as quebras sem urgência de reposição.

A aba Criativos compara compras atribuídas, CPA, ROAS, CTR e gasto de peças com anúncios ativos. O destaque é definido por CPA com pelo menos cinco compras atribuídas. A recomendação por baixa eficiência exige duas janelas de sete dias e alternativa com entrega e compras no mesmo conjunto. Com `UP_MANAGER_CREATIVE_PAUSE_ENABLED=1`, administradores podem confirmar a desativação de um anúncio candidato após nova checagem dos dados e do anúncio na Meta. O registro fica em `up_manager_ad_actions`. A comparação de peças dinâmicas usa o agregado do anúncio.
