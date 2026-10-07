# Mapeamento card por card · UP Glass

568 pontos de uso/configuração encontrados nas 41 arquivos com cards (páginas e componentes compartilhados). Cada linha identifica a posição no código, o título ou expressão dinâmica e o componente final. Modelos dentro de loops são registrados na sua declaração; a quantidade de cards em execução depende dos dados. As configurações de KPI também são listadas para identificar as métricas que alimentam um modelo compartilhado.

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
| UP-210 | 175 | <Globe2 className="h-5 w-5 shrink-0 text-primary" />Onde estão seus clientes | Card | Painel |
| UP-211 | 193 | "Faturamento total" | GlassMetricCard | Métrica |
| UP-212 | 200 | "Estados atendidos" | GlassMetricCard | Métrica |
| UP-213 | 206 | "Cidades" | GlassMetricCard | Métrica |
| UP-214 | 212 | {topState ? Principal mercado · ${topState.state} : "Principal mercado"} | GlassMetricCard | Métrica |
| UP-215 | 229 | <span className="h-1.5 w-1.5 rounded-full bg-primary" />Mapa de faturamento no Brasil | Card | Gráfico |
| UP-216 | 258 | <Flame className="h-4 w-4 text-primary" />Mercados em destaque | Card | Painel |
| UP-217 | 360 | <span className="h-1.5 w-1.5 rounded-full bg-primary" />{view === "state" ? "Todos os estados" : "Todas as cidades"} | Card | Tabela / lista / detalhe |

## journey

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-218 | 56 | {label} | GlassMetricCard | Métrica |
| UP-219 | 166 | Painel / conteúdo | Card | Painel |
| UP-220 | 209 | "Média de eventos antes da compra" | KpiCard | Métrica |
| UP-221 | 216 | "Tempo médio até a primeira compra" | KpiCard | Métrica |
| UP-222 | 223 | "Tempo médio entre compras" | KpiCard | Métrica |
| UP-223 | 230 | "Compradores na primeira sessão" | KpiCard | Métrica |
| UP-224 | 244 | <span className="h-1.5 w-1.5 rounded-full bg-primary" />Fluxo de eventos | Card | Painel |
| UP-225 | 263 | <span className="h-1.5 w-1.5 rounded-full bg-chart-3" />Principais caminhos até a compra | Card | Painel |
| UP-226 | 311 | <span className="h-1.5 w-1.5 rounded-full bg-chart-4" />Compradores e não compradores — comparação de eventos | Card | Gráfico |
| UP-227 | 408 | Painel / conteúdo | Card | Painel |

## login

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-228 | 110 | "Faturamento hoje" | Configuração de KPI | Métrica configurada |
| UP-229 | 119 | "Pedidos atualizados" | Configuração de KPI | Métrica configurada |
| UP-230 | 128 | "Conversão" | Configuração de KPI | Métrica configurada |
| UP-231 | 137 | "Usuários ativos" | Configuração de KPI | Métrica configurada |

## marketing

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-232 | 203 | {label} | GlassMetricCard | Métrica |
| UP-233 | 376 | Painel / conteúdo | Card | Painel |
| UP-234 | 385 | "CTR" | GlassMetricCard | Métrica |
| UP-235 | 386 | {costLabel} | GlassMetricCard | Métrica |
| UP-236 | 387 | "Leads" | GlassMetricCard | Métrica |
| UP-237 | 388 | "Investimento" | GlassMetricCard | Métrica |
| UP-238 | 420 | <Sparkles className="h-4 w-4 text-muted-foreground" />{title} | Card | Painel |
| UP-239 | 430 | Painel / conteúdo | TopCreativeCard | Painel |
| UP-240 | 460 | Painel / conteúdo | Card | Painel |
| UP-241 | 762 | Sem dados de canais pagos | Card | Painel |
| UP-242 | 798 | "Investimento em anúncios" | MktKpiCard | Métrica |
| UP-243 | 810 | "Faturamento" | MktKpiCard | Métrica |
| UP-244 | 822 | "ROA" | MktKpiCard | Métrica |
| UP-245 | 834 | "Taxa de aprovação" | MktKpiCard | Métrica |
| UP-246 | 846 | "Total de leads" | MktKpiCard | Métrica |
| UP-247 | 858 | {isB2C ? "Compras" : "Leads aprovados"} | MktKpiCard | Métrica |
| UP-248 | 870 | {isB2C ? "Custo por Compra" : "CPL"} | MktKpiCard | Métrica |
| UP-249 | 884 | "CPA" | MktKpiCard | Métrica |
| UP-250 | 912 | Painel / conteúdo | Card | Painel |
| UP-251 | 932 | <BarChart3 className="h-4 w-4 text-muted-foreground" />Investimento e leads | Card | Gráfico |
| UP-252 | 964 | <TrendingUp className="h-4 w-4 text-muted-foreground" />Evolução do ROAS | Card | Gráfico |
| UP-253 | 1002 | <DollarSign className="h-4 w-4 text-muted-foreground" />Investimento e faturamento | Card | Gráfico |
| UP-254 | 1048 | <Megaphone className="h-4 w-4 text-muted-foreground" />Por plataforma | Card | Painel |
| UP-255 | 1067 | <MapPin className="h-4 w-4 text-muted-foreground" />Principais estados por ROAS | Card | Painel |
| UP-256 | 1090 | <PersonStanding className="h-4 w-4 text-muted-foreground" />Faixa etária dos clientes (leads pagos) | Card | Painel |
| UP-257 | 1131 | Desempenho de campanhas | Card | Painel |

