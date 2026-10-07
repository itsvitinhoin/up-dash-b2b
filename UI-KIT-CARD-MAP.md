# Mapeamento card por card · UP Glass

569 pontos de uso/configuração encontrados nas 41 arquivos com cards (páginas e componentes compartilhados). Cada linha identifica a posição no código, o título ou expressão dinâmica e o componente final. Modelos dentro de loops são registrados na sua declaração; a quantidade de cards em execução depende dos dados. As configurações de KPI também são listadas para identificar as métricas que alimentam um modelo compartilhado.

Referência única de métricas: **DashboardKpiCard**, o componente de Visão Geral. **GlassMetricCard** adapta os valores já formatados para esse mesmo componente; não consulta nem recalcula dados. Painéis, gráficos, listas e detalhes usam Card e os tokens UP Glass. O CSV contém as expressões de valor e as consultas da página.

## accesses

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-001 | 165 | {String(label)} | GlassMetricCard | Métrica |
| UP-002 | 169 | Criar acesso | Card | Painel |
| UP-003 | 268 | Acessos ativos | Card | Tabela / lista / detalhe |

## automatic-reports

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-004 | 872 | "Status" | GlassMetricCard | Métrica |
| UP-005 | 873 | "Marcas configuradas" | GlassMetricCard | Métrica |
| UP-006 | 874 | "Destinatários ativos" | GlassMetricCard | Métrica |
| UP-007 | 875 | "Na fila" | GlassMetricCard | Métrica |
| UP-008 | 904 | <MessageCircle className="h-4 w-4 text-primary" />Relatórios via WhatsApp Oficial da UP | Card | Painel |
| UP-009 | 1028 | <CalendarClock className="h-4 w-4 text-primary" />Resumo operacional | Card | Painel |
| UP-010 | 1060 | <Plus className="h-4 w-4 text-primary" />Novo destinatário | Card | Painel |
| UP-011 | 1110 | Destinatários cadastrados | Card | Tabela / lista / detalhe |
| UP-012 | 1172 | <FileText className="h-4 w-4 text-primary" />Templates da Agência | Card | Painel |
| UP-013 | 1250 | <Send className="h-4 w-4 text-primary" />Criar template na Meta | Card | Painel |
| UP-014 | 1376 | <FileText className="h-4 w-4 text-primary" />Modelo de mensagem | Card | Painel |
| UP-015 | 1417 | "Campo" | GlassMetricCard | Métrica |
| UP-016 | 1452 | Prévia | Card | Painel |
| UP-017 | 1468 | Dicionário disponível | Card | Painel |
| UP-018 | 1505 | <FileText className="h-4 w-4 text-primary" />Templates de relatório cadastrados | Card | Tabela / lista / detalhe |
| UP-019 | 1567 | <FileText className="h-4 w-4 text-primary" />Templates Clientes | Card | Painel |
| UP-020 | 1591 | <Send className="h-4 w-4 text-primary" />Relatórios gerados | Card | Tabela / lista / detalhe |

## clients

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-021 | 1567 | {String(label)} | GlassMetricCard | Métrica |
| UP-022 | 1925 | Painel / conteúdo | Card | Painel |
| UP-023 | 1961 | Acessos dos clientes | Card | Painel |
| UP-024 | 1986 | Painel / conteúdo | Superfície UP Glass | Painel |
| UP-025 | 2028 | Clientes cadastrados | Card | Tabela / lista / detalhe |

## compare

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-026 | 73 | Selecione marcas para comparar | Card | Painel |
| UP-027 | 170 | Painel / conteúdo | BrandKpiCard | Painel |
| UP-028 | 215 | {name} | Card | Painel |
| UP-029 | 221 | "Faturamento" | GlassMetricCard | Métrica |
| UP-030 | 222 | "Pedidos" | GlassMetricCard | Métrica |
| UP-031 | 223 | "Ticket médio" | GlassMetricCard | Métrica |
| UP-032 | 224 | "Conversão" | GlassMetricCard | Métrica |
| UP-033 | 282 | Faturamento diário comparado | Card | Gráfico |

## customer-detail

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-034 | 139 | "Visitas" | Configuração de KPI | Métrica configurada |
| UP-035 | 140 | "Cadastrado" | Configuração de KPI | Métrica configurada |
| UP-036 | 141 | "Aprovado" | Configuração de KPI | Métrica configurada |
| UP-037 | 142 | "Visualizações de produtos" | Configuração de KPI | Métrica configurada |
| UP-038 | 143 | "Adições ao carrinho" | Configuração de KPI | Métrica configurada |
| UP-039 | 144 | "Compras" | Configuração de KPI | Métrica configurada |
| UP-040 | 186 | <Megaphone className="h-4 w-4 text-primary" />Atribuição e cadastros | Card | Painel |
| UP-041 | 391 | Painel / conteúdo | Card | Painel |
| UP-042 | 415 | {label} | GlassMetricCard | Métrica |
| UP-043 | 492 | "Primeira campanha" | TouchCard | Painel |
| UP-044 | 497 | "Última campanha" | TouchCard | Painel |
| UP-045 | 502 | "Campanha de retorno" | TouchCard | Painel |
| UP-046 | 507 | "Primeira atividade" | MetricCard | Métrica |
| UP-047 | 512 | "Última atividade" | MetricCard | Métrica |
| UP-048 | 517 | "Produtos vistos" | MetricCard | Métrica |
| UP-049 | 518 | "Carrinhos" | MetricCard | Métrica |
| UP-050 | 519 | "Checkouts" | MetricCard | Métrica |
| UP-051 | 520 | "Compras" | MetricCard | Métrica |
| UP-052 | 521 | "Valor comprado" | MetricCard | Métrica |
| UP-053 | 524 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-054 | 789 | {customer?.name \|\| "Unknown Customer"} | Card | Painel |
| UP-055 | 893 | "Investimento total" | GlassMetricCard | Métrica |
| UP-056 | 894 | "Pedidos" | GlassMetricCard | Métrica |
| UP-057 | 912 | <BarChart2 className="h-4 w-4 text-primary" />Jornada do cliente | Card | Gráfico |
| UP-058 | 931 | Painel / conteúdo | Card | Painel |
| UP-059 | 950 | Painel / conteúdo | Card | Tabela / lista / detalhe |

