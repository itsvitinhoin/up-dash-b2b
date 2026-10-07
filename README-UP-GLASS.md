# UP Dash · Redesign UP Glass

Este redesign aplica o kit UP Glass enviado ao dashboard existente. As métricas usam DashboardKpiCard, o componente de Visão Geral, com tipografia, botões, superfícies, tabelas, filtros e efeitos compartilhados.

## Interface

- Operação B2B/B2C, cliente e período no topo; removida a duplicação Atacado/Varejo acima dos filtros.
- Interface fixa em português, incluindo menus, estados, legendas e datas. Siglas e nomes usuais de métricas, como ROAS, CTR, CAC, LTV, SKU e Sales Power, permanecem.
- Grades dimensionadas pela largura disponível de cada componente, com no máximo quatro métricas por linha. A tipografia dos números também se adapta à largura do card, sem quebrar valores em caracteres. Os quatro cards iniciais de Recompra ficam na mesma linha no desktop.
- Todos os cards exibem o botão “i” no canto superior direito. Descrição, fonte e regras de cálculo/base ficam nesse popover, acessível por clique, toque e teclado; linhas de fonte não ocupam o rodapé.
- Os cards sempre mostram o comparativo. KPIs anteriores existentes são reutilizados; os demais totais consultam os mesmos endpoints de leitura na janela imediatamente anterior de igual duração e com os mesmos filtros. As consultas são compartilhadas/cacheadas, sem requests por card. Valores históricos ausentes e snapshots sem histórico mostram indisponibilidade; base anterior zero não gera +100% artificial. Queda em métricas de custo conserva o sinal negativo e pode ser marcada como favorável.
- Produtos no B2C inclui Vendas por Categoria, Vendas por Cor e Vendas por Tamanho, com seletor compartilhado entre peças vendidas e faturamento. Cada tooltip e a tabela “Ver dados” mostram as duas medidas. Barras com a mesma escala nos três gráficos, cores UP, tamanhos em ordem de grade e cards empilhados no celular.
- Gráficos em variações do azul UP; o funil usa etapas alinhadas e progressivamente estreitas, conforme a referência. Etapas operacionais e diagnósticos existentes continuam disponíveis.
- Loader oficial derivado de Sample 5.mp4, com canal alfa, em WebP animado. A conversão preserva duração e movimento; recorta apenas as margens pretas e remove áudio/metadados. WebP mantém transparência inclusive em navegadores que não reproduzem vídeo com alfa. Há imagem estática para a preferência de movimento reduzido. O overlay aplica blur de 10 px e permanece durante as consultas de dados; saúde e notificações em segundo plano não bloqueiam a página.

UI-KIT-CARD-MAP.md, ui-kit-card-map.csv e design-reference/ui-kit-card-map.json identificam as declarações e consultas de cada card, incluindo os novos componentes compartilhados. O inventário atual contém 583 declarações em 38 páginas e três componentes, com 329 métricas. Modelos dentro de loops são contados na definição.

## Métricas e compatibilidade

Sales Power em Produtos é a soma de estoque disponível × preço de venda de todo o catálogo ativo. Usa os dados já extraídos de produtos/estoque no Postgres ou Vesti; independe das vendas ou do período selecionado. O endpoint products/summary recebe o campo adicional availableStockSalesValue. O campo legado salesPower continua disponível para compatibilidade e sua antiga métrica aparece como Faturamento por SKU/dia, com a comparação anterior. Não há histórico de snapshots de estoque para inventar uma variação de Sales Power.

O endpoint de leitura products/sales-breakdowns agrega quantidade e quantidade × priceAtSale dos itens dos pedidos já conectados, por categoria do produto e cor/tamanho registrados no item. Respeita cliente autenticado, período inclusivo de São Paulo, busca/SKU, categoria, estado, cor e tamanho. Não usa o limite nem a ordenação da tabela para calcular vendas; não soma produto-pai e variante. Atributos ausentes ficam em Não informado, e os três recortes fecham no mesmo total. Faturamento segue a base existente de Produtos, sem frete; não inclui descontos adicionais de pedido que não estejam incorporados no preço do item. Sem dados, aparece estado vazio; falha de consulta permite tentar novamente.

Evolução da Base usa os mesmos pedidos positivos e identidades já conciliados por Recompra. A base contém lojistas cuja primeira compra histórica ocorreu no período selecionado, considerando pedidos pagos até o fim dele e todas as origens. As etapas 1, 2, 3 e 4+ exibem clientes, retenção, valor dos pedidos e receita acumulada; 4+ reúne todos os pedidos a partir do quarto, sem dupla contagem. O funil de aquisição conta recorrentes somente dentro dessa base de clientes novos. Cadastros e aprovações usam os totais existentes do período; suas razões com clientes novos não pressupõem uma única coorte de aprovação. O funil principal é geral; filtros adicionais continuam aplicados às etapas e diagnósticos existentes.