## monthly-history

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-258 | 234 | Histórico Mensal | Card | Tabela / lista / detalhe |

## not-found

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-259 | 7 | Painel / conteúdo | Card | Painel |

## notifications

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-260 | 112 | Painel / conteúdo | Card | Painel |

## orchestrator

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-261 | 399 | Painel / conteúdo | Card | Painel |
| UP-262 | 443 | "Marcas B2B" | DashboardKpiCard | Métrica |
| UP-263 | 460 | "Cadastros IA" | DashboardKpiCard | Métrica |
| UP-264 | 477 | "Pedidos influenciados" | DashboardKpiCard | Métrica |
| UP-265 | 494 | "Qualidade IA" | DashboardKpiCard | Métrica |
| UP-266 | 515 | Marcas no Orquestrador | Card | Tabela / lista / detalhe |
| UP-267 | 648 | Painel / conteúdo | Card | Painel |
| UP-268 | 721 | Cadastros criados pela IA | Card | Tabela / lista / detalhe |
| UP-269 | 912 | Painel / conteúdo | Card | Painel |
| UP-270 | 952 | Painel / conteúdo | Card | Painel |
| UP-271 | 977 | Painel / conteúdo | Card | Painel |
| UP-272 | 1028 | Painel / conteúdo | Card | Painel |
| UP-273 | 1032 | <span>{automationAudience === "internal_seller" ? "Nova notificação interna" : "Nova automação"}</span><Button type="button" variant="ghost" size="icon" onClick={() => setIsCreatingRule(false)} aria-label="Cancelar nova automação" title="Cancelar" > <X /> </Button> | Card | Painel |
| UP-274 | 1160 | <span className="flex items-center gap-2"> {eventLabel} <Badge variant="secondary">Etapa {rule.sequence ?? 1}</Badge> </span><div className="flex items-center gap-2 text-sm font-normal text-muted-foreground"> <span>{rule.enabled ? "Ativa" : "Inativa"}</span> <Switch checked={rule.enabled} onCheckedChange={(checked) => updateRule.mutate({ ruleId: rule.id, patch: { isEnabled: checked } })} aria-label={Ativar ${rule.name}} /> </div> | Card | Painel |
| UP-275 | 1279 | Painel / conteúdo | Card | Painel |
| UP-276 | 1331 | Criar agente para {agentsQuery.data?.client?.name ?? "cliente"} | Card | Painel |
| UP-277 | 1374 | <span className="flex items-center gap-2"><Bot className="h-4 w-4 text-primary" />{agent.name}</span><Badge variant={agent.status === "active" ? "default" : "outline"}>{agent.status === "active" ? "Ativo" : "Rascunho"}</Badge> | Card | Painel |
| UP-278 | 1411 | Painel / conteúdo | Card | Painel |
| UP-279 | 1425 | Integração UP Zero | Card | Painel |
| UP-280 | 1442 | Configurações gerais | Card | Painel |
| UP-281 | 1461 | Regras comerciais editáveis | Card | Painel |
| UP-282 | 1475 | Painel / conteúdo | Card | Painel |
| UP-283 | 1485 | Painel / conteúdo | Card | Painel |
| UP-284 | 1509 | Simulador de atendimento | Card | Painel |
| UP-285 | 1519 | Resposta simulada | Card | Painel |
| UP-286 | 1557 | Webhook UP Zero | Card | Painel |
| UP-287 | 1575 | Logs da operação | Card | Painel |
| UP-288 | 1663 | Painel / conteúdo | Card | Painel |
| UP-289 | 1665 | "Marca em configuração" | GlassMetricCard | Métrica |
| UP-290 | 1695 | "Conversas" | DashboardKpiCard | Métrica |
| UP-291 | 1712 | "Cadastros" | DashboardKpiCard | Métrica |
| UP-292 | 1729 | "Pedidos" | DashboardKpiCard | Métrica |
| UP-293 | 1746 | "Handoffs" | DashboardKpiCard | Métrica |

