# Mapeamento card por card · UP Glass

578 pontos de uso/configuração encontrados nas 40 arquivos com cards (páginas e componentes compartilhados). Cada linha identifica a posição no código, o título ou expressão dinâmica e o componente final. Modelos dentro de loops são registrados na sua declaração; a quantidade de cards em execução depende dos dados. As configurações de KPI também são listadas para identificar as métricas que alimentam um modelo compartilhado.

Referência única de métricas: **DashboardKpiCard**, o componente de Visão Geral. **GlassMetricCard** adapta os valores já formatados para esse mesmo componente; não consulta nem recalcula dados. Painéis, gráficos, listas e detalhes usam Card e os tokens UP Glass. O CSV contém as expressões de valor e as consultas da página.

## accesses

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-001 | 162 | Criar acesso | Card | Painel |
| UP-002 | 261 | Acessos ativos | Card | Tabela / lista / detalhe |

## automatic-reports

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-003 | 872 | "Status" | GlassMetricCard | Métrica |
| UP-004 | 873 | "Marcas configuradas" | GlassMetricCard | Métrica |
| UP-005 | 874 | "Destinatários ativos" | GlassMetricCard | Métrica |
| UP-006 | 875 | "Na fila" | GlassMetricCard | Métrica |
| UP-007 | 904 | <MessageCircle className="h-4 w-4 text-primary" />Relatórios via WhatsApp Oficial da UP | Card | Painel |
| UP-008 | 1028 | <CalendarClock className="h-4 w-4 text-primary" />Resumo operacional | Card | Painel |
| UP-009 | 1060 | <Plus className="h-4 w-4 text-primary" />Novo destinatário | Card | Painel |
| UP-010 | 1110 | Destinatários cadastrados | Card | Tabela / lista / detalhe |
| UP-011 | 1172 | <FileText className="h-4 w-4 text-primary" />Templates da Agência | Card | Painel |
| UP-012 | 1250 | <Send className="h-4 w-4 text-primary" />Criar template na Meta | Card | Painel |
| UP-013 | 1376 | <FileText className="h-4 w-4 text-primary" />Modelo de mensagem | Card | Painel |
| UP-014 | 1417 | "Campo" | GlassMetricCard | Métrica |
| UP-015 | 1452 | Prévia | Card | Painel |
| UP-016 | 1468 | Dicionário disponível | Card | Painel |
| UP-017 | 1505 | <FileText className="h-4 w-4 text-primary" />Templates de relatório cadastrados | Card | Tabela / lista / detalhe |
| UP-018 | 1567 | <FileText className="h-4 w-4 text-primary" />Templates Clientes | Card | Painel |
| UP-019 | 1591 | <Send className="h-4 w-4 text-primary" />Relatórios gerados | Card | Tabela / lista / detalhe |

## clients

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-020 | 1921 | Painel / conteúdo | Card | Painel |
| UP-021 | 1957 | Acessos dos clientes | Card | Painel |
| UP-022 | 1982 | Painel / conteúdo | Superfície UP Glass | Painel |
| UP-023 | 2024 | Clientes cadastrados | Card | Tabela / lista / detalhe |

## compare

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-024 | 85 | Selecione marcas para comparar | Card | Painel |
| UP-025 | 181 | Painel / conteúdo | BrandKpiCard | Painel |
| UP-026 | 227 | Painel / conteúdo | Card | Painel |
| UP-027 | 265 | {label} | GlassMetricCard | Métrica |
| UP-028 | 319 | Faturamento diário comparado | Card | Gráfico |

## customer-detail

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-029 | 139 | "Visitas" | Configuração de KPI | Métrica configurada |
| UP-030 | 140 | "Cadastrado" | Configuração de KPI | Métrica configurada |
| UP-031 | 141 | "Aprovado" | Configuração de KPI | Métrica configurada |
| UP-032 | 142 | "Visualizações de produtos" | Configuração de KPI | Métrica configurada |
| UP-033 | 143 | "Adições ao carrinho" | Configuração de KPI | Métrica configurada |
| UP-034 | 144 | "Compras" | Configuração de KPI | Métrica configurada |
| UP-035 | 186 | <Megaphone className="h-4 w-4 text-primary" />Atribuição e cadastros | Card | Painel |
| UP-036 | 391 | Painel / conteúdo | Card | Painel |
| UP-037 | 415 | {label} | GlassMetricCard | Métrica |
| UP-038 | 492 | "Primeira campanha" | TouchCard | Painel |
| UP-039 | 497 | "Última campanha" | TouchCard | Painel |
| UP-040 | 502 | "Campanha de retorno" | TouchCard | Painel |
| UP-041 | 507 | "Primeira atividade" | MetricCard | Métrica |
| UP-042 | 512 | "Última atividade" | MetricCard | Métrica |
| UP-043 | 517 | "Produtos vistos" | MetricCard | Métrica |
| UP-044 | 518 | "Carrinhos" | MetricCard | Métrica |
| UP-045 | 519 | "Checkouts" | MetricCard | Métrica |
| UP-046 | 520 | "Compras" | MetricCard | Métrica |
| UP-047 | 521 | "Valor comprado" | MetricCard | Métrica |
| UP-048 | 524 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-049 | 789 | {customer?.name \|\| "Unknown Customer"} | Card | Painel |
| UP-050 | 893 | "Investimento total" | GlassMetricCard | Métrica |
| UP-051 | 894 | "Pedidos" | GlassMetricCard | Métrica |
| UP-052 | 912 | <BarChart2 className="h-4 w-4 text-primary" />Jornada do cliente | Card | Gráfico |
| UP-053 | 931 | Painel / conteúdo | Card | Painel |
| UP-054 | 950 | Painel / conteúdo | Card | Tabela / lista / detalhe |

## customers

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-055 | 112 | {label} | GlassMetricCard | Métrica |
| UP-056 | 377 | "Cadastros" | SummaryKpiCard | Métrica |
| UP-057 | 384 | "Aprovado" | SummaryKpiCard | Métrica |
| UP-058 | 391 | "Taxa de aprovação" | SummaryKpiCard | Métrica |
| UP-059 | 398 | Painel / conteúdo | RegistrationConversionCard | Painel |
| UP-060 | 398 | "Pendente" | SummaryKpiCard | Métrica |
| UP-061 | 405 | "Rejected" | SummaryKpiCard | Métrica |
| UP-062 | 412 | "Total de compradores" | SummaryKpiCard | Métrica |
| UP-063 | 419 | "Aprovados sem compra" | SummaryKpiCard | Métrica |
| UP-064 | 426 | "Dias médios até a primeira compra" | SummaryKpiCard | Métrica |
| UP-065 | 435 | "Cadastros" | SummaryKpiCard | Métrica |
| UP-066 | 443 | "Aprovado" | SummaryKpiCard | Métrica |
| UP-067 | 451 | "Pendente" | SummaryKpiCard | Métrica |
| UP-068 | 459 | "Rejected" | SummaryKpiCard | Métrica |
| UP-069 | 467 | "Taxa de aprovação" | SummaryKpiCard | Métrica |
| UP-070 | 475 | "Total de compradores" | SummaryKpiCard | Métrica |
| UP-071 | 483 | "Aprovados sem compra" | SummaryKpiCard | Métrica |
| UP-072 | 491 | "Dias médios até a primeira compra" | SummaryKpiCard | Métrica |
| UP-073 | 504 | Análise de cadastros | Card | Gráfico |
| UP-074 | 648 | <span className="h-1.5 w-1.5 rounded-full bg-primary" />Concentração por estado | Card | Gráfico |
| UP-075 | 749 | {insight.headline} | Card | Painel |
| UP-076 | 812 | Painel / conteúdo | Card | Painel |
| UP-077 | 950 | Painel / conteúdo | Card | Tabela / lista / detalhe |