## customers

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-060 | 112 | {label} | GlassMetricCard | Métrica |
| UP-061 | 377 | "Cadastros" | SummaryKpiCard | Métrica |
| UP-062 | 384 | "Aprovado" | SummaryKpiCard | Métrica |
| UP-063 | 391 | "Taxa de aprovação" | SummaryKpiCard | Métrica |
| UP-064 | 398 | Painel / conteúdo | RegistrationConversionCard | Painel |
| UP-065 | 398 | "Pendente" | SummaryKpiCard | Métrica |
| UP-066 | 405 | "Rejected" | SummaryKpiCard | Métrica |
| UP-067 | 412 | "Total de compradores" | SummaryKpiCard | Métrica |
| UP-068 | 419 | "Aprovados sem compra" | SummaryKpiCard | Métrica |
| UP-069 | 426 | "Dias médios até a primeira compra" | SummaryKpiCard | Métrica |
| UP-070 | 435 | "Cadastros" | SummaryKpiCard | Métrica |
| UP-071 | 443 | "Aprovado" | SummaryKpiCard | Métrica |
| UP-072 | 451 | "Pendente" | SummaryKpiCard | Métrica |
| UP-073 | 459 | "Rejected" | SummaryKpiCard | Métrica |
| UP-074 | 467 | "Taxa de aprovação" | SummaryKpiCard | Métrica |
| UP-075 | 475 | "Total de compradores" | SummaryKpiCard | Métrica |
| UP-076 | 483 | "Aprovados sem compra" | SummaryKpiCard | Métrica |
| UP-077 | 491 | "Dias médios até a primeira compra" | SummaryKpiCard | Métrica |
| UP-078 | 504 | Análise de cadastros | Card | Gráfico |
| UP-079 | 648 | <span className="h-1.5 w-1.5 rounded-full bg-primary" />Concentração por estado | Card | Gráfico |
| UP-080 | 749 | {insight.headline} | Card | Painel |
| UP-081 | 812 | Painel / conteúdo | Card | Painel |
| UP-082 | 950 | Painel / conteúdo | Card | Tabela / lista / detalhe |

## daily

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-083 | 108 | {label} | GlassMetricCard | Métrica |
| UP-084 | 119 | "Carregando relatório diário" | DashLoadingCard | Painel |
| UP-085 | 126 | Painel / conteúdo | Card | Painel |
| UP-086 | 295 | {data?.client.name ?? targetClient?.name ?? "Sua marca"} | Card | Painel |
| UP-087 | 307 | "Faturamento aprovado" | DailyKpiCard | Métrica |
| UP-088 | 320 | "Quantidade de vendas" | DailyKpiCard | Métrica |
| UP-089 | 332 | "Ticket médio" | DailyKpiCard | Métrica |
| UP-090 | 344 | "Custo por compra" | DailyKpiCard | Métrica |
| UP-091 | 357 | "Investimento em mídia" | DailyKpiCard | Métrica |
| UP-092 | 369 | "ROAS" | DailyKpiCard | Métrica |
| UP-093 | 388 | Análise geral | Card | Painel |
| UP-094 | 410 | Resumo do relatório | Card | Painel |
| UP-095 | 431 | Campanhas | Card | Tabela / lista / detalhe |
| UP-096 | 462 | Produtos mais vendidos | Card | Tabela / lista / detalhe |
| UP-097 | 500 | "Categorias" | RankingCard | Painel |
| UP-098 | 501 | "Cores" | RankingCard | Painel |
| UP-099 | 502 | "Tamanhos" | RankingCard | Painel |
| UP-100 | 520 | {title} | Card | Painel |

## dashboard

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-101 | 153 | {title} | Card | Painel |
| UP-102 | 784 | <Megaphone className="h-4 w-4 text-primary" />Clientes atribuídos às campanhas | Card | Tabela / lista / detalhe |
| UP-103 | 797 | "Clientes" | GlassMetricCard | Métrica |
| UP-104 | 798 | "Solicitado" | GlassMetricCard | Métrica |
| UP-105 | 799 | "Pedidos" | GlassMetricCard | Métrica |
| UP-106 | 800 | "Cadastros" | GlassMetricCard | Métrica |
| UP-107 | 807 | "Valor solicitado" | DashboardKpiCard | Métrica |
| UP-108 | 822 | "Valor atendido" | DashboardKpiCard | Métrica |
| UP-109 | 836 | "Investimento" | DashboardKpiCard | Métrica |
| UP-110 | 850 | "ROAS" | DashboardKpiCard | Métrica |
| UP-111 | 1195 | "Eventos" | GlassMetricCard | Métrica |
| UP-112 | 1196 | "Produtos vistos" | GlassMetricCard | Métrica |
| UP-113 | 1197 | "Carrinhos" | GlassMetricCard | Métrica |
| UP-114 | 1198 | "Valor comprado" | GlassMetricCard | Métrica |
| UP-115 | 1405 | <ShoppingBag className="h-4 w-4 text-primary" />Pedidos do período | Card | Tabela / lista / detalhe |
| UP-116 | 1417 | "Pedidos no período" | GlassMetricCard | Métrica |
| UP-117 | 1512 | "Pago" | GlassMetricCard | Métrica |
| UP-118 | 1513 | "Bruto" | GlassMetricCard | Métrica |
| UP-119 | 1514 | "Desconto" | GlassMetricCard | Métrica |
| UP-120 | 1515 | "Frete" | GlassMetricCard | Métrica |
| UP-121 | 1854 | {t("dashboard.loading.title")} | DashLoadingCard | Painel |
| UP-122 | 1943 | {isB2C ? t("dashboard.kpi.totalRevenue.b2c") : t("dashboard.kpi.totalRevenue.b2b")} | DashboardKpiCard | Métrica |
| UP-123 | 1961 | {t("dashboard.kpi.orders")} | DashboardKpiCard | Métrica |
| UP-124 | 1978 | {t("dashboard.kpi.avgTicket")} | DashboardKpiCard | Métrica |
| UP-125 | 1995 | {t("dashboard.kpi.conversionRate")} | DashboardKpiCard | Métrica |
| UP-126 | 2023 | {isB2C ? t("dashboard.kpi.invoicedValue") : t("dashboard.kpi.requestedRevenue")} | GlassMetricCard | Métrica |
| UP-127 | 2055 | {t("dashboard.kpi.buyersThisPeriod")} | GlassMetricCard | Métrica |
| UP-128 | 2125 | {t("dashboard.kpi.buyerRetention")} | DashboardKpiCard | Métrica |
| UP-129 | 2170 | {t("dashboard.chart.title")} | Card | Gráfico |
| UP-130 | 2310 | {insight.headline} | Card | Painel |
| UP-131 | 2385 | {t("dashboard.b2c.byCategory.title")} | B2CSalesBreakdownCard | Painel |
| UP-132 | 2394 | {t("dashboard.b2c.byColor.title")} | B2CSalesBreakdownCard | Painel |
| UP-133 | 2403 | {t("dashboard.b2c.bySize.title")} | B2CSalesBreakdownCard | Gráfico |
| UP-134 | 2422 | {t("dashboard.signals.title")} | Card | Gráfico |
| UP-135 | 2467 | <AlertTriangle className="h-4 w-4 text-amber-400" />{t("dashboard.alerts.title")} | Card | Painel |
| UP-136 | 2615 | {t("dashboard.categories.title")} | Card | Painel |
| UP-137 | 2688 | {t("dashboard.sellers.title")} | Card | Painel |