## orders

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-294 | 287 | {t("orders.selectBrand.title", "Selecione uma marca")} | Card | Painel |
| UP-295 | 313 | {isB2C ? "Faturamento faturado" : t("orders.kpi.requestedRevenue", "Faturamento solicitado")} | DashboardKpiCard | Métrica |
| UP-296 | 329 | {isB2C ? "Faturamento pago" : t("orders.kpi.fulfilledRevenue", "Faturamento atendido")} | DashboardKpiCard | Métrica |
| UP-297 | 344 | {isB2C ? "Peças faturadas" : t("orders.kpi.requestedQuantity", "Peças solicitadas")} | DashboardKpiCard | Métrica |
| UP-298 | 359 | {isB2C ? "Peças pagas" : t("orders.kpi.fulfilledQuantity", "Peças atendidas")} | DashboardKpiCard | Métrica |
| UP-299 | 374 | {isB2C ? "% Pago" : t("orders.kpi.fulfilledPct", "% de atendido")} | DashboardKpiCard | Métrica |
| UP-300 | 390 | {t("orders.kpi.orders", "Qtd de pedidos")} | DashboardKpiCard | Métrica |
| UP-301 | 405 | {isB2C ? "Novos compradores" : t("orders.kpi.newCustomers", "Clientes novos")} | DashboardKpiCard | Métrica |
| UP-302 | 420 | {isB2C ? "Recompradores" : t("orders.kpi.returningCustomers", "Clientes recorrentes")} | DashboardKpiCard | Métrica |
| UP-303 | 435 | {t("orders.kpi.retentionPct", "% de retenção")} | DashboardKpiCard | Métrica |
| UP-304 | 451 | {t("orders.kpi.conversionPct", "% de conversão")} | DashboardKpiCard | Métrica |
| UP-305 | 471 | <ShoppingBag className="h-4 w-4 text-primary" />{t("orders.list.title", "Lista de pedidos")} | Card | Tabela / lista / detalhe |
| UP-306 | 622 | {isB2C ? "Valor faturado" : "Valor solicitado"} | GlassMetricCard | Métrica |
| UP-307 | 623 | {isB2C ? "Valor pago" : "Valor atendido"} | GlassMetricCard | Métrica |
| UP-308 | 624 | {isB2C ? "Peças faturadas" : "Peças solicitadas"} | GlassMetricCard | Métrica |
| UP-309 | 625 | {isB2C ? "Peças pagas" : "Peças atendidas"} | GlassMetricCard | Métrica |
| UP-310 | 675 | {isB2C ? "Faturada" : "Solicitada"} | GlassMetricCard | Métrica |
| UP-311 | 676 | {isB2C ? "Paga" : "Atendida"} | GlassMetricCard | Métrica |
| UP-312 | 677 | "Valor" | GlassMetricCard | Métrica |

## organized-pages

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-313 | 37 | {pick( "acquisitionRevenue", "acquisitionTicket", "acquisitionOrders", "newCustomers", )} | Metrics | Métrica |
| UP-314 | 47 | {pick("cac", "costRegistration", "costApproved", "spend")} | Metrics | Métrica |
| UP-315 | 52 | {pick("approved", "approvedConverted", "approvedConversion")} | Metrics | Métrica |
| UP-316 | 57 | {pick("firstPurchaseAverage", "firstPurchaseMedian")} | Metrics | Métrica |
| UP-317 | 68 | {title} | Card | Gráfico |
| UP-318 | 142 | {pick( "spend", "requestedRoas", "paidRoas", "approvedConversion", )} | Metrics | Métrica |
| UP-319 | 158 | Etapas operacionais | Card | Painel |
| UP-320 | 162 | {stage.label} | GlassMetricCard | Métrica |
| UP-321 | 189 | {pick( "metaSpend", "impressions", "reach", "frequency", "clicks", "ctr", "cpc", "cpm", "metaPurchases", "metaCpa", "metaRoas", )} | Metrics | Métrica |