## daily

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-078 | 144 | {label} | GlassMetricCard | Métrica |
| UP-079 | 155 | "Carregando relatório diário" | DashLoadingCard | Painel |
| UP-080 | 162 | Painel / conteúdo | Card | Painel |
| UP-081 | 331 | "UP Dash · Relatório diário" | GlassMetricCard | Métrica |
| UP-082 | 343 | "Faturamento aprovado" | DailyKpiCard | Métrica |
| UP-083 | 355 | "Quantidade de vendas" | DailyKpiCard | Métrica |
| UP-084 | 366 | "Ticket médio" | DailyKpiCard | Métrica |
| UP-085 | 377 | "Custo por compra" | DailyKpiCard | Métrica |
| UP-086 | 389 | "Investimento em mídia" | DailyKpiCard | Métrica |
| UP-087 | 400 | "ROAS" | DailyKpiCard | Métrica |
| UP-088 | 418 | Painel / conteúdo | Card | Painel |
| UP-089 | 429 | "Análise geral" | GlassMetricCard | Métrica |
| UP-090 | 440 | Painel / conteúdo | Card | Painel |
| UP-091 | 441 | "Resumo do relatório" | GlassMetricCard | Métrica |
| UP-092 | 461 | Campanhas | Card | Tabela / lista / detalhe |
| UP-093 | 492 | Produtos mais vendidos | Card | Tabela / lista / detalhe |
| UP-094 | 530 | "Categorias" | RankingCard | Painel |
| UP-095 | 531 | "Cores" | RankingCard | Painel |
| UP-096 | 532 | "Tamanhos" | RankingCard | Painel |
| UP-097 | 550 | {title} | Card | Painel |

## dashboard

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-098 | 153 | {title} | Card | Painel |
| UP-099 | 784 | <Megaphone className="h-4 w-4 text-primary" />Clientes atribuídos às campanhas | Card | Tabela / lista / detalhe |
| UP-100 | 797 | "Clientes" | GlassMetricCard | Métrica |
| UP-101 | 798 | "Solicitado" | GlassMetricCard | Métrica |
| UP-102 | 799 | "Pedidos" | GlassMetricCard | Métrica |
| UP-103 | 800 | "Cadastros" | GlassMetricCard | Métrica |
| UP-104 | 807 | "Valor solicitado" | DashboardKpiCard | Métrica |
| UP-105 | 822 | "Valor atendido" | DashboardKpiCard | Métrica |
| UP-106 | 836 | "Investimento" | DashboardKpiCard | Métrica |
| UP-107 | 850 | "ROAS" | DashboardKpiCard | Métrica |
| UP-108 | 1195 | "Eventos" | GlassMetricCard | Métrica |
| UP-109 | 1196 | "Produtos vistos" | GlassMetricCard | Métrica |
| UP-110 | 1197 | "Carrinhos" | GlassMetricCard | Métrica |
| UP-111 | 1198 | "Valor comprado" | GlassMetricCard | Métrica |
| UP-112 | 1405 | <ShoppingBag className="h-4 w-4 text-primary" />Pedidos do período | Card | Tabela / lista / detalhe |
| UP-113 | 1417 | "Pedidos no período" | GlassMetricCard | Métrica |
| UP-114 | 1512 | "Pago" | GlassMetricCard | Métrica |
| UP-115 | 1513 | "Bruto" | GlassMetricCard | Métrica |
| UP-116 | 1514 | "Desconto" | GlassMetricCard | Métrica |
| UP-117 | 1515 | "Frete" | GlassMetricCard | Métrica |
| UP-118 | 1854 | {t("dashboard.loading.title")} | DashLoadingCard | Painel |
| UP-119 | 1943 | {isB2C ? t("dashboard.kpi.totalRevenue.b2c") : t("dashboard.kpi.totalRevenue.b2b")} | DashboardKpiCard | Métrica |
| UP-120 | 1961 | {t("dashboard.kpi.orders")} | DashboardKpiCard | Métrica |
| UP-121 | 1978 | {t("dashboard.kpi.avgTicket")} | DashboardKpiCard | Métrica |
| UP-122 | 1995 | {t("dashboard.kpi.conversionRate")} | DashboardKpiCard | Métrica |
| UP-123 | 2023 | {isB2C ? t("dashboard.kpi.invoicedValue") : t("dashboard.kpi.requestedRevenue")} | GlassMetricCard | Métrica |
| UP-124 | 2055 | {t("dashboard.kpi.buyersThisPeriod")} | GlassMetricCard | Métrica |
| UP-125 | 2125 | {t("dashboard.kpi.buyerRetention")} | DashboardKpiCard | Métrica |
| UP-126 | 2170 | {t("dashboard.chart.title")} | Card | Gráfico |
| UP-127 | 2310 | {insight.headline} | Card | Painel |
| UP-128 | 2385 | {t("dashboard.b2c.byCategory.title")} | B2CSalesBreakdownCard | Painel |
| UP-129 | 2394 | {t("dashboard.b2c.byColor.title")} | B2CSalesBreakdownCard | Painel |
| UP-130 | 2403 | {t("dashboard.b2c.bySize.title")} | B2CSalesBreakdownCard | Gráfico |
| UP-131 | 2422 | {t("dashboard.signals.title")} | Card | Gráfico |
| UP-132 | 2467 | <AlertTriangle className="h-4 w-4 text-amber-400" />{t("dashboard.alerts.title")} | Card | Painel |
| UP-133 | 2615 | {t("dashboard.categories.title")} | Card | Painel |
| UP-134 | 2688 | {t("dashboard.sellers.title")} | Card | Painel |