## erp

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-138 | 377 | {metric.label} | DashboardKpiCard | Métrica |
| UP-139 | 554 | Painel / conteúdo | Card | Gráfico |
| UP-140 | 635 | "Faturamento líquido" | Configuração de KPI | Métrica configurada |
| UP-141 | 647 | "Pedidos" | Configuração de KPI | Métrica configurada |
| UP-142 | 659 | "Compradores" | Configuração de KPI | Métrica configurada |
| UP-143 | 671 | "Retenção" | Configuração de KPI | Métrica configurada |
| UP-144 | 684 | "Peças vendidas" | Configuração de KPI | Métrica configurada |
| UP-145 | 696 | "Descontos" | Configuração de KPI | Métrica configurada |
| UP-146 | 708 | "Devoluções" | Configuração de KPI | Métrica configurada |
| UP-147 | 720 | "Cancelamentos" | Configuração de KPI | Métrica configurada |
| UP-148 | 742 | Painel / conteúdo | Card | Gráfico |
| UP-149 | 786 | Painel / conteúdo | Card | Gráfico |
| UP-150 | 844 | "Formas de pagamento" | BreakdownCard | Painel |
| UP-151 | 850 | "Ranking de vendedores" | BreakdownCard | Painel |
| UP-152 | 856 | "Geografia de compradores" | BreakdownCard | Painel |
| UP-153 | 863 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-154 | 990 | "Faturamento bruto" | Configuração de KPI | Métrica configurada |
| UP-155 | 1002 | "Pedidos únicos" | Configuração de KPI | Métrica configurada |
| UP-156 | 1014 | "Peças vendidas" | Configuração de KPI | Métrica configurada |
| UP-157 | 1026 | "Cancelamentos" | Configuração de KPI | Métrica configurada |
| UP-158 | 1042 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-159 | 1295 | "Pedidos históricos" | GlassMetricCard | Métrica |
| UP-160 | 1296 | "Valor total comprado" | GlassMetricCard | Métrica |
| UP-161 | 1297 | "Ticket médio histórico" | GlassMetricCard | Métrica |
| UP-162 | 1431 | "Compradores" | Configuração de KPI | Métrica configurada |
| UP-163 | 1443 | "Novos compradores" | Configuração de KPI | Métrica configurada |
| UP-164 | 1455 | "Recorrentes" | Configuração de KPI | Métrica configurada |
| UP-165 | 1467 | "Retenção" | Configuração de KPI | Métrica configurada |
| UP-166 | 1484 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-167 | 1937 | "Estoque atual" | Configuração de KPI | Métrica configurada |
| UP-168 | 1947 | "Poder de venda" | Configuração de KPI | Métrica configurada |
| UP-169 | 1957 | "Cobertura" | Configuração de KPI | Métrica configurada |
| UP-170 | 1967 | "SKUs sem estoque" | Configuração de KPI | Métrica configurada |
| UP-171 | 1979 | "Faturamento" | Configuração de KPI | Métrica configurada |
| UP-172 | 1989 | "Lucro bruto" | Configuração de KPI | Métrica configurada |
| UP-173 | 1999 | "% de giro" | Configuração de KPI | Métrica configurada |
| UP-174 | 2013 | "Poder de venda" | Configuração de KPI | Métrica configurada |
| UP-175 | 2028 | "Categorias" | BreakdownCard | Painel |
| UP-176 | 2043 | "Cores" | BreakdownCard | Painel |
| UP-177 | 2055 | "Tamanhos" | BreakdownCard | Painel |
| UP-178 | 2068 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-179 | 2200 | "Vendedores ativos" | Configuração de KPI | Métrica configurada |
| UP-180 | 2210 | "Faturamento" | Configuração de KPI | Métrica configurada |
| UP-181 | 2220 | "Ticket médio" | Configuração de KPI | Métrica configurada |
| UP-182 | 2230 | "Clientes atendidos" | Configuração de KPI | Métrica configurada |
| UP-183 | 2245 | "Ranking de vendedores" | BreakdownCard | Painel |
| UP-184 | 2251 | "Desempenho por loja" | BreakdownCard | Painel |
| UP-185 | 2258 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-186 | 2341 | "Geografia de compradores" | BreakdownCard | Painel |
| UP-187 | 2342 | Painel / conteúdo | Card | Tabela / lista / detalhe |

## extractions

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-188 | 196 | "Execuções" | GlassMetricCard | Métrica |
| UP-189 | 197 | "Rodando" | GlassMetricCard | Métrica |
| UP-190 | 198 | "Concluídas" | GlassMetricCard | Métrica |
| UP-191 | 199 | "Falhas" | GlassMetricCard | Métrica |
| UP-192 | 202 | <DatabaseZap className="h-4 w-4 text-primary" />Histórico de extrações | Card | Tabela / lista / detalhe |

## funnel

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-193 | 250 | Painel / conteúdo | ActivationAnalysisCard | Painel |
| UP-194 | 271 | {visitStepHidden ? "Leads → Compras" : "Visitantes → Compras"} | Card | Painel |
| UP-195 | 319 | {visibleSteps[0]?.label ?? "Topo do funil"} | MiniStat | Métrica |
| UP-196 | 327 | "Compras" | MiniStat | Métrica |
| UP-197 | 335 | {biggestDrop ? Perda em ${biggestDrop.to.label} : "Maior perda"} | MiniStat | Métrica |
| UP-198 | 344 | "Média de eventos antes da compra" | MiniStat | Métrica |
| UP-199 | 361 | Painel / conteúdo | ActivationAnalysisCard | Painel |
| UP-200 | 373 | <TrendingUp className="h-3.5 w-3.5 text-primary" />Visitas diárias ao site e taxa de conversão | Card | Gráfico |
| UP-201 | 511 | <span className="h-1.5 w-1.5 rounded-full bg-primary" />Fluxo por etapa | Card | Gráfico |
| UP-202 | 579 | Painel / conteúdo | Card | Painel |
| UP-203 | 596 | Painel / conteúdo | Card | Painel |
| UP-204 | 756 | Cadastro aprovado → primeira compra | Card | Painel |
| UP-205 | 783 | "Aprovados" | ActivationMetric | Métrica |
| UP-206 | 784 | "Ativação em 30 dias" | ActivationMetric | Métrica |
| UP-207 | 789 | "Ticket 1ª compra" | ActivationMetric | Métrica |
| UP-208 | 914 | {label} | GlassMetricCard | Métrica |
| UP-209 | 1001 | {label} | GlassMetricCard | Métrica |