## overview

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-322 | 127 | {label} | GlassMetricCard | Métrica |
| UP-323 | 189 | {title} | Card | Painel |
| UP-324 | 416 | Clientes nos totais da plataforma | Card | Painel |
| UP-325 | 496 | "Faturamento da plataforma" | KpiTile | Métrica |
| UP-326 | 507 | "Pedidos da plataforma" | KpiTile | Métrica |
| UP-327 | 518 | "Clientes ativos" | KpiTile | Métrica |
| UP-328 | 529 | "Marcas ativas" | KpiTile | Métrica |
| UP-329 | 541 | "Ticket médio da plataforma" | KpiTile | Métrica |
| UP-330 | 561 | "Investimento em anúncios" | KpiTile | Métrica |
| UP-331 | 572 | "ROAS geral" | KpiTile | Métrica |
| UP-332 | 583 | "Total de leads" | KpiTile | Métrica |
| UP-333 | 594 | "Leads aprovados" | KpiTile | Métrica |
| UP-334 | 607 | Evolução da plataforma | Card | Gráfico |
| UP-335 | 728 | "Melhores desempenhos" | LeaderboardCard | Painel |
| UP-336 | 740 | "Maior crescimento" | LeaderboardCard | Painel |
| UP-337 | 752 | "Precisa de atenção" | LeaderboardCard | Painel |
| UP-338 | 766 | Marcas selecionadas | Card | Painel |

## performance-recompra

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-339 | 216 | {title} | GlassMetricCard | Métrica |
| UP-340 | 414 | Painel / conteúdo | PeriodCalendarCard | Painel |
| UP-341 | 719 | Painel / conteúdo | Card | Painel |
| UP-342 | 800 | "Resultado de recompra" | RecompraBlockCard | Métrica |
| UP-343 | 812 | "Vendas de recompra" | Configuração de KPI | Métrica configurada |
| UP-344 | 813 | "Ticket médio" | Configuração de KPI | Métrica configurada |
| UP-345 | 814 | "Clientes em recompra" | Configuração de KPI | Métrica configurada |
| UP-346 | 817 | "Clientes recorrentes" | RecompraBlockCard | Métrica |
| UP-347 | 829 | "Vendas recorrentes" | Configuração de KPI | Métrica configurada |
| UP-348 | 830 | "Faturamento recorrente" | Configuração de KPI | Métrica configurada |
| UP-349 | 831 | "Ticket médio recorrente" | Configuração de KPI | Métrica configurada |
| UP-350 | 834 | "Clientes reativados" | RecompraBlockCard | Métrica |
| UP-351 | 846 | "Vendas reativadas" | Configuração de KPI | Métrica configurada |
| UP-352 | 847 | "Faturamento reativado" | Configuração de KPI | Métrica configurada |
| UP-353 | 848 | "Ticket médio reativado" | Configuração de KPI | Métrica configurada |
| UP-354 | 851 | "Ciclo de recompra" | RecompraBlockCard | Métrica |
| UP-355 | 864 | "Mediana entre compras" | Configuração de KPI | Métrica configurada |
| UP-356 | 865 | "% recorrente" | Configuração de KPI | Métrica configurada |
| UP-357 | 866 | "% reativado" | Configuração de KPI | Métrica configurada |
| UP-358 | 888 | Resultado de recompra | Card | Gráfico |
| UP-359 | 912 | Volume de recompra | Card | Gráfico |
| UP-360 | 935 | Recorrentes x Reativados | Card | Gráfico |
| UP-361 | 962 | Intervalo entre compras | Card | Gráfico |
| UP-362 | 1010 | Retenção acumulada por prazo | Card | Tabela / lista / detalhe |
| UP-363 | 1051 | Retenção por número de compra | Card | Gráfico |
| UP-364 | 1084 | Desempenho por vendedora | Card | Tabela / lista / detalhe |
| UP-365 | 1132 | Detalhamento de recompra | Card | Tabela / lista / detalhe |