## erp

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-135 | 377 | {metric.label} | DashboardKpiCard | Métrica |
| UP-136 | 554 | Painel / conteúdo | Card | Gráfico |
| UP-137 | 635 | "Faturamento líquido" | Configuração de KPI | Métrica configurada |
| UP-138 | 647 | "Pedidos" | Configuração de KPI | Métrica configurada |
| UP-139 | 659 | "Compradores" | Configuração de KPI | Métrica configurada |
| UP-140 | 671 | "Retenção" | Configuração de KPI | Métrica configurada |
| UP-141 | 684 | "Peças vendidas" | Configuração de KPI | Métrica configurada |
| UP-142 | 696 | "Descontos" | Configuração de KPI | Métrica configurada |
| UP-143 | 708 | "Devoluções" | Configuração de KPI | Métrica configurada |
| UP-144 | 720 | "Cancelamentos" | Configuração de KPI | Métrica configurada |
| UP-145 | 742 | Painel / conteúdo | Card | Gráfico |
| UP-146 | 786 | Painel / conteúdo | Card | Gráfico |
| UP-147 | 844 | "Formas de pagamento" | BreakdownCard | Painel |
| UP-148 | 850 | "Ranking de vendedores" | BreakdownCard | Painel |
| UP-149 | 856 | "Geografia de compradores" | BreakdownCard | Painel |
| UP-150 | 863 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-151 | 990 | "Faturamento bruto" | Configuração de KPI | Métrica configurada |
| UP-152 | 1002 | "Pedidos únicos" | Configuração de KPI | Métrica configurada |
| UP-153 | 1014 | "Peças vendidas" | Configuração de KPI | Métrica configurada |
| UP-154 | 1026 | "Cancelamentos" | Configuração de KPI | Métrica configurada |
| UP-155 | 1042 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-156 | 1295 | "Pedidos históricos" | GlassMetricCard | Métrica |
| UP-157 | 1296 | "Valor total comprado" | GlassMetricCard | Métrica |
| UP-158 | 1297 | "Ticket médio histórico" | GlassMetricCard | Métrica |
| UP-159 | 1431 | "Compradores" | Configuração de KPI | Métrica configurada |
| UP-160 | 1443 | "Novos compradores" | Configuração de KPI | Métrica configurada |
| UP-161 | 1455 | "Recorrentes" | Configuração de KPI | Métrica configurada |
| UP-162 | 1467 | "Retenção" | Configuração de KPI | Métrica configurada |
| UP-163 | 1484 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-164 | 1937 | "Estoque atual" | Configuração de KPI | Métrica configurada |
| UP-165 | 1947 | "Poder de venda" | Configuração de KPI | Métrica configurada |
| UP-166 | 1957 | "Cobertura" | Configuração de KPI | Métrica configurada |
| UP-167 | 1967 | "SKUs sem estoque" | Configuração de KPI | Métrica configurada |
| UP-168 | 1979 | "Faturamento" | Configuração de KPI | Métrica configurada |
| UP-169 | 1989 | "Lucro bruto" | Configuração de KPI | Métrica configurada |
| UP-170 | 1999 | "% de giro" | Configuração de KPI | Métrica configurada |
| UP-171 | 2013 | "Poder de venda" | Configuração de KPI | Métrica configurada |
| UP-172 | 2028 | "Categorias" | BreakdownCard | Painel |
| UP-173 | 2043 | "Cores" | BreakdownCard | Painel |
| UP-174 | 2055 | "Tamanhos" | BreakdownCard | Painel |
| UP-175 | 2068 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-176 | 2200 | "Vendedores ativos" | Configuração de KPI | Métrica configurada |
| UP-177 | 2210 | "Faturamento" | Configuração de KPI | Métrica configurada |
| UP-178 | 2220 | "Ticket médio" | Configuração de KPI | Métrica configurada |
| UP-179 | 2230 | "Clientes atendidos" | Configuração de KPI | Métrica configurada |
| UP-180 | 2245 | "Ranking de vendedores" | BreakdownCard | Painel |
| UP-181 | 2251 | "Desempenho por loja" | BreakdownCard | Painel |
| UP-182 | 2258 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-183 | 2341 | "Geografia de compradores" | BreakdownCard | Painel |
| UP-184 | 2342 | Painel / conteúdo | Card | Tabela / lista / detalhe |

## extractions

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-185 | 196 | "Execuções" | GlassMetricCard | Métrica |
| UP-186 | 197 | "Rodando" | GlassMetricCard | Métrica |
| UP-187 | 198 | "Concluídas" | GlassMetricCard | Métrica |
| UP-188 | 199 | "Falhas" | GlassMetricCard | Métrica |
| UP-189 | 202 | <DatabaseZap className="h-4 w-4 text-primary" />Histórico de extrações | Card | Tabela / lista / detalhe |

## funnel

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-190 | 250 | Painel / conteúdo | ActivationAnalysisCard | Painel |
| UP-191 | 271 | {visitStepHidden ? "Leads → Compras" : "Visitantes → Compras"} | Card | Painel |
| UP-192 | 319 | {visibleSteps[0]?.label ?? "Topo do funil"} | MiniStat | Métrica |
| UP-193 | 327 | "Compras" | MiniStat | Métrica |
| UP-194 | 335 | {biggestDrop ? Perda em ${biggestDrop.to.label} : "Maior perda"} | MiniStat | Métrica |
| UP-195 | 344 | "Média de eventos antes da compra" | MiniStat | Métrica |
| UP-196 | 361 | Painel / conteúdo | ActivationAnalysisCard | Painel |
| UP-197 | 373 | <TrendingUp className="h-3.5 w-3.5 text-primary" />Visitas diárias ao site e taxa de conversão | Card | Gráfico |
| UP-198 | 511 | <span className="h-1.5 w-1.5 rounded-full bg-primary" />Fluxo por etapa | Card | Gráfico |
| UP-199 | 579 | Painel / conteúdo | Card | Painel |
| UP-200 | 596 | Painel / conteúdo | Card | Painel |
| UP-201 | 756 | Cadastro aprovado → primeira compra | Card | Painel |
| UP-202 | 783 | "Aprovados" | ActivationMetric | Métrica |
| UP-203 | 784 | "Ativação em 30 dias" | ActivationMetric | Métrica |
| UP-204 | 789 | "Ticket 1ª compra" | ActivationMetric | Métrica |
| UP-205 | 914 | {label} | GlassMetricCard | Métrica |
| UP-206 | 1001 | {label} | GlassMetricCard | Métrica |

## geography

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-207 | 166 | Onde estão seus clientes{" "}<span className="bg-gradient-to-r from-primary via-chart-1 to-chart-3 bg-clip-text text-transparent"> buying </span> | Card | Painel |
| UP-208 | 208 | "Faturamento total" | HeroStat | Métrica |
| UP-209 | 217 | "States covered" | HeroStat | Métrica |
| UP-210 | 225 | "Cidades" | HeroStat | Métrica |
| UP-211 | 233 | {topState ? Top · ${topState.state} : "Principal mercado"} | HeroStat | Métrica |
| UP-212 | 256 | <span className="h-1.5 w-1.5 rounded-full bg-primary" />Mapa de faturamento no Brasil | Card | Gráfico |
| UP-213 | 284 | <Flame className="h-4 w-4 text-amber-500" />Mercados em destaque | Card | Painel |
| UP-214 | 399 | <span className="h-1.5 w-1.5 rounded-full bg-primary" />{view === "state" ? "Todos os estados" : "Todas as cidades"} | Card | Tabela / lista / detalhe |
| UP-215 | 566 | {label} | GlassMetricCard | Métrica |