## geography

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-210 | 166 | Onde estão seus clientes{" "}<span className="bg-gradient-to-r from-primary via-chart-1 to-chart-3 bg-clip-text text-transparent"> buying </span> | Card | Painel |
| UP-211 | 208 | "Faturamento total" | HeroStat | Métrica |
| UP-212 | 217 | "States covered" | HeroStat | Métrica |
| UP-213 | 225 | "Cidades" | HeroStat | Métrica |
| UP-214 | 233 | {topState ? Top · ${topState.state} : "Principal mercado"} | HeroStat | Métrica |
| UP-215 | 256 | <span className="h-1.5 w-1.5 rounded-full bg-primary" />Mapa de faturamento no Brasil | Card | Gráfico |
| UP-216 | 284 | <Flame className="h-4 w-4 text-amber-500" />Mercados em destaque | Card | Painel |
| UP-217 | 399 | <span className="h-1.5 w-1.5 rounded-full bg-primary" />{view === "state" ? "Todos os estados" : "Todas as cidades"} | Card | Tabela / lista / detalhe |
| UP-218 | 566 | {label} | GlassMetricCard | Métrica |

## journey

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-219 | 56 | {label} | GlassMetricCard | Métrica |
| UP-220 | 166 | Painel / conteúdo | Card | Painel |
| UP-221 | 209 | "Média de eventos antes da compra" | KpiCard | Métrica |
| UP-222 | 216 | "Tempo médio até a primeira compra" | KpiCard | Métrica |
| UP-223 | 223 | "Tempo médio entre compras" | KpiCard | Métrica |
| UP-224 | 230 | "Compradores na primeira sessão" | KpiCard | Métrica |
| UP-225 | 244 | <span className="h-1.5 w-1.5 rounded-full bg-primary" />Fluxo de eventos | Card | Painel |
| UP-226 | 263 | <span className="h-1.5 w-1.5 rounded-full bg-chart-3" />Principais caminhos até a compra | Card | Painel |
| UP-227 | 311 | <span className="h-1.5 w-1.5 rounded-full bg-chart-4" />Compradores e não compradores — comparação de eventos | Card | Gráfico |
| UP-228 | 408 | Painel / conteúdo | Card | Painel |

## login

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-229 | 110 | "Faturamento hoje" | Configuração de KPI | Métrica configurada |
| UP-230 | 119 | "Pedidos atualizados" | Configuração de KPI | Métrica configurada |
| UP-231 | 128 | "Conversão" | Configuração de KPI | Métrica configurada |
| UP-232 | 137 | "Usuários ativos" | Configuração de KPI | Métrica configurada |

## marketing

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-233 | 203 | {label} | GlassMetricCard | Métrica |
| UP-234 | 376 | Painel / conteúdo | Card | Painel |
| UP-235 | 385 | "CTR" | GlassMetricCard | Métrica |
| UP-236 | 386 | {costLabel} | GlassMetricCard | Métrica |
| UP-237 | 387 | "Leads" | GlassMetricCard | Métrica |
| UP-238 | 388 | "Investimento" | GlassMetricCard | Métrica |
| UP-239 | 420 | <Sparkles className="h-4 w-4 text-muted-foreground" />{title} | Card | Painel |
| UP-240 | 430 | Painel / conteúdo | TopCreativeCard | Painel |
| UP-241 | 460 | Painel / conteúdo | Card | Painel |
| UP-242 | 762 | Sem dados de canais pagos | Card | Painel |
| UP-243 | 798 | "Investimento em anúncios" | MktKpiCard | Métrica |
| UP-244 | 810 | "Faturamento" | MktKpiCard | Métrica |
| UP-245 | 822 | "ROA" | MktKpiCard | Métrica |
| UP-246 | 834 | "Taxa de aprovação" | MktKpiCard | Métrica |
| UP-247 | 846 | "Total de leads" | MktKpiCard | Métrica |
| UP-248 | 858 | {isB2C ? "Compras" : "Leads aprovados"} | MktKpiCard | Métrica |
| UP-249 | 870 | {isB2C ? "Custo por Compra" : "CPL"} | MktKpiCard | Métrica |
| UP-250 | 884 | "CPA" | MktKpiCard | Métrica |
| UP-251 | 912 | Painel / conteúdo | Card | Painel |
| UP-252 | 932 | <BarChart3 className="h-4 w-4 text-muted-foreground" />Investimento e leads | Card | Gráfico |
| UP-253 | 964 | <TrendingUp className="h-4 w-4 text-muted-foreground" />Evolução do ROAS | Card | Gráfico |
| UP-254 | 1002 | <DollarSign className="h-4 w-4 text-muted-foreground" />Investimento e faturamento | Card | Gráfico |
| UP-255 | 1048 | <Megaphone className="h-4 w-4 text-muted-foreground" />Por plataforma | Card | Painel |
| UP-256 | 1067 | <MapPin className="h-4 w-4 text-muted-foreground" />Principais estados por ROAS | Card | Painel |
| UP-257 | 1090 | <PersonStanding className="h-4 w-4 text-muted-foreground" />Faixa etária dos clientes (leads pagos) | Card | Painel |
| UP-258 | 1131 | Desempenho de campanhas | Card | Painel |

## monthly-history

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-259 | 234 | Histórico Mensal | Card | Tabela / lista / detalhe |

## not-found

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-260 | 7 | Painel / conteúdo | Card | Painel |

## notifications

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-261 | 112 | Painel / conteúdo | Card | Painel |