## performance

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-366 | 454 | {title} | Card | Gráfico |
| UP-367 | 697 | "Faturamento ERP" | Configuração de KPI | Métrica configurada |
| UP-368 | 709 | "Receita atribuída" | Configuração de KPI | Métrica configurada |
| UP-369 | 726 | "Investimento" | Configuração de KPI | Métrica configurada |
| UP-370 | 738 | "ROAS atribuído" | Configuração de KPI | Métrica configurada |
| UP-371 | 750 | "MER geral" | Configuração de KPI | Métrica configurada |
| UP-372 | 762 | "Lucro bruto" | Configuração de KPI | Métrica configurada |
| UP-373 | 777 | "ROI final" | Configuração de KPI | Métrica configurada |
| UP-374 | 794 | "Ticket médio" | Configuração de KPI | Métrica configurada |
| UP-375 | 811 | "Pedidos ERP" | Configuração de KPI | Métrica configurada |
| UP-376 | 823 | "Pedidos atribuídos" | Configuração de KPI | Métrica configurada |
| UP-377 | 841 | "Compradores únicos" | Configuração de KPI | Métrica configurada |
| UP-378 | 855 | "Clientes novos" | Configuração de KPI | Métrica configurada |
| UP-379 | 872 | "Clientes recorrentes" | Configuração de KPI | Métrica configurada |
| UP-380 | 886 | "CAC" | Configuração de KPI | Métrica configurada |
| UP-381 | 898 | "CTR" | Configuração de KPI | Métrica configurada |
| UP-382 | 910 | "CPL" | Configuração de KPI | Métrica configurada |
| UP-383 | 1079 | Painel / conteúdo | DashboardKpiCard | Métrica |
| UP-384 | 1097 | Painel / conteúdo | Card | Gráfico |
| UP-385 | 1161 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-386 | 1201 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-387 | 1238 | {COHORT_LABEL[cohort]} | GlassMetricCard | Métrica |
| UP-388 | 1337 | Painel / conteúdo | DashboardKpiCard | Métrica |
| UP-389 | 1359 | Painel / conteúdo | DashboardKpiCard | Métrica |
| UP-390 | 1373 | Painel / conteúdo | Card | Painel |
| UP-391 | 1422 | {item.label} | GlassMetricCard | Métrica |
| UP-392 | 1430 | Painel / conteúdo | Card | Painel |
| UP-393 | 1439 | {stage.label} | GlassMetricCard | Métrica |
| UP-394 | 1453 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-395 | 1549 | "Vendas por cor" | BreakdownCard | Painel |
| UP-396 | 1554 | "Vendas por tamanho" | BreakdownCard | Painel |
| UP-397 | 1559 | "Vendas por estado" | BreakdownCard | Painel |
| UP-398 | 1566 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-399 | 1662 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-400 | 1753 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-401 | 1812 | "Pedidos no período" | GlassMetricCard | Métrica |
| UP-402 | 1813 | "Valor total" | GlassMetricCard | Métrica |
| UP-403 | 1814 | "Pedidos atribuídos" | GlassMetricCard | Métrica |
| UP-404 | 1815 | "Receita atribuída" | GlassMetricCard | Métrica |
| UP-405 | 1817 | "Faturamento pago atribuído" | GlassMetricCard | Métrica |

## product-detail

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-406 | 79 | {label} | GlassMetricCard | Métrica |
| UP-407 | 221 | {product.name} | Card | Painel |
| UP-408 | 274 | "Faturamento histórico" | KpiTile | Métrica |
| UP-409 | 275 | "Unidades vendidas" | KpiTile | Métrica |
| UP-410 | 276 | "Ticket médio" | KpiTile | Métrica |
| UP-411 | 277 | "Sell-through" | KpiTile | Métrica |
| UP-412 | 287 | <TrendingUp className="h-4 w-4" />Evolução do faturamento | Card | Gráfico |
| UP-413 | 367 | Painel / conteúdo | Card | Gráfico |
| UP-414 | 385 | <Users className="h-4 w-4" />Principais compradores | Card | Tabela / lista / detalhe |

## products

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-415 | 416 | "Sales Power" | GlassMetricCard | Métrica |
| UP-416 | 417 | "Faturamento por SKU/dia" | GlassMetricCard | Métrica |
| UP-417 | 418 | "SKUs ativos" | GlassMetricCard | Métrica |
| UP-418 | 419 | "Período" | GlassMetricCard | Métrica |
| UP-419 | 444 | {insight.headline} | Card | Painel |
| UP-420 | 506 | Painel / conteúdo | Card | Painel |
| UP-421 | 599 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-422 | 744 | "Vendidos" | GlassMetricCard | Métrica |
| UP-423 | 745 | "Receita" | GlassMetricCard | Métrica |
| UP-424 | 746 | "Estoque" | GlassMetricCard | Métrica |