## journey

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-216 | 56 | {label} | GlassMetricCard | Métrica |
| UP-217 | 166 | Painel / conteúdo | Card | Painel |
| UP-218 | 209 | "Média de eventos antes da compra" | KpiCard | Métrica |
| UP-219 | 216 | "Tempo médio até a primeira compra" | KpiCard | Métrica |
| UP-220 | 223 | "Tempo médio entre compras" | KpiCard | Métrica |
| UP-221 | 230 | "Compradores na primeira sessão" | KpiCard | Métrica |
| UP-222 | 244 | <span className="h-1.5 w-1.5 rounded-full bg-primary" />Fluxo de eventos | Card | Painel |
| UP-223 | 263 | <span className="h-1.5 w-1.5 rounded-full bg-chart-3" />Principais caminhos até a compra | Card | Painel |
| UP-224 | 311 | <span className="h-1.5 w-1.5 rounded-full bg-chart-4" />Compradores e não compradores — comparação de eventos | Card | Gráfico |
| UP-225 | 408 | Painel / conteúdo | Card | Painel |

## login

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-226 | 110 | "Faturamento hoje" | Configuração de KPI | Métrica configurada |
| UP-227 | 119 | "Pedidos atualizados" | Configuração de KPI | Métrica configurada |
| UP-228 | 128 | "Conversão" | Configuração de KPI | Métrica configurada |
| UP-229 | 137 | "Usuários ativos" | Configuração de KPI | Métrica configurada |

## marketing

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-230 | 203 | {label} | GlassMetricCard | Métrica |
| UP-231 | 376 | Painel / conteúdo | Card | Painel |
| UP-232 | 385 | "CTR" | GlassMetricCard | Métrica |
| UP-233 | 386 | {costLabel} | GlassMetricCard | Métrica |
| UP-234 | 387 | "Leads" | GlassMetricCard | Métrica |
| UP-235 | 388 | "Investimento" | GlassMetricCard | Métrica |
| UP-236 | 420 | <Sparkles className="h-4 w-4 text-muted-foreground" />{title} | Card | Painel |
| UP-237 | 430 | Painel / conteúdo | TopCreativeCard | Painel |
| UP-238 | 460 | Painel / conteúdo | Card | Painel |
| UP-239 | 762 | Sem dados de canais pagos | Card | Painel |
| UP-240 | 798 | "Investimento em anúncios" | MktKpiCard | Métrica |
| UP-241 | 810 | "Faturamento" | MktKpiCard | Métrica |
| UP-242 | 822 | "ROA" | MktKpiCard | Métrica |
| UP-243 | 834 | "Taxa de aprovação" | MktKpiCard | Métrica |
| UP-244 | 846 | "Total de leads" | MktKpiCard | Métrica |
| UP-245 | 858 | {isB2C ? "Compras" : "Leads aprovados"} | MktKpiCard | Métrica |
| UP-246 | 870 | {isB2C ? "Custo por Compra" : "CPL"} | MktKpiCard | Métrica |
| UP-247 | 884 | "CPA" | MktKpiCard | Métrica |
| UP-248 | 912 | Painel / conteúdo | Card | Painel |
| UP-249 | 932 | <BarChart3 className="h-4 w-4 text-muted-foreground" />Investimento e leads | Card | Gráfico |
| UP-250 | 964 | <TrendingUp className="h-4 w-4 text-muted-foreground" />Evolução do ROAS | Card | Gráfico |
| UP-251 | 1002 | <DollarSign className="h-4 w-4 text-muted-foreground" />Investimento e faturamento | Card | Gráfico |
| UP-252 | 1048 | <Megaphone className="h-4 w-4 text-muted-foreground" />Por plataforma | Card | Painel |
| UP-253 | 1067 | <MapPin className="h-4 w-4 text-muted-foreground" />Principais estados por ROAS | Card | Painel |
| UP-254 | 1090 | <PersonStanding className="h-4 w-4 text-muted-foreground" />Faixa etária dos clientes (leads pagos) | Card | Painel |
| UP-255 | 1131 | Desempenho de campanhas | Card | Painel |

## monthly-history

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-256 | 234 | Histórico Mensal | Card | Tabela / lista / detalhe |

## not-found

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-257 | 7 | Painel / conteúdo | Card | Painel |

## notifications

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-258 | 112 | Painel / conteúdo | Card | Painel |

## orchestrator

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-259 | 399 | Painel / conteúdo | Card | Painel |
| UP-260 | 443 | "Marcas B2B" | DashboardKpiCard | Métrica |
| UP-261 | 460 | "Cadastros IA" | DashboardKpiCard | Métrica |
| UP-262 | 477 | "Pedidos influenciados" | DashboardKpiCard | Métrica |
| UP-263 | 494 | "Qualidade IA" | DashboardKpiCard | Métrica |
| UP-264 | 515 | Marcas no Orquestrador | Card | Tabela / lista / detalhe |
| UP-265 | 648 | Painel / conteúdo | Card | Painel |
| UP-266 | 721 | Cadastros criados pela IA | Card | Tabela / lista / detalhe |
| UP-267 | 912 | Painel / conteúdo | Card | Painel |
| UP-268 | 952 | Painel / conteúdo | Card | Painel |
| UP-269 | 977 | Painel / conteúdo | Card | Painel |
| UP-270 | 1028 | Painel / conteúdo | Card | Painel |
| UP-271 | 1032 | <span>{automationAudience === "internal_seller" ? "Nova notificação interna" : "Nova automação"}</span><Button type="button" variant="ghost" size="icon" onClick={() => setIsCreatingRule(false)} aria-label="Cancelar nova automação" title="Cancelar" > <X /> </Button> | Card | Painel |
| UP-272 | 1160 | <span className="flex items-center gap-2"> {eventLabel} <Badge variant="secondary">Etapa {rule.sequence ?? 1}</Badge> </span><div className="flex items-center gap-2 text-sm font-normal text-muted-foreground"> <span>{rule.enabled ? "Ativa" : "Inativa"}</span> <Switch checked={rule.enabled} onCheckedChange={(checked) => updateRule.mutate({ ruleId: rule.id, patch: { isEnabled: checked } })} aria-label={Ativar ${rule.name}} /> </div> | Card | Painel |
| UP-273 | 1279 | Painel / conteúdo | Card | Painel |
| UP-274 | 1331 | Criar agente para {agentsQuery.data?.client?.name ?? "cliente"} | Card | Painel |
| UP-275 | 1374 | <span className="flex items-center gap-2"><Bot className="h-4 w-4 text-primary" />{agent.name}</span><Badge variant={agent.status === "active" ? "default" : "outline"}>{agent.status === "active" ? "Ativo" : "Rascunho"}</Badge> | Card | Painel |
| UP-276 | 1411 | Painel / conteúdo | Card | Painel |
| UP-277 | 1425 | Integração UP Zero | Card | Painel |
| UP-278 | 1442 | Configurações gerais | Card | Painel |
| UP-279 | 1461 | Regras comerciais editáveis | Card | Painel |
| UP-280 | 1475 | Painel / conteúdo | Card | Painel |
| UP-281 | 1485 | Painel / conteúdo | Card | Painel |
| UP-282 | 1509 | Simulador de atendimento | Card | Painel |
| UP-283 | 1519 | Resposta simulada | Card | Painel |
| UP-284 | 1557 | Webhook UP Zero | Card | Painel |
| UP-285 | 1575 | Logs da operação | Card | Painel |
| UP-286 | 1663 | Painel / conteúdo | Card | Painel |
| UP-287 | 1665 | "Marca em configuração" | GlassMetricCard | Métrica |
| UP-288 | 1695 | "Conversas" | DashboardKpiCard | Métrica |
| UP-289 | 1712 | "Cadastros" | DashboardKpiCard | Métrica |
| UP-290 | 1729 | "Pedidos" | DashboardKpiCard | Métrica |
| UP-291 | 1746 | "Handoffs" | DashboardKpiCard | Métrica |