## orchestrator

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-262 | 399 | Painel / conteúdo | Card | Painel |
| UP-263 | 443 | "Marcas B2B" | DashboardKpiCard | Métrica |
| UP-264 | 460 | "Cadastros IA" | DashboardKpiCard | Métrica |
| UP-265 | 477 | "Pedidos influenciados" | DashboardKpiCard | Métrica |
| UP-266 | 494 | "Qualidade IA" | DashboardKpiCard | Métrica |
| UP-267 | 515 | Marcas no Orquestrador | Card | Tabela / lista / detalhe |
| UP-268 | 648 | Painel / conteúdo | Card | Painel |
| UP-269 | 721 | Cadastros criados pela IA | Card | Tabela / lista / detalhe |
| UP-270 | 912 | Painel / conteúdo | Card | Painel |
| UP-271 | 952 | Painel / conteúdo | Card | Painel |
| UP-272 | 977 | Painel / conteúdo | Card | Painel |
| UP-273 | 1028 | Painel / conteúdo | Card | Painel |
| UP-274 | 1032 | <span>{automationAudience === "internal_seller" ? "Nova notificação interna" : "Nova automação"}</span><Button type="button" variant="ghost" size="icon" onClick={() => setIsCreatingRule(false)} aria-label="Cancelar nova automação" title="Cancelar" > <X /> </Button> | Card | Painel |
| UP-275 | 1160 | <span className="flex items-center gap-2"> {eventLabel} <Badge variant="secondary">Etapa {rule.sequence ?? 1}</Badge> </span><div className="flex items-center gap-2 text-sm font-normal text-muted-foreground"> <span>{rule.enabled ? "Ativa" : "Inativa"}</span> <Switch checked={rule.enabled} onCheckedChange={(checked) => updateRule.mutate({ ruleId: rule.id, patch: { isEnabled: checked } })} aria-label={Ativar ${rule.name}} /> </div> | Card | Painel |
| UP-276 | 1279 | Painel / conteúdo | Card | Painel |
| UP-277 | 1331 | Criar agente para {agentsQuery.data?.client?.name ?? "cliente"} | Card | Painel |
| UP-278 | 1374 | <span className="flex items-center gap-2"><Bot className="h-4 w-4 text-primary" />{agent.name}</span><Badge variant={agent.status === "active" ? "default" : "outline"}>{agent.status === "active" ? "Ativo" : "Rascunho"}</Badge> | Card | Painel |
| UP-279 | 1411 | Painel / conteúdo | Card | Painel |
| UP-280 | 1425 | Integração UP Zero | Card | Painel |
| UP-281 | 1442 | Configurações gerais | Card | Painel |
| UP-282 | 1461 | Regras comerciais editáveis | Card | Painel |
| UP-283 | 1475 | Painel / conteúdo | Card | Painel |
| UP-284 | 1485 | Painel / conteúdo | Card | Painel |
| UP-285 | 1509 | Simulador de atendimento | Card | Painel |
| UP-286 | 1519 | Resposta simulada | Card | Painel |
| UP-287 | 1557 | Webhook UP Zero | Card | Painel |
| UP-288 | 1575 | Logs da operação | Card | Painel |
| UP-289 | 1663 | Painel / conteúdo | Card | Painel |
| UP-290 | 1665 | "Marca em configuração" | GlassMetricCard | Métrica |
| UP-291 | 1695 | "Conversas" | DashboardKpiCard | Métrica |
| UP-292 | 1712 | "Cadastros" | DashboardKpiCard | Métrica |
| UP-293 | 1729 | "Pedidos" | DashboardKpiCard | Métrica |
| UP-294 | 1746 | "Handoffs" | DashboardKpiCard | Métrica |

## orders

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-295 | 287 | {t("orders.selectBrand.title", "Selecione uma marca")} | Card | Painel |
| UP-296 | 313 | {isB2C ? "Faturamento faturado" : t("orders.kpi.requestedRevenue", "Faturamento solicitado")} | DashboardKpiCard | Métrica |
| UP-297 | 329 | {isB2C ? "Faturamento pago" : t("orders.kpi.fulfilledRevenue", "Faturamento atendido")} | DashboardKpiCard | Métrica |
| UP-298 | 344 | {isB2C ? "Peças faturadas" : t("orders.kpi.requestedQuantity", "Peças solicitadas")} | DashboardKpiCard | Métrica |
| UP-299 | 359 | {isB2C ? "Peças pagas" : t("orders.kpi.fulfilledQuantity", "Peças atendidas")} | DashboardKpiCard | Métrica |
| UP-300 | 374 | {isB2C ? "% Pago" : t("orders.kpi.fulfilledPct", "% de atendido")} | DashboardKpiCard | Métrica |
| UP-301 | 390 | {t("orders.kpi.orders", "Qtd de pedidos")} | DashboardKpiCard | Métrica |
| UP-302 | 405 | {isB2C ? "Novos compradores" : t("orders.kpi.newCustomers", "Clientes novos")} | DashboardKpiCard | Métrica |
| UP-303 | 420 | {isB2C ? "Recompradores" : t("orders.kpi.returningCustomers", "Clientes recorrentes")} | DashboardKpiCard | Métrica |
| UP-304 | 435 | {t("orders.kpi.retentionPct", "% de retenção")} | DashboardKpiCard | Métrica |
| UP-305 | 451 | {t("orders.kpi.conversionPct", "% de conversão")} | DashboardKpiCard | Métrica |
| UP-306 | 471 | <ShoppingBag className="h-4 w-4 text-primary" />{t("orders.list.title", "Lista de pedidos")} | Card | Tabela / lista / detalhe |
| UP-307 | 622 | {isB2C ? "Valor faturado" : "Valor solicitado"} | GlassMetricCard | Métrica |
| UP-308 | 623 | {isB2C ? "Valor pago" : "Valor atendido"} | GlassMetricCard | Métrica |
| UP-309 | 624 | {isB2C ? "Peças faturadas" : "Peças solicitadas"} | GlassMetricCard | Métrica |
| UP-310 | 625 | {isB2C ? "Peças pagas" : "Peças atendidas"} | GlassMetricCard | Métrica |
| UP-311 | 675 | {isB2C ? "Faturada" : "Solicitada"} | GlassMetricCard | Métrica |
| UP-312 | 676 | {isB2C ? "Paga" : "Atendida"} | GlassMetricCard | Métrica |
| UP-313 | 677 | "Valor" | GlassMetricCard | Métrica |

## organized-pages

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-314 | 37 | {pick( "acquisitionRevenue", "acquisitionTicket", "acquisitionOrders", "newCustomers", )} | Metrics | Métrica |
| UP-315 | 47 | {pick("cac", "costRegistration", "costApproved", "spend")} | Metrics | Métrica |
| UP-316 | 52 | {pick("approved", "approvedConverted", "approvedConversion")} | Metrics | Métrica |
| UP-317 | 57 | {pick("firstPurchaseAverage", "firstPurchaseMedian")} | Metrics | Métrica |
| UP-318 | 68 | {title} | Card | Gráfico |
| UP-319 | 142 | {pick( "spend", "requestedRoas", "paidRoas", "approvedConversion", )} | Metrics | Métrica |
| UP-320 | 158 | Etapas operacionais | Card | Painel |
| UP-321 | 162 | {stage.label} | GlassMetricCard | Métrica |
| UP-322 | 189 | {pick( "metaSpend", "impressions", "reach", "frequency", "clicks", "ctr", "cpc", "cpm", "metaPurchases", "metaCpa", "metaRoas", )} | Metrics | Métrica |

## overview

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-323 | 127 | {label} | GlassMetricCard | Métrica |
| UP-324 | 189 | {title} | Card | Painel |
| UP-325 | 416 | Clientes nos totais da plataforma | Card | Painel |
| UP-326 | 496 | "Faturamento da plataforma" | KpiTile | Métrica |
| UP-327 | 507 | "Pedidos da plataforma" | KpiTile | Métrica |
| UP-328 | 518 | "Clientes ativos" | KpiTile | Métrica |
| UP-329 | 529 | "Marcas ativas" | KpiTile | Métrica |
| UP-330 | 541 | "Ticket médio da plataforma" | KpiTile | Métrica |
| UP-331 | 561 | "Investimento em anúncios" | KpiTile | Métrica |
| UP-332 | 572 | "ROAS geral" | KpiTile | Métrica |
| UP-333 | 583 | "Total de leads" | KpiTile | Métrica |
| UP-334 | 594 | "Leads aprovados" | KpiTile | Métrica |
| UP-335 | 607 | Evolução da plataforma | Card | Gráfico |
| UP-336 | 728 | "Melhores desempenhos" | LeaderboardCard | Painel |
| UP-337 | 740 | "Maior crescimento" | LeaderboardCard | Painel |
| UP-338 | 752 | "Precisa de atenção" | LeaderboardCard | Painel |
| UP-339 | 766 | Marcas selecionadas | Card | Painel |