## rfm

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-425 | 164 | {title} | GlassMetricCard | Métrica |
| UP-426 | 296 | Painel / conteúdo | Card | Painel |
| UP-427 | 339 | "Recência" | RfmLogicCard | Métrica |
| UP-428 | 346 | "Frequência" | RfmLogicCard | Métrica |
| UP-429 | 353 | "Monetário" | RfmLogicCard | Métrica |
| UP-430 | 377 | {meta.label} | GlassMetricCard | Métrica |
| UP-431 | 393 | <span className="h-1.5 w-1.5 rounded-full bg-primary" />Evolução da composição dos segmentos | Card | Gráfico |
| UP-432 | 455 | <span className="h-1.5 w-1.5 rounded-full bg-chart-3" />Compradoras RFM <span className="text-muted-foreground font-normal">({formatNumber(total)})</span><InfoHint text="A lista mostra clientes que solicitaram pedidos no período filtrado. Por padrão entram todos os pedidos; use o filtro de status para analisar somente aprovados, pendentes ou recusados." /> | Card | Tabela / lista / detalhe |
| UP-433 | 692 | Painel / conteúdo | Card | Painel |
| UP-434 | 733 | "Solicitado" | GlassMetricCard | Métrica |
| UP-435 | 734 | "Atendido" | GlassMetricCard | Métrica |
| UP-436 | 735 | "Peças solicitadas" | GlassMetricCard | Métrica |
| UP-437 | 736 | "Peças atendidas" | GlassMetricCard | Métrica |

## sales-agent

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-438 | 33 | {title} | GlassMetricCard | Métrica |
| UP-439 | 47 | Painel / conteúdo | Card | Painel |
| UP-440 | 62 | "Conversas" | Metric | Métrica |
| UP-441 | 68 | "Cadastros" | Metric | Métrica |
| UP-442 | 74 | "Pedidos" | Metric | Métrica |
| UP-443 | 80 | "Números conectados" | Metric | Métrica |
| UP-444 | 88 | CRM simplificado | Card | Painel |
| UP-445 | 97 | Cadastros criados | Card | Tabela / lista / detalhe |

## scale

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-446 | 158 | {title} | Card | Painel |
| UP-447 | 199 | Painel / conteúdo | Card | Painel |
| UP-448 | 218 | "Carregando Escala" | DashLoadingCard | Painel |
| UP-449 | 357 | {item.label} | GlassMetricCard | Métrica |
| UP-450 | 362 | Calculadora de projeção | Card | Painel |
| UP-451 | 450 | Insights de escala | Card | Painel |
| UP-452 | 496 | Painel / conteúdo | ScenarioCard | Painel |
| UP-453 | 501 | "Categorias mais vendidas" | BreakdownCard | Painel |
| UP-454 | 502 | "Tamanhos mais vendidos" | BreakdownCard | Painel |
| UP-455 | 503 | "Cores mais vendidas" | BreakdownCard | Painel |
| UP-456 | 504 | "Poder por categoria" | BreakdownCard | Painel |
| UP-457 | 507 | Como a projeção foi calculada | Card | Painel |

## seller-detail

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-458 | 81 | {label} | GlassMetricCard | Métrica |
| UP-459 | 253 | {seller.name} | Card | Painel |
| UP-460 | 301 | Painel / conteúdo | Card | Painel |
| UP-461 | 308 | "Faturamento" | KpiCard | Métrica |
| UP-462 | 316 | "Pedidos" | KpiCard | Métrica |
| UP-463 | 323 | "Ticket médio" | KpiCard | Métrica |
| UP-464 | 330 | "Clientes" | KpiCard | Métrica |
| UP-465 | 337 | "Taxa de aprovação" | KpiCard | Métrica |
| UP-466 | 344 | "% de conversão" | KpiCard | Métrica |
| UP-467 | 358 | <TrendingUp className="h-4 w-4" />Evolução do faturamento | Card | Gráfico |
| UP-468 | 461 | <BarChart2 className="h-4 w-4" />Faturamento por categoria | Card | Gráfico |
| UP-469 | 476 | <MapPin className="h-4 w-4" />Faturamento por estado | Card | Gráfico |
| UP-470 | 496 | <Users className="h-4 w-4" />Principais clientes | Card | Tabela / lista / detalhe |
| UP-471 | 586 | <ShoppingBag className="h-4 w-4" />Pedidos recentes | Card | Tabela / lista / detalhe |