## orders

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-292 | 287 | {t("orders.selectBrand.title", "Selecione uma marca")} | Card | Painel |
| UP-293 | 313 | {isB2C ? "Faturamento faturado" : t("orders.kpi.requestedRevenue", "Faturamento solicitado")} | DashboardKpiCard | Métrica |
| UP-294 | 329 | {isB2C ? "Faturamento pago" : t("orders.kpi.fulfilledRevenue", "Faturamento atendido")} | DashboardKpiCard | Métrica |
| UP-295 | 344 | {isB2C ? "Peças faturadas" : t("orders.kpi.requestedQuantity", "Peças solicitadas")} | DashboardKpiCard | Métrica |
| UP-296 | 359 | {isB2C ? "Peças pagas" : t("orders.kpi.fulfilledQuantity", "Peças atendidas")} | DashboardKpiCard | Métrica |
| UP-297 | 374 | {isB2C ? "% Pago" : t("orders.kpi.fulfilledPct", "% de atendido")} | DashboardKpiCard | Métrica |
| UP-298 | 390 | {t("orders.kpi.orders", "Qtd de pedidos")} | DashboardKpiCard | Métrica |
| UP-299 | 405 | {isB2C ? "Novos compradores" : t("orders.kpi.newCustomers", "Clientes novos")} | DashboardKpiCard | Métrica |
| UP-300 | 420 | {isB2C ? "Recompradores" : t("orders.kpi.returningCustomers", "Clientes recorrentes")} | DashboardKpiCard | Métrica |
| UP-301 | 435 | {t("orders.kpi.retentionPct", "% de retenção")} | DashboardKpiCard | Métrica |
| UP-302 | 451 | {t("orders.kpi.conversionPct", "% de conversão")} | DashboardKpiCard | Métrica |
| UP-303 | 471 | <ShoppingBag className="h-4 w-4 text-primary" />{t("orders.list.title", "Lista de pedidos")} | Card | Tabela / lista / detalhe |
| UP-304 | 622 | {isB2C ? "Valor faturado" : "Valor solicitado"} | GlassMetricCard | Métrica |
| UP-305 | 623 | {isB2C ? "Valor pago" : "Valor atendido"} | GlassMetricCard | Métrica |
| UP-306 | 624 | {isB2C ? "Peças faturadas" : "Peças solicitadas"} | GlassMetricCard | Métrica |
| UP-307 | 625 | {isB2C ? "Peças pagas" : "Peças atendidas"} | GlassMetricCard | Métrica |
| UP-308 | 675 | {isB2C ? "Faturada" : "Solicitada"} | GlassMetricCard | Métrica |
| UP-309 | 676 | {isB2C ? "Paga" : "Atendida"} | GlassMetricCard | Métrica |
| UP-310 | 677 | "Valor" | GlassMetricCard | Métrica |

## organized-pages

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-311 | 37 | {pick( "acquisitionRevenue", "acquisitionTicket", "acquisitionOrders", "newCustomers", )} | Metrics | Métrica |
| UP-312 | 47 | {pick("cac", "costRegistration", "costApproved", "spend")} | Metrics | Métrica |
| UP-313 | 52 | {pick("approved", "approvedConverted", "approvedConversion")} | Metrics | Métrica |
| UP-314 | 57 | {pick("firstPurchaseAverage", "firstPurchaseMedian")} | Metrics | Métrica |
| UP-315 | 68 | {title} | Card | Gráfico |
| UP-316 | 142 | {pick( "spend", "requestedRoas", "paidRoas", "approvedConversion", )} | Metrics | Métrica |
| UP-317 | 158 | Etapas operacionais | Card | Painel |
| UP-318 | 162 | {stage.label} | GlassMetricCard | Métrica |
| UP-319 | 189 | {pick( "metaSpend", "impressions", "reach", "frequency", "clicks", "ctr", "cpc", "cpm", "metaPurchases", "metaCpa", "metaRoas", )} | Metrics | Métrica |

## overview

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-320 | 127 | {label} | GlassMetricCard | Métrica |
| UP-321 | 189 | {title} | Card | Painel |
| UP-322 | 416 | Clientes nos totais da plataforma | Card | Painel |
| UP-323 | 496 | "Faturamento da plataforma" | KpiTile | Métrica |
| UP-324 | 507 | "Pedidos da plataforma" | KpiTile | Métrica |
| UP-325 | 518 | "Clientes ativos" | KpiTile | Métrica |
| UP-326 | 529 | "Marcas ativas" | KpiTile | Métrica |
| UP-327 | 541 | "Ticket médio da plataforma" | KpiTile | Métrica |
| UP-328 | 561 | "Investimento em anúncios" | KpiTile | Métrica |
| UP-329 | 572 | "ROAS geral" | KpiTile | Métrica |
| UP-330 | 583 | "Total de leads" | KpiTile | Métrica |
| UP-331 | 594 | "Leads aprovados" | KpiTile | Métrica |
| UP-332 | 607 | Evolução da plataforma | Card | Gráfico |
| UP-333 | 728 | "Melhores desempenhos" | LeaderboardCard | Painel |
| UP-334 | 740 | "Maior crescimento" | LeaderboardCard | Painel |
| UP-335 | 752 | "Precisa de atenção" | LeaderboardCard | Painel |
| UP-336 | 766 | Marcas selecionadas | Card | Painel |