## performance-recompra

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-340 | 216 | {title} | GlassMetricCard | Métrica |
| UP-341 | 414 | Painel / conteúdo | PeriodCalendarCard | Painel |
| UP-342 | 719 | Painel / conteúdo | Card | Painel |
| UP-343 | 800 | "Resultado de recompra" | RecompraBlockCard | Métrica |
| UP-344 | 812 | "Vendas de recompra" | Configuração de KPI | Métrica configurada |
| UP-345 | 813 | "Ticket médio" | Configuração de KPI | Métrica configurada |
| UP-346 | 814 | "Clientes em recompra" | Configuração de KPI | Métrica configurada |
| UP-347 | 817 | "Clientes recorrentes" | RecompraBlockCard | Métrica |
| UP-348 | 829 | "Vendas recorrentes" | Configuração de KPI | Métrica configurada |
| UP-349 | 830 | "Faturamento recorrente" | Configuração de KPI | Métrica configurada |
| UP-350 | 831 | "Ticket médio recorrente" | Configuração de KPI | Métrica configurada |
| UP-351 | 834 | "Clientes reativados" | RecompraBlockCard | Métrica |
| UP-352 | 846 | "Vendas reativadas" | Configuração de KPI | Métrica configurada |
| UP-353 | 847 | "Faturamento reativado" | Configuração de KPI | Métrica configurada |
| UP-354 | 848 | "Ticket médio reativado" | Configuração de KPI | Métrica configurada |
| UP-355 | 851 | "Ciclo de recompra" | RecompraBlockCard | Métrica |
| UP-356 | 864 | "Mediana entre compras" | Configuração de KPI | Métrica configurada |
| UP-357 | 865 | "% recorrente" | Configuração de KPI | Métrica configurada |
| UP-358 | 866 | "% reativado" | Configuração de KPI | Métrica configurada |
| UP-359 | 888 | Resultado de recompra | Card | Gráfico |
| UP-360 | 912 | Volume de recompra | Card | Gráfico |
| UP-361 | 935 | Recorrentes x Reativados | Card | Gráfico |
| UP-362 | 962 | Intervalo entre compras | Card | Gráfico |
| UP-363 | 1010 | Retenção acumulada por prazo | Card | Tabela / lista / detalhe |
| UP-364 | 1051 | Retenção por número de compra | Card | Gráfico |
| UP-365 | 1084 | Desempenho por vendedora | Card | Tabela / lista / detalhe |
| UP-366 | 1132 | Detalhamento de recompra | Card | Tabela / lista / detalhe |

## performance

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-367 | 454 | {title} | Card | Gráfico |
| UP-368 | 697 | "Faturamento ERP" | Configuração de KPI | Métrica configurada |
| UP-369 | 709 | "Receita atribuída" | Configuração de KPI | Métrica configurada |
| UP-370 | 726 | "Investimento" | Configuração de KPI | Métrica configurada |
| UP-371 | 738 | "ROAS atribuído" | Configuração de KPI | Métrica configurada |
| UP-372 | 750 | "MER geral" | Configuração de KPI | Métrica configurada |
| UP-373 | 762 | "Lucro bruto" | Configuração de KPI | Métrica configurada |
| UP-374 | 777 | "ROI final" | Configuração de KPI | Métrica configurada |
| UP-375 | 794 | "Ticket médio" | Configuração de KPI | Métrica configurada |
| UP-376 | 811 | "Pedidos ERP" | Configuração de KPI | Métrica configurada |
| UP-377 | 823 | "Pedidos atribuídos" | Configuração de KPI | Métrica configurada |
| UP-378 | 841 | "Compradores únicos" | Configuração de KPI | Métrica configurada |
| UP-379 | 855 | "Clientes novos" | Configuração de KPI | Métrica configurada |
| UP-380 | 872 | "Clientes recorrentes" | Configuração de KPI | Métrica configurada |
| UP-381 | 886 | "CAC" | Configuração de KPI | Métrica configurada |
| UP-382 | 898 | "CTR" | Configuração de KPI | Métrica configurada |
| UP-383 | 910 | "CPL" | Configuração de KPI | Métrica configurada |
| UP-384 | 1079 | Painel / conteúdo | DashboardKpiCard | Métrica |
| UP-385 | 1097 | Painel / conteúdo | Card | Gráfico |
| UP-386 | 1161 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-387 | 1201 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-388 | 1238 | {COHORT_LABEL[cohort]} | GlassMetricCard | Métrica |
| UP-389 | 1337 | Painel / conteúdo | DashboardKpiCard | Métrica |
| UP-390 | 1359 | Painel / conteúdo | DashboardKpiCard | Métrica |
| UP-391 | 1373 | Painel / conteúdo | Card | Painel |
| UP-392 | 1422 | {item.label} | GlassMetricCard | Métrica |
| UP-393 | 1430 | Painel / conteúdo | Card | Painel |
| UP-394 | 1439 | {stage.label} | GlassMetricCard | Métrica |
| UP-395 | 1453 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-396 | 1549 | "Vendas por cor" | BreakdownCard | Painel |
| UP-397 | 1554 | "Vendas por tamanho" | BreakdownCard | Painel |
| UP-398 | 1559 | "Vendas por estado" | BreakdownCard | Painel |
| UP-399 | 1566 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-400 | 1662 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-401 | 1753 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-402 | 1812 | "Pedidos no período" | GlassMetricCard | Métrica |
| UP-403 | 1813 | "Valor total" | GlassMetricCard | Métrica |
| UP-404 | 1814 | "Pedidos atribuídos" | GlassMetricCard | Métrica |
| UP-405 | 1815 | "Receita atribuída" | GlassMetricCard | Métrica |
| UP-406 | 1817 | "Faturamento pago atribuído" | GlassMetricCard | Métrica |

## product-detail

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-407 | 79 | {label} | GlassMetricCard | Métrica |
| UP-408 | 221 | {product.name} | Card | Painel |
| UP-409 | 274 | "Faturamento histórico" | KpiTile | Métrica |
| UP-410 | 275 | "Unidades vendidas" | KpiTile | Métrica |
| UP-411 | 276 | "Ticket médio" | KpiTile | Métrica |
| UP-412 | 277 | "Sell-through" | KpiTile | Métrica |
| UP-413 | 287 | <TrendingUp className="h-4 w-4" />Evolução do faturamento | Card | Gráfico |
| UP-414 | 367 | Painel / conteúdo | Card | Gráfico |
| UP-415 | 385 | <Users className="h-4 w-4" />Principais compradores | Card | Tabela / lista / detalhe |