## sellers

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-472 | 177 | "Faturamento total" | GlassMetricCard | Métrica |
| UP-473 | 181 | "Vendedoras ativas" | GlassMetricCard | Métrica |
| UP-474 | 185 | "Principal vendedora" | GlassMetricCard | Métrica |
| UP-475 | 192 | {insight.headline} | Card | Painel |
| UP-476 | 255 | Painel / conteúdo | Card | Gráfico |
| UP-477 | 415 | Painel / conteúdo | Card | Painel |
| UP-478 | 455 | {seller.name} | Card | Painel |

## stock-intelligence

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-479 | 133 | {label} | GlassMetricCard | Métrica |
| UP-480 | 160 | Painel / conteúdo | Card | Painel |
| UP-481 | 388 | {insight.headline} | Card | Painel |
| UP-482 | 458 | Painel / conteúdo | Card | Painel |
| UP-483 | 465 | "Total de unidades em estoque" | KpiCard | Métrica |
| UP-484 | 472 | "Cobertura média em dias" | KpiCard | Métrica |
| UP-485 | 479 | "SKUs com risco de ruptura" | KpiCard | Métrica |
| UP-486 | 487 | "SKUs com risco de excesso" | KpiCard | Métrica |
| UP-487 | 495 | "Sell-through Rate" | KpiCard | Métrica |
| UP-488 | 513 | Painel / conteúdo | Card | Painel |
| UP-489 | 553 | Todos os SKUs | Card | Tabela / lista / detalhe |
| UP-490 | 744 | Painel / conteúdo | Card | Gráfico |
| UP-491 | 822 | Painel / conteúdo | Card | Gráfico |
| UP-492 | 882 | Painel / conteúdo | Card | Gráfico |
| UP-493 | 970 | "Unidades vendidas" | GlassMetricCard | Métrica |
| UP-494 | 971 | "Unidades em estoque" | GlassMetricCard | Métrica |
| UP-495 | 972 | "Velocidade diária" | GlassMetricCard | Métrica |
| UP-496 | 973 | "Dias de cobertura" | GlassMetricCard | Métrica |

## utm

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-497 | 78 | {label} | GlassMetricCard | Métrica |
| UP-498 | 359 | "Sessões" | KpiCard | Métrica |
| UP-499 | 366 | "Cadastros" | KpiCard | Métrica |
| UP-500 | 372 | "% de aprovação" | KpiCard | Métrica |
| UP-501 | 379 | "Compradores" | KpiCard | Métrica |
| UP-502 | 385 | "Faturamento" | KpiCard | Métrica |
| UP-503 | 392 | "% de conversão" | KpiCard | Métrica |
| UP-504 | 399 | "ROAS" | KpiCard | Métrica |
| UP-505 | 413 | {insight.headline} | Card | Painel |
| UP-506 | 487 | Faturamento por {GROUP_LABELS[groupBy]} | Card | Gráfico |
| UP-507 | 543 | % de conversão por {GROUP_LABELS[groupBy]} | Card | Gráfico |
| UP-508 | 615 | Painel / conteúdo | Card | Painel |

## whatsapp-connections

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-509 | 727 | <PlugZap className="h-4 w-4 text-primary" />Conectar WhatsApp Business | Card | Painel |
| UP-510 | 903 | "Conexões" | GlassMetricCard | Métrica |
| UP-511 | 904 | "Números cadastrados" | GlassMetricCard | Métrica |
| UP-512 | 905 | Painel / conteúdo | Card | Painel |
| UP-513 | 933 | Painel / conteúdo | Card | Painel |
| UP-514 | 950 | <Webhook className="h-4 w-4 text-primary" />Webhook da Meta | Card | Painel |
| UP-515 | 995 | {syncCopy.title} | Card | Painel |
| UP-516 | 1062 | "Mensagens importadas" | GlassMetricCard | Métrica |
| UP-517 | 1063 | "Eventos de histórico" | GlassMetricCard | Métrica |
| UP-518 | 1081 | <Smartphone className="h-4 w-4 text-primary" />Telefones de campanha | Card | Painel |
| UP-519 | 1176 | {numberTitle(phone)} | Card | Painel |