## performance-recompra

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-337 | 216 | {title} | GlassMetricCard | Métrica |
| UP-338 | 414 | Painel / conteúdo | PeriodCalendarCard | Painel |
| UP-339 | 719 | Painel / conteúdo | Card | Painel |
| UP-340 | 800 | "Resultado de recompra" | RecompraBlockCard | Métrica |
| UP-341 | 812 | "Vendas de recompra" | Configuração de KPI | Métrica configurada |
| UP-342 | 813 | "Ticket médio" | Configuração de KPI | Métrica configurada |
| UP-343 | 814 | "Clientes em recompra" | Configuração de KPI | Métrica configurada |
| UP-344 | 817 | "Clientes recorrentes" | RecompraBlockCard | Métrica |
| UP-345 | 829 | "Vendas recorrentes" | Configuração de KPI | Métrica configurada |
| UP-346 | 830 | "Faturamento recorrente" | Configuração de KPI | Métrica configurada |
| UP-347 | 831 | "Ticket médio recorrente" | Configuração de KPI | Métrica configurada |
| UP-348 | 834 | "Clientes reativados" | RecompraBlockCard | Métrica |
| UP-349 | 846 | "Vendas reativadas" | Configuração de KPI | Métrica configurada |
| UP-350 | 847 | "Faturamento reativado" | Configuração de KPI | Métrica configurada |
| UP-351 | 848 | "Ticket médio reativado" | Configuração de KPI | Métrica configurada |
| UP-352 | 851 | "Ciclo de recompra" | RecompraBlockCard | Métrica |
| UP-353 | 864 | "Mediana entre compras" | Configuração de KPI | Métrica configurada |
| UP-354 | 865 | "% recorrente" | Configuração de KPI | Métrica configurada |
| UP-355 | 866 | "% reativado" | Configuração de KPI | Métrica configurada |
| UP-356 | 888 | Resultado de recompra | Card | Gráfico |
| UP-357 | 912 | Volume de recompra | Card | Gráfico |
| UP-358 | 935 | Recorrentes x Reativados | Card | Gráfico |
| UP-359 | 962 | Intervalo entre compras | Card | Gráfico |
| UP-360 | 1010 | Retenção acumulada por prazo | Card | Tabela / lista / detalhe |
| UP-361 | 1051 | Retenção por número de compra | Card | Gráfico |
| UP-362 | 1084 | Desempenho por vendedora | Card | Tabela / lista / detalhe |
| UP-363 | 1132 | Detalhamento de recompra | Card | Tabela / lista / detalhe |

## performance

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-364 | 454 | {title} | Card | Gráfico |
| UP-365 | 697 | "Faturamento ERP" | Configuração de KPI | Métrica configurada |
| UP-366 | 709 | "Receita atribuída" | Configuração de KPI | Métrica configurada |
| UP-367 | 726 | "Investimento" | Configuração de KPI | Métrica configurada |
| UP-368 | 738 | "ROAS atribuído" | Configuração de KPI | Métrica configurada |
| UP-369 | 750 | "MER geral" | Configuração de KPI | Métrica configurada |
| UP-370 | 762 | "Lucro bruto" | Configuração de KPI | Métrica configurada |
| UP-371 | 777 | "ROI final" | Configuração de KPI | Métrica configurada |
| UP-372 | 794 | "Ticket médio" | Configuração de KPI | Métrica configurada |
| UP-373 | 811 | "Pedidos ERP" | Configuração de KPI | Métrica configurada |
| UP-374 | 823 | "Pedidos atribuídos" | Configuração de KPI | Métrica configurada |
| UP-375 | 841 | "Compradores únicos" | Configuração de KPI | Métrica configurada |
| UP-376 | 855 | "Clientes novos" | Configuração de KPI | Métrica configurada |
| UP-377 | 872 | "Clientes recorrentes" | Configuração de KPI | Métrica configurada |
| UP-378 | 886 | "CAC" | Configuração de KPI | Métrica configurada |
| UP-379 | 898 | "CTR" | Configuração de KPI | Métrica configurada |
| UP-380 | 910 | "CPL" | Configuração de KPI | Métrica configurada |
| UP-381 | 1079 | Painel / conteúdo | DashboardKpiCard | Métrica |
| UP-382 | 1097 | Painel / conteúdo | Card | Gráfico |
| UP-383 | 1161 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-384 | 1201 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-385 | 1238 | {COHORT_LABEL[cohort]} | GlassMetricCard | Métrica |
| UP-386 | 1337 | Painel / conteúdo | DashboardKpiCard | Métrica |
| UP-387 | 1359 | Painel / conteúdo | DashboardKpiCard | Métrica |
| UP-388 | 1373 | Painel / conteúdo | Card | Painel |
| UP-389 | 1422 | {item.label} | GlassMetricCard | Métrica |
| UP-390 | 1430 | Painel / conteúdo | Card | Painel |
| UP-391 | 1439 | {stage.label} | GlassMetricCard | Métrica |
| UP-392 | 1453 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-393 | 1549 | "Vendas por cor" | BreakdownCard | Painel |
| UP-394 | 1554 | "Vendas por tamanho" | BreakdownCard | Painel |
| UP-395 | 1559 | "Vendas por estado" | BreakdownCard | Painel |
| UP-396 | 1566 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-397 | 1662 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-398 | 1753 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-399 | 1812 | "Pedidos no período" | GlassMetricCard | Métrica |
| UP-400 | 1813 | "Valor total" | GlassMetricCard | Métrica |
| UP-401 | 1814 | "Pedidos atribuídos" | GlassMetricCard | Métrica |
| UP-402 | 1815 | "Receita atribuída" | GlassMetricCard | Métrica |
| UP-403 | 1817 | "Faturamento pago atribuído" | GlassMetricCard | Métrica |

## product-detail

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-404 | 79 | {label} | GlassMetricCard | Métrica |
| UP-405 | 221 | {product.name} | Card | Painel |
| UP-406 | 274 | "Faturamento histórico" | KpiTile | Métrica |
| UP-407 | 275 | "Unidades vendidas" | KpiTile | Métrica |
| UP-408 | 276 | "Ticket médio" | KpiTile | Métrica |
| UP-409 | 277 | "Sell-through" | KpiTile | Métrica |
| UP-410 | 287 | <TrendingUp className="h-4 w-4" />Evolução do faturamento | Card | Gráfico |
| UP-411 | 367 | Painel / conteúdo | Card | Gráfico |
| UP-412 | 385 | <Users className="h-4 w-4" />Principais compradores | Card | Tabela / lista / detalhe |

## products

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-413 | 415 | "Sales Power" | GlassMetricCard | Métrica |
| UP-414 | 416 | "Faturamento por SKU/dia" | GlassMetricCard | Métrica |
| UP-415 | 417 | "SKUs ativos" | GlassMetricCard | Métrica |
| UP-416 | 418 | "Período" | GlassMetricCard | Métrica |
| UP-417 | 427 | {insight.headline} | Card | Painel |
| UP-418 | 489 | Painel / conteúdo | Card | Painel |
| UP-419 | 582 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-420 | 727 | "Vendidos" | GlassMetricCard | Métrica |
| UP-421 | 728 | "Receita" | GlassMetricCard | Métrica |
| UP-422 | 729 | "Estoque" | GlassMetricCard | Métrica |