## products

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-416 | 416 | "Sales Power" | GlassMetricCard | Métrica |
| UP-417 | 417 | "Faturamento por SKU/dia" | GlassMetricCard | Métrica |
| UP-418 | 418 | "SKUs ativos" | GlassMetricCard | Métrica |
| UP-419 | 419 | "Período" | GlassMetricCard | Métrica |
| UP-420 | 444 | {insight.headline} | Card | Painel |
| UP-421 | 506 | Painel / conteúdo | Card | Painel |
| UP-422 | 599 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-423 | 744 | "Vendidos" | GlassMetricCard | Métrica |
| UP-424 | 745 | "Receita" | GlassMetricCard | Métrica |
| UP-425 | 746 | "Estoque" | GlassMetricCard | Métrica |

## rfm

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-426 | 164 | {title} | GlassMetricCard | Métrica |
| UP-427 | 296 | Painel / conteúdo | Card | Painel |
| UP-428 | 339 | "Recência" | RfmLogicCard | Métrica |
| UP-429 | 346 | "Frequência" | RfmLogicCard | Métrica |
| UP-430 | 353 | "Monetário" | RfmLogicCard | Métrica |
| UP-431 | 377 | {meta.label} | GlassMetricCard | Métrica |
| UP-432 | 393 | <span className="h-1.5 w-1.5 rounded-full bg-primary" />Evolução da composição dos segmentos | Card | Gráfico |
| UP-433 | 455 | <span className="h-1.5 w-1.5 rounded-full bg-chart-3" />Compradoras RFM <span className="text-muted-foreground font-normal">({formatNumber(total)})</span><InfoHint text="A lista mostra clientes que solicitaram pedidos no período filtrado. Por padrão entram todos os pedidos; use o filtro de status para analisar somente aprovados, pendentes ou recusados." /> | Card | Tabela / lista / detalhe |
| UP-434 | 692 | Painel / conteúdo | Card | Painel |
| UP-435 | 733 | "Solicitado" | GlassMetricCard | Métrica |
| UP-436 | 734 | "Atendido" | GlassMetricCard | Métrica |
| UP-437 | 735 | "Peças solicitadas" | GlassMetricCard | Métrica |
| UP-438 | 736 | "Peças atendidas" | GlassMetricCard | Métrica |

## sales-agent

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-439 | 33 | {title} | GlassMetricCard | Métrica |
| UP-440 | 47 | Painel / conteúdo | Card | Painel |
| UP-441 | 62 | "Conversas" | Metric | Métrica |
| UP-442 | 68 | "Cadastros" | Metric | Métrica |
| UP-443 | 74 | "Pedidos" | Metric | Métrica |
| UP-444 | 80 | "Números conectados" | Metric | Métrica |
| UP-445 | 88 | CRM simplificado | Card | Painel |
| UP-446 | 97 | Cadastros criados | Card | Tabela / lista / detalhe |

## scale

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-447 | 158 | {title} | Card | Painel |
| UP-448 | 199 | Painel / conteúdo | Card | Painel |
| UP-449 | 218 | "Carregando Escala" | DashLoadingCard | Painel |
| UP-450 | 357 | {item.label} | GlassMetricCard | Métrica |
| UP-451 | 362 | Calculadora de projeção | Card | Painel |
| UP-452 | 450 | Insights de escala | Card | Painel |
| UP-453 | 496 | Painel / conteúdo | ScenarioCard | Painel |
| UP-454 | 501 | "Categorias mais vendidas" | BreakdownCard | Painel |
| UP-455 | 502 | "Tamanhos mais vendidos" | BreakdownCard | Painel |
| UP-456 | 503 | "Cores mais vendidas" | BreakdownCard | Painel |
| UP-457 | 504 | "Poder por categoria" | BreakdownCard | Painel |
| UP-458 | 507 | Como a projeção foi calculada | Card | Painel |

## seller-detail

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-459 | 81 | {label} | GlassMetricCard | Métrica |
| UP-460 | 253 | {seller.name} | Card | Painel |
| UP-461 | 301 | Painel / conteúdo | Card | Painel |
| UP-462 | 308 | "Faturamento" | KpiCard | Métrica |
| UP-463 | 316 | "Pedidos" | KpiCard | Métrica |
| UP-464 | 323 | "Ticket médio" | KpiCard | Métrica |
| UP-465 | 330 | "Clientes" | KpiCard | Métrica |
| UP-466 | 337 | "Taxa de aprovação" | KpiCard | Métrica |
| UP-467 | 344 | "% de conversão" | KpiCard | Métrica |
| UP-468 | 358 | <TrendingUp className="h-4 w-4" />Evolução do faturamento | Card | Gráfico |
| UP-469 | 461 | <BarChart2 className="h-4 w-4" />Faturamento por categoria | Card | Gráfico |
| UP-470 | 476 | <MapPin className="h-4 w-4" />Faturamento por estado | Card | Gráfico |
| UP-471 | 496 | <Users className="h-4 w-4" />Principais clientes | Card | Tabela / lista / detalhe |
| UP-472 | 586 | <ShoppingBag className="h-4 w-4" />Pedidos recentes | Card | Tabela / lista / detalhe |

## sellers

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-473 | 177 | "Faturamento total" | GlassMetricCard | Métrica |
| UP-474 | 181 | "Vendedoras ativas" | GlassMetricCard | Métrica |
| UP-475 | 185 | "Principal vendedora" | GlassMetricCard | Métrica |
| UP-476 | 192 | {insight.headline} | Card | Painel |
| UP-477 | 255 | Painel / conteúdo | Card | Gráfico |
| UP-478 | 415 | Painel / conteúdo | Card | Painel |
| UP-479 | 455 | {seller.name} | Card | Painel |

## stock-intelligence

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-480 | 133 | {label} | GlassMetricCard | Métrica |
| UP-481 | 160 | Painel / conteúdo | Card | Painel |
| UP-482 | 388 | {insight.headline} | Card | Painel |
| UP-483 | 458 | Painel / conteúdo | Card | Painel |
| UP-484 | 465 | "Total de unidades em estoque" | KpiCard | Métrica |
| UP-485 | 472 | "Cobertura média em dias" | KpiCard | Métrica |
| UP-486 | 479 | "SKUs com risco de ruptura" | KpiCard | Métrica |
| UP-487 | 487 | "SKUs com risco de excesso" | KpiCard | Métrica |
| UP-488 | 495 | "Sell-through Rate" | KpiCard | Métrica |
| UP-489 | 513 | Painel / conteúdo | Card | Painel |
| UP-490 | 553 | Todos os SKUs | Card | Tabela / lista / detalhe |
| UP-491 | 744 | Painel / conteúdo | Card | Gráfico |
| UP-492 | 822 | Painel / conteúdo | Card | Gráfico |
| UP-493 | 882 | Painel / conteúdo | Card | Gráfico |
| UP-494 | 970 | "Unidades vendidas" | GlassMetricCard | Métrica |
| UP-495 | 971 | "Unidades em estoque" | GlassMetricCard | Métrica |
| UP-496 | 972 | "Velocidade diária" | GlassMetricCard | Métrica |
| UP-497 | 973 | "Dias de cobertura" | GlassMetricCard | Métrica |