## whatsapp-conversations

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-520 | 215 | "Conversas" | GlassMetricCard | Métrica |
| UP-521 | 216 | "Mensagens aguardando" | GlassMetricCard | Métrica |
| UP-522 | 217 | "Encerradas" | GlassMetricCard | Métrica |
| UP-523 | 218 | Painel / conteúdo | Card | Painel |
| UP-524 | 231 | Conversas | Card | Painel |

## whatsapp-sends

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-525 | 169 | <Send className="h-4 w-4 text-primary" />Envio teste WhatsApp | Card | Painel |

## whatsapp-templates

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-526 | 764 | "Aprovados" | GlassMetricCard | Métrica |
| UP-527 | 765 | "Pendentes" | GlassMetricCard | Métrica |
| UP-528 | 766 | "Recusados" | GlassMetricCard | Métrica |
| UP-529 | 804 | {phoneLabel(selectedPhone)} | Card | Painel |
| UP-530 | 856 | Variaveis para templates e automacoes | Card | Painel |
| UP-531 | 922 | Criar template | Card | Painel |
| UP-532 | 1283 | Modelos cadastrados | Card | Tabela / lista / detalhe |

## whatsapp

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-533 | 213 | {label} | GlassMetricCard | Métrica |
| UP-534 | 423 | <MessageCircle className="h-4 w-4 text-primary" />Atendimento WhatsApp | Card | Painel |
| UP-535 | 489 | "Total de conversas" | KpiCard | Métrica |
| UP-536 | 490 | "Novos leads" | KpiCard | Métrica |
| UP-537 | 491 | "Leads recorrentes" | KpiCard | Métrica |
| UP-538 | 492 | "Mensagens recebidas" | KpiCard | Métrica |
| UP-539 | 493 | "Mensagens enviadas" | KpiCard | Métrica |
| UP-540 | 494 | "Tempo 1ª resposta" | KpiCard | Métrica |
| UP-541 | 495 | "SLA cumprido" | KpiCard | Métrica |
| UP-542 | 496 | "Leads sem resposta" | KpiCard | Métrica |
| UP-543 | 497 | "Aguardando resposta" | KpiCard | Métrica |
| UP-544 | 498 | "Encerradas" | KpiCard | Métrica |
| UP-545 | 499 | "Perdidas" | KpiCard | Métrica |
| UP-546 | 503 | Conversas por dia | Card | Gráfico |
| UP-547 | 518 | Conversas por hora | Card | Gráfico |
| UP-548 | 533 | Recebidas vs enviadas | Card | Gráfico |
| UP-549 | 549 | Ranking por conversas atendidas | Card | Gráfico |
| UP-550 | 566 | Funil comercial do WhatsApp | Card | Gráfico |
| UP-551 | 600 | Taxa de avanço por etapa | Card | Painel |
| UP-552 | 634 | Tempo médio de primeira resposta por perfil WhatsApp | Card | Gráfico |
| UP-553 | 650 | Conversas sem resposta | Card | Tabela / lista / detalhe |
| UP-554 | 678 | Motivos de perda | Card | Tabela / lista / detalhe |
| UP-555 | 703 | Produtividade por perfil WhatsApp | Card | Tabela / lista / detalhe |

## purchase-insights

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-556 | 15 | Painel / conteúdo | Card | Painel |
| UP-557 | 34 | Painel / conteúdo | Card | Painel |
| UP-558 | 34 | Painel / conteúdo | Card | Painel |
| UP-559 | 36 | Distribuição de compradores | Card | Painel |
| UP-560 | 42 | "Compram na primeira semana" | GlassMetricCard | Métrica |
| UP-561 | 43 | "Compram em até 30 dias" | GlassMetricCard | Métrica |
| UP-562 | 44 | "Mediana até o pedido" | GlassMetricCard | Métrica |

## acquisition-funnel

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-563 | 7 | {title} | Card | Painel |

## product-sales-charts

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-564 | 69 | {title} | Card | Gráfico |
| UP-565 | 148 | Painel / conteúdo | Card | Painel |
| UP-566 | 151 | "Vendas por Categoria" | ProductSalesCard | Painel |
| UP-567 | 152 | "Vendas por Cor" | ProductSalesCard | Painel |
| UP-568 | 153 | "Vendas por Tamanho" | ProductSalesCard | Painel |