## rfm

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-423 | 164 | {title} | GlassMetricCard | Métrica |
| UP-424 | 296 | Painel / conteúdo | Card | Painel |
| UP-425 | 339 | "Recência" | RfmLogicCard | Métrica |
| UP-426 | 346 | "Frequência" | RfmLogicCard | Métrica |
| UP-427 | 353 | "Monetário" | RfmLogicCard | Métrica |
| UP-428 | 377 | {meta.label} | GlassMetricCard | Métrica |
| UP-429 | 393 | <span className="h-1.5 w-1.5 rounded-full bg-primary" />Evolução da composição dos segmentos | Card | Gráfico |
| UP-430 | 455 | <span className="h-1.5 w-1.5 rounded-full bg-chart-3" />Compradoras RFM <span className="text-muted-foreground font-normal">({formatNumber(total)})</span><InfoHint text="A lista mostra clientes que solicitaram pedidos no período filtrado. Por padrão entram todos os pedidos; use o filtro de status para analisar somente aprovados, pendentes ou recusados." /> | Card | Tabela / lista / detalhe |
| UP-431 | 692 | Painel / conteúdo | Card | Painel |
| UP-432 | 733 | "Solicitado" | GlassMetricCard | Métrica |
| UP-433 | 734 | "Atendido" | GlassMetricCard | Métrica |
| UP-434 | 735 | "Peças solicitadas" | GlassMetricCard | Métrica |
| UP-435 | 736 | "Peças atendidas" | GlassMetricCard | Métrica |

## sales-agent

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-436 | 33 | {title} | GlassMetricCard | Métrica |
| UP-437 | 47 | Painel / conteúdo | Card | Painel |
| UP-438 | 62 | "Conversas" | Metric | Métrica |
| UP-439 | 68 | "Cadastros" | Metric | Métrica |
| UP-440 | 74 | "Pedidos" | Metric | Métrica |
| UP-441 | 80 | "Números conectados" | Metric | Métrica |
| UP-442 | 88 | CRM simplificado | Card | Painel |
| UP-443 | 97 | Cadastros criados | Card | Tabela / lista / detalhe |

## scale

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-444 | 158 | {title} | Card | Painel |
| UP-445 | 199 | Painel / conteúdo | Card | Painel |
| UP-446 | 208 | "Receita" | GlassMetricCard | Métrica |
| UP-447 | 209 | "Mídia" | GlassMetricCard | Métrica |
| UP-448 | 210 | "Pedidos estimados" | GlassMetricCard | Métrica |
| UP-449 | 218 | "Carregando Escala" | DashLoadingCard | Painel |
| UP-450 | 350 | "Poder de venda" | DashboardKpiCard | Métrica |
| UP-451 | 368 | "Faturamento" | DashboardKpiCard | Métrica |
| UP-452 | 385 | "Qtd. vendas" | DashboardKpiCard | Métrica |
| UP-453 | 402 | "Ticket médio" | DashboardKpiCard | Métrica |
| UP-454 | 419 | "Giro" | DashboardKpiCard | Métrica |
| UP-455 | 438 | "Invest. mídia" | DashboardKpiCard | Métrica |
| UP-456 | 455 | "ROAS" | DashboardKpiCard | Métrica |
| UP-457 | 472 | "Custo por compra" | DashboardKpiCard | Métrica |
| UP-458 | 492 | Calculadora de projeção | Card | Painel |
| UP-459 | 565 | "Atual" | GlassMetricCard | Métrica |
| UP-460 | 567 | "Meta" | GlassMetricCard | Métrica |
| UP-461 | 568 | "Intervalo" | GlassMetricCard | Métrica |
| UP-462 | 577 | "Incremento de receita" | GlassMetricCard | Métrica |
| UP-463 | 578 | "Incremento de mídia" | GlassMetricCard | Métrica |
| UP-464 | 579 | "Gap de estoque" | GlassMetricCard | Métrica |
| UP-465 | 580 | "Peças adicionais" | GlassMetricCard | Métrica |
| UP-466 | 584 | Insights de escala | Card | Painel |
| UP-467 | 630 | Painel / conteúdo | ScenarioCard | Painel |
| UP-468 | 635 | "Categorias mais vendidas" | BreakdownCard | Painel |
| UP-469 | 636 | "Tamanhos mais vendidos" | BreakdownCard | Painel |
| UP-470 | 637 | "Cores mais vendidas" | BreakdownCard | Painel |
| UP-471 | 638 | "Poder por categoria" | BreakdownCard | Painel |
| UP-472 | 641 | Como a projeção foi calculada | Card | Painel |

## seller-detail

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-473 | 81 | {label} | GlassMetricCard | Métrica |
| UP-474 | 253 | {seller.name} | Card | Painel |
| UP-475 | 301 | Painel / conteúdo | Card | Painel |
| UP-476 | 308 | "Faturamento" | KpiCard | Métrica |
| UP-477 | 316 | "Pedidos" | KpiCard | Métrica |
| UP-478 | 323 | "Ticket médio" | KpiCard | Métrica |
| UP-479 | 330 | "Clientes" | KpiCard | Métrica |
| UP-480 | 337 | "Taxa de aprovação" | KpiCard | Métrica |
| UP-481 | 344 | "% de conversão" | KpiCard | Métrica |
| UP-482 | 358 | <TrendingUp className="h-4 w-4" />Evolução do faturamento | Card | Gráfico |
| UP-483 | 461 | <BarChart2 className="h-4 w-4" />Faturamento por categoria | Card | Gráfico |
| UP-484 | 476 | <MapPin className="h-4 w-4" />Faturamento por estado | Card | Gráfico |
| UP-485 | 496 | <Users className="h-4 w-4" />Principais clientes | Card | Tabela / lista / detalhe |
| UP-486 | 586 | <ShoppingBag className="h-4 w-4" />Pedidos recentes | Card | Tabela / lista / detalhe |

## sellers

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-487 | 177 | "Faturamento total" | GlassMetricCard | Métrica |
| UP-488 | 181 | "Vendedoras ativas" | GlassMetricCard | Métrica |
| UP-489 | 185 | "Principal vendedora" | GlassMetricCard | Métrica |
| UP-490 | 192 | {insight.headline} | Card | Painel |
| UP-491 | 255 | Painel / conteúdo | Card | Gráfico |
| UP-492 | 415 | Painel / conteúdo | Card | Painel |
| UP-493 | 455 | {seller.name} | Card | Painel |