## utm

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-498 | 78 | {label} | GlassMetricCard | Métrica |
| UP-499 | 359 | "Sessões" | KpiCard | Métrica |
| UP-500 | 366 | "Cadastros" | KpiCard | Métrica |
| UP-501 | 372 | "% de aprovação" | KpiCard | Métrica |
| UP-502 | 379 | "Compradores" | KpiCard | Métrica |
| UP-503 | 385 | "Faturamento" | KpiCard | Métrica |
| UP-504 | 392 | "% de conversão" | KpiCard | Métrica |
| UP-505 | 399 | "ROAS" | KpiCard | Métrica |
| UP-506 | 413 | {insight.headline} | Card | Painel |
| UP-507 | 487 | Faturamento por {GROUP_LABELS[groupBy]} | Card | Gráfico |
| UP-508 | 543 | % de conversão por {GROUP_LABELS[groupBy]} | Card | Gráfico |
| UP-509 | 615 | Painel / conteúdo | Card | Painel |

## whatsapp-connections

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-510 | 727 | <PlugZap className="h-4 w-4 text-primary" />Conectar WhatsApp Business | Card | Painel |
| UP-511 | 903 | "Conexões" | GlassMetricCard | Métrica |
| UP-512 | 904 | "Números cadastrados" | GlassMetricCard | Métrica |
| UP-513 | 905 | Painel / conteúdo | Card | Painel |
| UP-514 | 933 | Painel / conteúdo | Card | Painel |
| UP-515 | 950 | <Webhook className="h-4 w-4 text-primary" />Webhook da Meta | Card | Painel |
| UP-516 | 995 | {syncCopy.title} | Card | Painel |
| UP-517 | 1062 | "Mensagens importadas" | GlassMetricCard | Métrica |
| UP-518 | 1063 | "Eventos de histórico" | GlassMetricCard | Métrica |
| UP-519 | 1081 | <Smartphone className="h-4 w-4 text-primary" />Telefones de campanha | Card | Painel |
| UP-520 | 1176 | {numberTitle(phone)} | Card | Painel |

## whatsapp-conversations

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-521 | 215 | "Conversas" | GlassMetricCard | Métrica |
| UP-522 | 216 | "Mensagens aguardando" | GlassMetricCard | Métrica |
| UP-523 | 217 | "Encerradas" | GlassMetricCard | Métrica |
| UP-524 | 218 | Painel / conteúdo | Card | Painel |
| UP-525 | 231 | Conversas | Card | Painel |

## whatsapp-sends

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-526 | 169 | <Send className="h-4 w-4 text-primary" />Envio teste WhatsApp | Card | Painel |

## whatsapp-templates

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-527 | 764 | "Aprovados" | GlassMetricCard | Métrica |
| UP-528 | 765 | "Pendentes" | GlassMetricCard | Métrica |
| UP-529 | 766 | "Recusados" | GlassMetricCard | Métrica |
| UP-530 | 804 | {phoneLabel(selectedPhone)} | Card | Painel |
| UP-531 | 856 | Variaveis para templates e automacoes | Card | Painel |
| UP-532 | 922 | Criar template | Card | Painel |
| UP-533 | 1283 | Modelos cadastrados | Card | Tabela / lista / detalhe |

## whatsapp

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-534 | 213 | {label} | GlassMetricCard | Métrica |
| UP-535 | 423 | <MessageCircle className="h-4 w-4 text-primary" />Atendimento WhatsApp | Card | Painel |
| UP-536 | 489 | "Total de conversas" | KpiCard | Métrica |
| UP-537 | 490 | "Novos leads" | KpiCard | Métrica |
| UP-538 | 491 | "Leads recorrentes" | KpiCard | Métrica |
| UP-539 | 492 | "Mensagens recebidas" | KpiCard | Métrica |
| UP-540 | 493 | "Mensagens enviadas" | KpiCard | Métrica |
| UP-541 | 494 | "Tempo 1ª resposta" | KpiCard | Métrica |
| UP-542 | 495 | "SLA cumprido" | KpiCard | Métrica |
| UP-543 | 496 | "Leads sem resposta" | KpiCard | Métrica |
| UP-544 | 497 | "Aguardando resposta" | KpiCard | Métrica |
| UP-545 | 498 | "Encerradas" | KpiCard | Métrica |
| UP-546 | 499 | "Perdidas" | KpiCard | Métrica |
| UP-547 | 503 | Conversas por dia | Card | Gráfico |
| UP-548 | 518 | Conversas por hora | Card | Gráfico |
| UP-549 | 533 | Recebidas vs enviadas | Card | Gráfico |
| UP-550 | 549 | Ranking por conversas atendidas | Card | Gráfico |
| UP-551 | 566 | Funil comercial do WhatsApp | Card | Gráfico |
| UP-552 | 600 | Taxa de avanço por etapa | Card | Painel |
| UP-553 | 634 | Tempo médio de primeira resposta por perfil WhatsApp | Card | Gráfico |
| UP-554 | 650 | Conversas sem resposta | Card | Tabela / lista / detalhe |
| UP-555 | 678 | Motivos de perda | Card | Tabela / lista / detalhe |
| UP-556 | 703 | Produtividade por perfil WhatsApp | Card | Tabela / lista / detalhe |

## purchase-insights

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-557 | 15 | Painel / conteúdo | Card | Painel |
| UP-558 | 34 | Painel / conteúdo | Card | Painel |
| UP-559 | 34 | Painel / conteúdo | Card | Painel |
| UP-560 | 36 | Distribuição de compradores | Card | Painel |
| UP-561 | 42 | "Compram na primeira semana" | GlassMetricCard | Métrica |
| UP-562 | 43 | "Compram em até 30 dias" | GlassMetricCard | Métrica |
| UP-563 | 44 | "Mediana até o pedido" | GlassMetricCard | Métrica |

## acquisition-funnel

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-564 | 7 | {title} | Card | Painel |

## product-sales-charts

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-565 | 69 | {title} | Card | Gráfico |
| UP-566 | 148 | Painel / conteúdo | Card | Painel |
| UP-567 | 151 | "Vendas por Categoria" | ProductSalesCard | Painel |
| UP-568 | 152 | "Vendas por Cor" | ProductSalesCard | Painel |
| UP-569 | 153 | "Vendas por Tamanho" | ProductSalesCard | Painel |

