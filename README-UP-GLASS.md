# UP Dash · Redesign UP Glass

Este redesign aplica o kit UP Glass enviado ao dashboard existente. As métricas usam DashboardKpiCard, o componente de Visão Geral, com tipografia, botões, superfícies, tabelas, filtros e efeitos compartilhados.

## Interface

- Operação B2B/B2C, cliente e período no topo; removida a duplicação Atacado/Varejo acima dos filtros.
- Interface fixa em português, incluindo menus, estados, legendas e datas. Siglas e nomes usuais de métricas, como ROAS, CTR, CAC, LTV, SKU e Sales Power, permanecem.
- Grades com no máximo quatro métricas por linha no desktop, duas em telas intermediárias e uma no celular. Os quatro cards iniciais de Recompra ficam na mesma linha no desktop.
- Gráficos em variações do azul UP; o funil usa etapas alinhadas e progressivamente estreitas, conforme a referência. Etapas operacionais e diagnósticos existentes continuam disponíveis.
- Loader oficial derivado de Sample 5.mp4, com canal alfa, em WebP animado. A conversão preserva duração e movimento; recorta apenas as margens pretas e remove áudio/metadados. WebP mantém transparência inclusive em navegadores que não reproduzem vídeo com alfa. Há imagem estática para a preferência de movimento reduzido. O overlay aplica blur de 10 px e permanece durante as consultas de dados; saúde e notificações em segundo plano não bloqueiam a página.

UI-KIT-CARD-MAP.md, ui-kit-card-map.csv e design-reference/ui-kit-card-map.json identificam as declarações e consultas de cada card, incluindo os novos componentes compartilhados. Modelos dentro de loops são contados na definição.

## Métricas e compatibilidade

Sales Power em Produtos é a soma de estoque disponível × preço de venda de todo o catálogo ativo. Usa os dados já extraídos de produtos/estoque no Postgres ou Vesti; independe das vendas ou do período selecionado. O endpoint products/summary recebe o campo adicional availableStockSalesValue. O campo legado salesPower continua disponível para compatibilidade e sua antiga métrica aparece como Faturamento por SKU/dia, com a comparação anterior. Não há histórico de snapshots de estoque para inventar uma variação de Sales Power.

Evolução da Base usa os mesmos pedidos positivos e identidades já conciliados por Recompra. A base contém lojistas cuja primeira compra histórica ocorreu no período selecionado, considerando pedidos pagos até o fim dele e todas as origens. As etapas 1, 2, 3 e 4+ exibem clientes, retenção, valor dos pedidos e receita acumulada; 4+ reúne todos os pedidos a partir do quarto, sem dupla contagem. O funil de aquisição conta recorrentes somente dentro dessa base de clientes novos. Cadastros e aprovações usam os totais existentes do período; suas razões com clientes novos não pressupõem uma única coorte de aprovação. O funil principal é geral; filtros adicionais continuam aplicados às etapas e diagnósticos existentes.

Velocidade de Conversão cruza essa base com a data de aprovação disponível em customers.approvalDate. As sete faixas são disjuntas. Compradores sem aprovação datada ou com cronologia invertida ficam fora da amostra, com contagem visível; uma amostra vazia gera ausência explícita. A data do pedido positivo disponível na origem pode diferir da data efetiva de pagamento. Aprovações do Vesti sem timestamp conciliado no cadastro não são estimadas a partir da data de criação.

O endpoint recompra/history-insights mantém funnel e cohort históricos e recebe campos adicionais baseEvolution e conversionVelocity. O período altera apenas as análises novas; a chave de cache inclui cliente, datasets e datas. As verificações de acesso por cliente existentes permanecem.

## Base e preservação

Branch codex/up-glass-redesign, a partir da main publicada b93552a109b4f94555c1d1e1751775d4d503092b. O delta original do frontend foi transportado sem copiar o backend antigo do ZIP sobre a main. As alterações adicionais de backend são agregações de leitura para as análises descritas acima.

Não há alteração da extração, jobs, credenciais, autenticação, schema de banco, migrações, contratos gerados, provedor de filtros, configuração Vercel, workflows, dependências ou lockfile. O checkout original e suas alterações locais permanecem separados. Não houve merge ou publicação no domínio de produção atual.

## Validação

- TypeScript do frontend e backend; declarações dos pacotes workspace.
- Builds normais do frontend e backend.
- Três testes de purchase-progression: primeira compra histórica, receita 4+, limites do período/dia brasileiro, faixas disjuntas, datas ausentes/invertidas e ausência de amostra.
- Revisão local atual: 12 páginas em desktop (1280 px) e celular (390 px), mais Visão Geral em 1920 px; sem rolagem lateral e sem grades com mais de quatro métricas. Os quatro cards de Recompra têm o mesmo alinhamento vertical.
- Revisão adicional de 40 rotas no desktop sem erros de execução, quebra lateral ou grades acima de quatro métricas. Filtro RFM conferido com rótulo Campeões e código de API Champions. Rotas administrativas sem fixture podem mostrar dados indisponíveis após as tentativas de consulta.
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