## stock-intelligence

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-494 | 133 | {label} | GlassMetricCard | Métrica |
| UP-495 | 160 | Painel / conteúdo | Card | Painel |
| UP-496 | 388 | {insight.headline} | Card | Painel |
| UP-497 | 458 | Painel / conteúdo | Card | Painel |
| UP-498 | 465 | "Total de unidades em estoque" | KpiCard | Métrica |
| UP-499 | 472 | "Cobertura média em dias" | KpiCard | Métrica |
| UP-500 | 479 | "SKUs com risco de ruptura" | KpiCard | Métrica |
| UP-501 | 487 | "SKUs com risco de excesso" | KpiCard | Métrica |
| UP-502 | 495 | "Sell-through Rate" | KpiCard | Métrica |
| UP-503 | 513 | Painel / conteúdo | Card | Painel |
| UP-504 | 553 | Todos os SKUs | Card | Tabela / lista / detalhe |
| UP-505 | 744 | Painel / conteúdo | Card | Gráfico |
| UP-506 | 822 | Painel / conteúdo | Card | Gráfico |
| UP-507 | 882 | Painel / conteúdo | Card | Gráfico |
| UP-508 | 970 | "Unidades vendidas" | GlassMetricCard | Métrica |
| UP-509 | 971 | "Unidades em estoque" | GlassMetricCard | Métrica |
| UP-510 | 972 | "Velocidade diária" | GlassMetricCard | Métrica |
| UP-511 | 973 | "Dias de cobertura" | GlassMetricCard | Métrica |

## utm

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-512 | 78 | {label} | GlassMetricCard | Métrica |
| UP-513 | 359 | "Sessões" | KpiCard | Métrica |
| UP-514 | 366 | "Cadastros" | KpiCard | Métrica |
| UP-515 | 372 | "% de aprovação" | KpiCard | Métrica |
| UP-516 | 379 | "Compradores" | KpiCard | Métrica |
| UP-517 | 385 | "Faturamento" | KpiCard | Métrica |
| UP-518 | 392 | "% de conversão" | KpiCard | Métrica |
| UP-519 | 399 | "ROAS" | KpiCard | Métrica |
| UP-520 | 413 | {insight.headline} | Card | Painel |
| UP-521 | 487 | Faturamento por {GROUP_LABELS[groupBy]} | Card | Gráfico |
| UP-522 | 543 | % de conversão por {GROUP_LABELS[groupBy]} | Card | Gráfico |
| UP-523 | 615 | Painel / conteúdo | Card | Painel |

## whatsapp-connections

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-524 | 727 | <PlugZap className="h-4 w-4 text-primary" />Conectar WhatsApp Business | Card | Painel |
| UP-525 | 903 | "Conexões" | GlassMetricCard | Métrica |
| UP-526 | 904 | "Números cadastrados" | GlassMetricCard | Métrica |
| UP-527 | 905 | Painel / conteúdo | Card | Painel |
| UP-528 | 933 | Painel / conteúdo | Card | Painel |
| UP-529 | 950 | <Webhook className="h-4 w-4 text-primary" />Webhook da Meta | Card | Painel |
| UP-530 | 995 | {syncCopy.title} | Card | Painel |
| UP-531 | 1062 | "Mensagens importadas" | GlassMetricCard | Métrica |
| UP-532 | 1063 | "Eventos de histórico" | GlassMetricCard | Métrica |
| UP-533 | 1081 | <Smartphone className="h-4 w-4 text-primary" />Telefones de campanha | Card | Painel |
| UP-534 | 1176 | {numberTitle(phone)} | Card | Painel |

## whatsapp-conversations

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-535 | 215 | "Conversas" | GlassMetricCard | Métrica |
| UP-536 | 216 | "Mensagens aguardando" | GlassMetricCard | Métrica |
| UP-537 | 217 | "Encerradas" | GlassMetricCard | Métrica |
| UP-538 | 218 | Painel / conteúdo | Card | Painel |
| UP-539 | 231 | Conversas | Card | Painel |

## whatsapp-sends

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-540 | 169 | <Send className="h-4 w-4 text-primary" />Envio teste WhatsApp | Card | Painel |

## whatsapp-templates

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-541 | 764 | "Aprovados" | GlassMetricCard | Métrica |
| UP-542 | 765 | "Pendentes" | GlassMetricCard | Métrica |
| UP-543 | 766 | "Recusados" | GlassMetricCard | Métrica |
| UP-544 | 804 | {phoneLabel(selectedPhone)} | Card | Painel |
| UP-545 | 856 | Variaveis para templates e automacoes | Card | Painel |
| UP-546 | 922 | Criar template | Card | Painel |
| UP-547 | 1283 | Modelos cadastrados | Card | Tabela / lista / detalhe |

## whatsapp

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-548 | 213 | {label} | GlassMetricCard | Métrica |
| UP-549 | 423 | <MessageCircle className="h-4 w-4 text-primary" />Atendimento WhatsApp | Card | Painel |
| UP-550 | 489 | "Total de conversas" | KpiCard | Métrica |
| UP-551 | 490 | "Novos leads" | KpiCard | Métrica |
| UP-552 | 491 | "Leads recorrentes" | KpiCard | Métrica |
| UP-553 | 492 | "Mensagens recebidas" | KpiCard | Métrica |
| UP-554 | 493 | "Mensagens enviadas" | KpiCard | Métrica |
| UP-555 | 494 | "Tempo 1ª resposta" | KpiCard | Métrica |
| UP-556 | 495 | "SLA cumprido" | KpiCard | Métrica |
| UP-557 | 496 | "Leads sem resposta" | KpiCard | Métrica |
| UP-558 | 497 | "Aguardando resposta" | KpiCard | Métrica |
| UP-559 | 498 | "Encerradas" | KpiCard | Métrica |
| UP-560 | 499 | "Perdidas" | KpiCard | Métrica |
| UP-561 | 503 | Conversas por dia | Card | Gráfico |
| UP-562 | 518 | Conversas por hora | Card | Gráfico |
| UP-563 | 533 | Recebidas vs enviadas | Card | Gráfico |
| UP-564 | 549 | Ranking por conversas atendidas | Card | Gráfico |
| UP-565 | 566 | Funil comercial do WhatsApp | Card | Gráfico |
| UP-566 | 600 | Taxa de avanço por etapa | Card | Painel |
| UP-567 | 634 | Tempo médio de primeira resposta por perfil WhatsApp | Card | Gráfico |
| UP-568 | 650 | Conversas sem resposta | Card | Tabela / lista / detalhe |
| UP-569 | 678 | Motivos de perda | Card | Tabela / lista / detalhe |
| UP-570 | 703 | Produtividade por perfil WhatsApp | Card | Tabela / lista / detalhe |

## purchase-insights

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-571 | 15 | Painel / conteúdo | Card | Painel |
| UP-572 | 34 | Painel / conteúdo | Card | Painel |
| UP-573 | 34 | Painel / conteúdo | Card | Painel |
| UP-574 | 36 | Distribuição de compradores | Card | Painel |
| UP-575 | 42 | "Compram na primeira semana" | GlassMetricCard | Métrica |
| UP-576 | 43 | "Compram em até 30 dias" | GlassMetricCard | Métrica |
| UP-577 | 44 | "Mediana até o pedido" | GlassMetricCard | Métrica |

## acquisition-funnel

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-578 | 7 | {title} | Card | Painel |