Velocidade de Conversão cruza essa base com a data de aprovação disponível em customers.approvalDate. As sete faixas são disjuntas. Compradores sem aprovação datada ou com cronologia invertida ficam fora da amostra, com contagem visível; uma amostra vazia gera ausência explícita. A data do pedido positivo disponível na origem pode diferir da data efetiva de pagamento. Aprovações do Vesti sem timestamp conciliado no cadastro não são estimadas a partir da data de criação.

Análise de Cohort mostra os quatro meses de primeira compra até o fim do período selecionado, com Mês 0 a Mês 3. Cada célula conta lojistas distintos com um pedido positivo naquele mês de calendário, no horário de São Paulo, sobre a base do mês de primeira compra histórica. Não é retenção acumulada por dias. Meses futuros e grupos vazios geram ausência explícita; meses observados sem retorno mostram 0%. O último mês é parcial até a data selecionada. A tabela acumulada anterior continua em uma seção expansível.

O endpoint recompra/history-insights mantém funnel e cohort históricos e recebe campos adicionais baseEvolution, conversionVelocity e monthlyCohort. O período altera apenas as análises novas; a chave de cache inclui cliente, datasets e datas. As verificações de acesso por cliente existentes permanecem.

Comparativos de Recompra ficam ativos por padrão; o seletor de comparação personalizada continua disponível. Velocidade de Conversão compara coortes independentes com seus respectivos cortes de período. Sales Power e detalhes de um pedido individual não possuem uma janela anterior equivalente; nesses casos, a informação de indisponibilidade permanece explícita.

## Base e preservação

Branch codex/up-glass-redesign, a partir da main publicada b93552a109b4f94555c1d1e1751775d4d503092b. O delta original do frontend foi transportado sem copiar o backend antigo do ZIP sobre a main. As alterações adicionais de backend são agregações de leitura para as análises descritas acima.

Não há alteração da extração, jobs, credenciais, autenticação, schema de banco, migrações, contratos gerados, provedor de filtros, configuração Vercel, workflows, dependências ou lockfile. O checkout original e suas alterações locais permanecem separados. Não houve merge ou publicação no domínio de produção atual.

## Validação

- TypeScript do frontend e backend; declarações dos pacotes workspace.
- Builds normais do frontend e backend.
- Onze testes de product-sales-breakdowns, products-period, metric-comparison, purchase-progression e monthly-cohort: reconciliação de peças e receita entre dimensões, atributos ausentes, catálogo acima de 1.000 itens, ajustes negativos/zero e janelas inclusivas, mudança de mês/ano bissexto, ausência de histórico, base zero, direção da variação, primeira compra histórica, receita 4+, limites do período/dia brasileiro, faixas disjuntas, datas ausentes/invertidas e ausência de amostra.
- Auditoria atual em 40 rotas a 320 px, verificando a largura de rolagem do próprio main e o conteúdo dos cards; pontos encontrados foram corrigidos e conferidos novamente. Rotas administrativas sem fixture mantêm estados de indisponibilidade.
- Páginas principais conferidas em 360, 390, 430, 768, 1024, 1280 e 1536 px. A auditoria mede números dentro dos cards, altura e conteúdo lateral, além da largura do documento. Gestos horizontais mantêm a página em scrollLeft 0; tabelas extensas preservam rolagem somente no próprio componente.
- Topo mobile com operação/ações, cliente e período em linhas definidas. Criativos, Funil, campanhas, alertas, categorias, paginação e cards de WhatsApp se adaptam à largura disponível. Filtro RFM mantém os códigos de API originais.
- Loader observado durante troca de período, blur de 10 px e remoção ao concluir.
- git diff --check e ausência do token sintético no bundle normal.

Os builds mantêm o aviso de tamanho do bundle e os avisos existentes de sourcemap. A verificação visual usa dados sintéticos e não confirma as integrações em produção.

## Prévia pública isolada

scripts/build-public-preview.mjs gera um frontend e uma Function Vercel somente com dados sintéticos. A sessão de demonstração é preparada exclusivamente nesse build; o frontend normal mantém a demonstração restrita ao desenvolvimento.

```sh
node scripts/build-public-preview.mjs /tmp/up-dash-glass-preview
```

A saída padrão tmp/public-preview é ignorada pelo Git. O artefato .vercel/output deve ser vinculado exclusivamente a up-dash-glass-preview, nunca ao projeto data-intelligence-system.

A prévia não inclui banco, credenciais, variáveis de integração ou jobs. Escritas e extrações retornam 405; somente o login fictício retorna a sessão de demonstração. Rotas sem fixture não consultam serviços reais. A produção existente permanece em www.grupoup-dash.com.br.
