# Mapeamento card por card · UP Glass

582 pontos de uso/configuração encontrados nas 40 arquivos com cards (páginas e componentes compartilhados). Cada linha identifica a posição no código, o título ou expressão dinâmica e o componente final. Modelos dentro de loops são registrados na sua declaração; a quantidade de cards em execução depende dos dados. As configurações de KPI também são listadas para identificar as métricas que alimentam um modelo compartilhado.

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
| UP-081 | 331 | "UP Dash · Relatório Daily" | GlassMetricCard | Métrica |
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
| UP-098 | 152 | {title} | Card | Painel |
| UP-099 | 782 | <Megaphone className="h-4 w-4 text-primary" />Clientes atribuídos às campanhas | Card | Tabela / lista / detalhe |
| UP-100 | 802 | "Clientes" | GlassMetricCard | Métrica |
| UP-101 | 803 | "Solicitado" | GlassMetricCard | Métrica |
| UP-102 | 804 | "Pedidos" | GlassMetricCard | Métrica |
| UP-103 | 805 | "Cadastros" | GlassMetricCard | Métrica |
| UP-104 | 812 | "Valor solicitado" | DashboardKpiCard | Métrica |
| UP-105 | 827 | "Valor atendido" | DashboardKpiCard | Métrica |
| UP-106 | 841 | "Investimento" | DashboardKpiCard | Métrica |
| UP-107 | 855 | "ROAS" | DashboardKpiCard | Métrica |
| UP-108 | 1200 | "Eventos" | GlassMetricCard | Métrica |
| UP-109 | 1201 | "Produtos vistos" | GlassMetricCard | Métrica |
| UP-110 | 1202 | "Carrinhos" | GlassMetricCard | Métrica |
| UP-111 | 1203 | "Valor comprado" | GlassMetricCard | Métrica |
| UP-112 | 1410 | <ShoppingBag className="h-4 w-4 text-primary" />Pedidos do período | Card | Tabela / lista / detalhe |
| UP-113 | 1421 | "Total" | GlassMetricCard | Métrica |
| UP-114 | 1515 | "Pago" | GlassMetricCard | Métrica |
| UP-115 | 1516 | "Bruto" | GlassMetricCard | Métrica |
| UP-116 | 1517 | "Desconto" | GlassMetricCard | Métrica |
| UP-117 | 1518 | "Frete" | GlassMetricCard | Métrica |
| UP-118 | 1857 | {t("dashboard.loading.title")} | DashLoadingCard | Painel |
| UP-119 | 1946 | {isB2C ? t("dashboard.kpi.totalRevenue.b2c") : t("dashboard.kpi.totalRevenue.b2b")} | DashboardKpiCard | Métrica |
| UP-120 | 1964 | {t("dashboard.kpi.orders")} | DashboardKpiCard | Métrica |
| UP-121 | 1981 | {t("dashboard.kpi.avgTicket")} | DashboardKpiCard | Métrica |
| UP-122 | 1998 | {t("dashboard.kpi.conversionRate")} | DashboardKpiCard | Métrica |
| UP-123 | 2026 | {isB2C ? t("dashboard.kpi.invoicedValue") : t("dashboard.kpi.requestedRevenue")} | GlassMetricCard | Métrica |
| UP-124 | 2058 | {t("dashboard.kpi.buyersThisPeriod")} | GlassMetricCard | Métrica |
| UP-125 | 2128 | {t("dashboard.kpi.buyerRetention")} | DashboardKpiCard | Métrica |
| UP-126 | 2173 | {t("dashboard.chart.title")} | Card | Gráfico |
| UP-127 | 2313 | {insight.headline} | Card | Painel |
| UP-128 | 2388 | {t("dashboard.b2c.byCategory.title")} | B2CSalesBreakdownCard | Painel |
| UP-129 | 2397 | {t("dashboard.b2c.byColor.title")} | B2CSalesBreakdownCard | Painel |
| UP-130 | 2406 | {t("dashboard.b2c.bySize.title")} | B2CSalesBreakdownCard | Gráfico |
| UP-131 | 2425 | {t("dashboard.signals.title")} | Card | Gráfico |
| UP-132 | 2470 | <AlertTriangle className="h-4 w-4 text-amber-400" />{t("dashboard.alerts.title")} | Card | Painel |
| UP-133 | 2615 | {t("dashboard.categories.title")} | Card | Painel |
| UP-134 | 2685 | {t("dashboard.sellers.title")} | Card | Painel |

## erp

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-135 | 372 | {metric.label} | DashboardKpiCard | Métrica |
| UP-136 | 546 | Painel / conteúdo | Card | Gráfico |
| UP-137 | 626 | "Faturamento líquido" | Configuração de KPI | Métrica configurada |
| UP-138 | 636 | "Pedidos" | Configuração de KPI | Métrica configurada |
| UP-139 | 646 | "Compradores" | Configuração de KPI | Métrica configurada |
| UP-140 | 656 | "Retenção" | Configuração de KPI | Métrica configurada |
| UP-141 | 667 | "Peças vendidas" | Configuração de KPI | Métrica configurada |
| UP-142 | 677 | "Descontos" | Configuração de KPI | Métrica configurada |
| UP-143 | 687 | "Devoluções" | Configuração de KPI | Métrica configurada |
| UP-144 | 697 | "Cancelamentos" | Configuração de KPI | Métrica configurada |
| UP-145 | 717 | Painel / conteúdo | Card | Gráfico |
| UP-146 | 761 | Painel / conteúdo | Card | Gráfico |
| UP-147 | 819 | "Formas de pagamento" | BreakdownCard | Painel |
| UP-148 | 825 | "Ranking de vendedores" | BreakdownCard | Painel |
| UP-149 | 831 | "Geografia de compradores" | BreakdownCard | Painel |
| UP-150 | 838 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-151 | 964 | "Faturamento bruto" | Configuração de KPI | Métrica configurada |
| UP-152 | 974 | "Pedidos únicos" | Configuração de KPI | Métrica configurada |
| UP-153 | 984 | "Peças vendidas" | Configuração de KPI | Métrica configurada |
| UP-154 | 994 | "Cancelamentos" | Configuração de KPI | Métrica configurada |
| UP-155 | 1008 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-156 | 1261 | "Pedidos históricos" | GlassMetricCard | Métrica |
| UP-157 | 1262 | "Valor total comprado" | GlassMetricCard | Métrica |
| UP-158 | 1263 | "Ticket médio histórico" | GlassMetricCard | Métrica |
| UP-159 | 1396 | "Compradores" | Configuração de KPI | Métrica configurada |
| UP-160 | 1406 | "Novos compradores" | Configuração de KPI | Métrica configurada |
| UP-161 | 1416 | "Recorrentes" | Configuração de KPI | Métrica configurada |
| UP-162 | 1426 | "Retenção" | Configuração de KPI | Métrica configurada |
| UP-163 | 1441 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-164 | 1894 | "Estoque atual" | Configuração de KPI | Métrica configurada |
| UP-165 | 1904 | "Poder de venda" | Configuração de KPI | Métrica configurada |
| UP-166 | 1914 | "Cobertura" | Configuração de KPI | Métrica configurada |
| UP-167 | 1924 | "SKUs sem estoque" | Configuração de KPI | Métrica configurada |
| UP-168 | 1936 | "Faturamento" | Configuração de KPI | Métrica configurada |
| UP-169 | 1946 | "Lucro bruto" | Configuração de KPI | Métrica configurada |
| UP-170 | 1956 | "% de giro" | Configuração de KPI | Métrica configurada |
| UP-171 | 1970 | "Poder de venda" | Configuração de KPI | Métrica configurada |
| UP-172 | 1985 | "Categorias" | BreakdownCard | Painel |
| UP-173 | 2000 | "Cores" | BreakdownCard | Painel |
| UP-174 | 2012 | "Tamanhos" | BreakdownCard | Painel |
| UP-175 | 2025 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-176 | 2157 | "Vendedores ativos" | Configuração de KPI | Métrica configurada |
| UP-177 | 2167 | "Faturamento" | Configuração de KPI | Métrica configurada |
| UP-178 | 2177 | "Ticket médio" | Configuração de KPI | Métrica configurada |
| UP-179 | 2187 | "Clientes atendidos" | Configuração de KPI | Métrica configurada |
| UP-180 | 2202 | "Ranking de vendedores" | BreakdownCard | Painel |
| UP-181 | 2208 | "Desempenho por loja" | BreakdownCard | Painel |
| UP-182 | 2215 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-183 | 2298 | "Geografia de compradores" | BreakdownCard | Painel |
| UP-184 | 2299 | Painel / conteúdo | Card | Tabela / lista / detalhe |

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
| UP-190 | 246 | Painel / conteúdo | ActivationAnalysisCard | Painel |
| UP-191 | 267 | {visitStepHidden ? "Leads → Compras" : "Visitantes → Compras"} | Card | Painel |
| UP-192 | 306 | {visibleSteps[0]?.label ?? "Top of funnel"} | MiniStat | Métrica |
| UP-193 | 314 | "Compras" | MiniStat | Métrica |
| UP-194 | 322 | {biggestDrop ? Perda em ${biggestDrop.to.label} : "Maior perda"} | MiniStat | Métrica |
| UP-195 | 331 | "Média de eventos antes da compra" | MiniStat | Métrica |
| UP-196 | 348 | Painel / conteúdo | ActivationAnalysisCard | Painel |
| UP-197 | 360 | <TrendingUp className="h-3.5 w-3.5 text-primary" />Visitas diárias ao site e taxa de conversão | Card | Gráfico |
| UP-198 | 498 | <span className="h-1.5 w-1.5 rounded-full bg-primary" />Fluxo por etapa | Card | Gráfico |
| UP-199 | 566 | Painel / conteúdo | Card | Painel |
| UP-200 | 583 | Painel / conteúdo | Card | Painel |
| UP-201 | 743 | Cadastro aprovado → primeira compra | Card | Painel |
| UP-202 | 765 | "Aprovados" | ActivationMetric | Métrica |
| UP-203 | 766 | "Ativação em 30 dias" | ActivationMetric | Métrica |
| UP-204 | 771 | "Ticket 1ª compra" | ActivationMetric | Métrica |
| UP-205 | 895 | {label} | GlassMetricCard | Métrica |
| UP-206 | 982 | {label} | GlassMetricCard | Métrica |

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
| UP-216 | 53 | {label} | GlassMetricCard | Métrica |
| UP-217 | 155 | Painel / conteúdo | Card | Painel |
| UP-218 | 197 | "Média de eventos antes da compra" | KpiCard | Métrica |
| UP-219 | 204 | "Tempo médio até a primeira compra" | KpiCard | Métrica |
| UP-220 | 211 | "Tempo médio entre compras" | KpiCard | Métrica |
| UP-221 | 218 | "Compradores na primeira sessão" | KpiCard | Métrica |
| UP-222 | 231 | <span className="h-1.5 w-1.5 rounded-full bg-primary" />Fluxo de eventos | Card | Painel |
| UP-223 | 250 | <span className="h-1.5 w-1.5 rounded-full bg-chart-3" />Principais caminhos até a compra | Card | Painel |
| UP-224 | 298 | <span className="h-1.5 w-1.5 rounded-full bg-chart-4" />Compradores e não compradores — comparação de eventos | Card | Gráfico |
| UP-225 | 395 | Painel / conteúdo | Card | Painel |

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
| UP-230 | 201 | {label} | GlassMetricCard | Métrica |
| UP-231 | 384 | "CTR" | GlassMetricCard | Métrica |
| UP-232 | 385 | {costLabel} | GlassMetricCard | Métrica |
| UP-233 | 386 | "Leads" | GlassMetricCard | Métrica |
| UP-234 | 387 | "Investimento" | GlassMetricCard | Métrica |
| UP-235 | 418 | <Sparkles className="h-4 w-4 text-muted-foreground" />{title} | Card | Painel |
| UP-236 | 428 | Painel / conteúdo | TopCreativeCard | Painel |
| UP-237 | 457 | Painel / conteúdo | Card | Painel |
| UP-238 | 757 | Sem dados de canais pagos | Card | Painel |
| UP-239 | 793 | "Investimento em anúncios" | MktKpiCard | Métrica |
| UP-240 | 805 | "Faturamento" | MktKpiCard | Métrica |
| UP-241 | 817 | "ROA" | MktKpiCard | Métrica |
| UP-242 | 829 | "Taxa de aprovação" | MktKpiCard | Métrica |
| UP-243 | 841 | "Total de leads" | MktKpiCard | Métrica |
| UP-244 | 853 | {isB2C ? "Compras" : "Leads aprovados"} | MktKpiCard | Métrica |
| UP-245 | 865 | {isB2C ? "Custo por Compra" : "CPL"} | MktKpiCard | Métrica |
| UP-246 | 879 | "CPA" | MktKpiCard | Métrica |
| UP-247 | 907 | Painel / conteúdo | Card | Painel |
| UP-248 | 927 | <BarChart3 className="h-4 w-4 text-muted-foreground" />Investimento e leads | Card | Gráfico |
| UP-249 | 959 | <TrendingUp className="h-4 w-4 text-muted-foreground" />Evolução do ROAS | Card | Gráfico |
| UP-250 | 997 | <DollarSign className="h-4 w-4 text-muted-foreground" />Investimento e faturamento | Card | Gráfico |
| UP-251 | 1043 | <Megaphone className="h-4 w-4 text-muted-foreground" />Por plataforma | Card | Painel |
| UP-252 | 1062 | <MapPin className="h-4 w-4 text-muted-foreground" />Principais estados por ROAS | Card | Painel |
| UP-253 | 1085 | <PersonStanding className="h-4 w-4 text-muted-foreground" />Faixa etária dos clientes (leads pagos) | Card | Painel |
| UP-254 | 1126 | Desempenho de campanhas | Card | Painel |

## monthly-history

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-255 | 234 | Histórico Mensal | Card | Tabela / lista / detalhe |

## not-found

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-256 | 7 | Painel / conteúdo | Card | Painel |

## notifications

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-257 | 112 | Painel / conteúdo | Card | Painel |

## orchestrator

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-258 | 399 | Painel / conteúdo | Card | Painel |
| UP-259 | 443 | "Marcas B2B" | DashboardKpiCard | Métrica |
| UP-260 | 460 | "Cadastros IA" | DashboardKpiCard | Métrica |
| UP-261 | 477 | "Pedidos influenciados" | DashboardKpiCard | Métrica |
| UP-262 | 494 | "Qualidade IA" | DashboardKpiCard | Métrica |
| UP-263 | 515 | Marcas no Orquestrador | Card | Tabela / lista / detalhe |
| UP-264 | 648 | Painel / conteúdo | Card | Painel |
| UP-265 | 721 | Cadastros criados pela IA | Card | Tabela / lista / detalhe |
| UP-266 | 912 | Painel / conteúdo | Card | Painel |
| UP-267 | 952 | Painel / conteúdo | Card | Painel |
| UP-268 | 977 | Painel / conteúdo | Card | Painel |
| UP-269 | 1028 | Painel / conteúdo | Card | Painel |
| UP-270 | 1032 | <span>{automationAudience === "internal_seller" ? "Nova notificação interna" : "Nova automação"}</span><Button type="button" variant="ghost" size="icon" onClick={() => setIsCreatingRule(false)} aria-label="Cancelar nova automação" title="Cancelar" > <X /> </Button> | Card | Painel |
| UP-271 | 1160 | <span className="flex items-center gap-2"> {eventLabel} <Badge variant="secondary">Etapa {rule.sequence ?? 1}</Badge> </span><div className="flex items-center gap-2 text-sm font-normal text-muted-foreground"> <span>{rule.enabled ? "Ativa" : "Inativa"}</span> <Switch checked={rule.enabled} onCheckedChange={(checked) => updateRule.mutate({ ruleId: rule.id, patch: { isEnabled: checked } })} aria-label={Ativar ${rule.name}} /> </div> | Card | Painel |
| UP-272 | 1279 | Painel / conteúdo | Card | Painel |
| UP-273 | 1331 | Criar agente para {agentsQuery.data?.client?.name ?? "cliente"} | Card | Painel |
| UP-274 | 1374 | <span className="flex items-center gap-2"><Bot className="h-4 w-4 text-primary" />{agent.name}</span><Badge variant={agent.status === "active" ? "default" : "outline"}>{agent.status === "active" ? "Ativo" : "Rascunho"}</Badge> | Card | Painel |
| UP-275 | 1411 | Painel / conteúdo | Card | Painel |
| UP-276 | 1425 | Integração UP Zero | Card | Painel |
| UP-277 | 1442 | Configurações gerais | Card | Painel |
| UP-278 | 1461 | Regras comerciais editáveis | Card | Painel |
| UP-279 | 1475 | Painel / conteúdo | Card | Painel |
| UP-280 | 1485 | Painel / conteúdo | Card | Painel |
| UP-281 | 1509 | Simulador de atendimento | Card | Painel |
| UP-282 | 1519 | Resposta simulada | Card | Painel |
| UP-283 | 1557 | Webhook UP Zero | Card | Painel |
| UP-284 | 1575 | Logs da operação | Card | Painel |
| UP-285 | 1663 | Painel / conteúdo | Card | Painel |
| UP-286 | 1665 | "Marca em configuração" | GlassMetricCard | Métrica |
| UP-287 | 1695 | "Conversas" | DashboardKpiCard | Métrica |
| UP-288 | 1712 | "Cadastros" | DashboardKpiCard | Métrica |
| UP-289 | 1729 | "Pedidos" | DashboardKpiCard | Métrica |
| UP-290 | 1746 | "Handoffs" | DashboardKpiCard | Métrica |

## orders

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-291 | 284 | {t("orders.selectBrand.title", "Selecione uma marca")} | Card | Painel |
| UP-292 | 310 | {isB2C ? "Faturamento faturado" : t("orders.kpi.requestedRevenue", "Faturamento solicitado")} | DashboardKpiCard | Métrica |
| UP-293 | 325 | {isB2C ? "Faturamento pago" : t("orders.kpi.fulfilledRevenue", "Faturamento atendido")} | DashboardKpiCard | Métrica |
| UP-294 | 339 | {isB2C ? "Peças faturadas" : t("orders.kpi.requestedQuantity", "Peças solicitadas")} | DashboardKpiCard | Métrica |
| UP-295 | 353 | {isB2C ? "Peças pagas" : t("orders.kpi.fulfilledQuantity", "Peças atendidas")} | DashboardKpiCard | Métrica |
| UP-296 | 367 | {isB2C ? "% Pago" : t("orders.kpi.fulfilledPct", "% de atendido")} | DashboardKpiCard | Métrica |
| UP-297 | 382 | {t("orders.kpi.orders", "Qtd de pedidos")} | DashboardKpiCard | Métrica |
| UP-298 | 396 | {isB2C ? "Novos compradores" : t("orders.kpi.newCustomers", "Clientes novos")} | DashboardKpiCard | Métrica |
| UP-299 | 410 | {isB2C ? "Recompradores" : t("orders.kpi.returningCustomers", "Clientes recorrentes")} | DashboardKpiCard | Métrica |
| UP-300 | 424 | {t("orders.kpi.retentionPct", "% de retenção")} | DashboardKpiCard | Métrica |
| UP-301 | 439 | {t("orders.kpi.conversionPct", "% de conversão")} | DashboardKpiCard | Métrica |
| UP-302 | 458 | <ShoppingBag className="h-4 w-4 text-primary" />{t("orders.list.title", "Lista de pedidos")} | Card | Tabela / lista / detalhe |
| UP-303 | 609 | {isB2C ? "Valor faturado" : "Valor solicitado"} | GlassMetricCard | Métrica |
| UP-304 | 610 | {isB2C ? "Valor pago" : "Valor atendido"} | GlassMetricCard | Métrica |
| UP-305 | 611 | {isB2C ? "Peças faturadas" : "Peças solicitadas"} | GlassMetricCard | Métrica |
| UP-306 | 612 | {isB2C ? "Peças pagas" : "Peças atendidas"} | GlassMetricCard | Métrica |
| UP-307 | 662 | {isB2C ? "Faturada" : "Solicitada"} | GlassMetricCard | Métrica |
| UP-308 | 663 | {isB2C ? "Paga" : "Atendida"} | GlassMetricCard | Métrica |
| UP-309 | 664 | "Valor" | GlassMetricCard | Métrica |

## organized-pages

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-310 | 37 | {pick( "acquisitionRevenue", "acquisitionTicket", "acquisitionOrders", "newCustomers", )} | Metrics | Métrica |
| UP-311 | 47 | {pick("cac", "costRegistration", "costApproved", "spend")} | Metrics | Métrica |
| UP-312 | 52 | {pick("approved", "approvedConverted", "approvedConversion")} | Metrics | Métrica |
| UP-313 | 57 | {pick("firstPurchaseAverage", "firstPurchaseMedian")} | Metrics | Métrica |
| UP-314 | 68 | {title} | Card | Gráfico |
| UP-315 | 140 | {pick( "spend", "requestedRoas", "paidRoas", "approvedConversion", )} | Metrics | Métrica |
| UP-316 | 156 | Etapas operacionais | Card | Painel |
| UP-317 | 160 | {stage.label} | GlassMetricCard | Métrica |
| UP-318 | 184 | {pick( "metaSpend", "impressions", "reach", "frequency", "clicks", "ctr", "cpc", "cpm", "metaPurchases", "metaCpa", "metaRoas", )} | Metrics | Métrica |

## overview

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-319 | 127 | {label} | GlassMetricCard | Métrica |
| UP-320 | 189 | {title} | Card | Painel |
| UP-321 | 416 | Clientes nos totais da plataforma | Card | Painel |
| UP-322 | 496 | "Faturamento da plataforma" | KpiTile | Métrica |
| UP-323 | 507 | "Pedidos da plataforma" | KpiTile | Métrica |
| UP-324 | 518 | "Clientes ativos" | KpiTile | Métrica |
| UP-325 | 529 | "Marcas ativas" | KpiTile | Métrica |
| UP-326 | 541 | "Ticket médio da plataforma" | KpiTile | Métrica |
| UP-327 | 561 | "Investimento em anúncios" | KpiTile | Métrica |
| UP-328 | 572 | "ROAS geral" | KpiTile | Métrica |
| UP-329 | 583 | "Total de leads" | KpiTile | Métrica |
| UP-330 | 594 | "Leads aprovados" | KpiTile | Métrica |
| UP-331 | 607 | Evolução da plataforma | Card | Gráfico |
| UP-332 | 728 | "Melhores desempenhos" | LeaderboardCard | Painel |
| UP-333 | 740 | "Maior crescimento" | LeaderboardCard | Painel |
| UP-334 | 752 | "Precisa de atenção" | LeaderboardCard | Painel |
| UP-335 | 766 | Marcas selecionadas | Card | Painel |

## performance-recompra

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-336 | 209 | {title} | GlassMetricCard | Métrica |
| UP-337 | 409 | Painel / conteúdo | PeriodCalendarCard | Painel |
| UP-338 | 712 | Painel / conteúdo | Card | Painel |
| UP-339 | 793 | "Resultado de recompra" | RecompraBlockCard | Métrica |
| UP-340 | 804 | "Vendas de recompra" | Configuração de KPI | Métrica configurada |
| UP-341 | 805 | "Ticket médio" | Configuração de KPI | Métrica configurada |
| UP-342 | 806 | "Clientes em recompra" | Configuração de KPI | Métrica configurada |
| UP-343 | 809 | "Clientes recorrentes" | RecompraBlockCard | Métrica |
| UP-344 | 820 | "Vendas recorrentes" | Configuração de KPI | Métrica configurada |
| UP-345 | 821 | "Faturamento recorrente" | Configuração de KPI | Métrica configurada |
| UP-346 | 822 | "Ticket médio recorrente" | Configuração de KPI | Métrica configurada |
| UP-347 | 825 | "Clientes reativados" | RecompraBlockCard | Métrica |
| UP-348 | 836 | "Vendas reativadas" | Configuração de KPI | Métrica configurada |
| UP-349 | 837 | "Faturamento reativado" | Configuração de KPI | Métrica configurada |
| UP-350 | 838 | "Ticket médio reativado" | Configuração de KPI | Métrica configurada |
| UP-351 | 841 | "Ciclo de recompra" | RecompraBlockCard | Métrica |
| UP-352 | 853 | "Mediana entre compras" | Configuração de KPI | Métrica configurada |
| UP-353 | 854 | "% recorrente" | Configuração de KPI | Métrica configurada |
| UP-354 | 855 | "% reativado" | Configuração de KPI | Métrica configurada |
| UP-355 | 877 | Resultado de recompra | Card | Gráfico |
| UP-356 | 901 | Volume de recompra | Card | Gráfico |
| UP-357 | 924 | Recorrentes x Reativados | Card | Gráfico |
| UP-358 | 951 | Intervalo entre compras | Card | Gráfico |
| UP-359 | 995 | Análise de coorte de recompra | Card | Tabela / lista / detalhe |
| UP-360 | 1035 | Retenção por número de compra | Card | Gráfico |
| UP-361 | 1068 | Desempenho por vendedora | Card | Tabela / lista / detalhe |
| UP-362 | 1116 | Detalhamento de recompra | Card | Tabela / lista / detalhe |

## performance

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-363 | 453 | {title} | Card | Gráfico |
| UP-364 | 694 | "Faturamento ERP" | Configuração de KPI | Métrica configurada |
| UP-365 | 703 | "Receita atribuída" | Configuração de KPI | Métrica configurada |
| UP-366 | 717 | "Investimento" | Configuração de KPI | Métrica configurada |
| UP-367 | 726 | "ROAS atribuído" | Configuração de KPI | Métrica configurada |
| UP-368 | 735 | "MER geral" | Configuração de KPI | Métrica configurada |
| UP-369 | 744 | "Lucro bruto" | Configuração de KPI | Métrica configurada |
| UP-370 | 756 | "ROI final" | Configuração de KPI | Métrica configurada |
| UP-371 | 770 | "Ticket médio" | Configuração de KPI | Métrica configurada |
| UP-372 | 784 | "Pedidos ERP" | Configuração de KPI | Métrica configurada |
| UP-373 | 793 | "Pedidos atribuídos" | Configuração de KPI | Métrica configurada |
| UP-374 | 808 | "Compradores únicos" | Configuração de KPI | Métrica configurada |
| UP-375 | 819 | "Clientes novos" | Configuração de KPI | Métrica configurada |
| UP-376 | 833 | "Clientes recorrentes" | Configuração de KPI | Métrica configurada |
| UP-377 | 844 | "CAC" | Configuração de KPI | Métrica configurada |
| UP-378 | 853 | "CTR" | Configuração de KPI | Métrica configurada |
| UP-379 | 862 | "CPL" | Configuração de KPI | Métrica configurada |
| UP-380 | 1028 | Painel / conteúdo | DashboardKpiCard | Métrica |
| UP-381 | 1046 | Painel / conteúdo | Card | Gráfico |
| UP-382 | 1110 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-383 | 1150 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-384 | 1187 | {COHORT_LABEL[cohort]} | GlassMetricCard | Métrica |
| UP-385 | 1286 | Painel / conteúdo | DashboardKpiCard | Métrica |
| UP-386 | 1308 | Painel / conteúdo | DashboardKpiCard | Métrica |
| UP-387 | 1322 | Painel / conteúdo | Card | Painel |
| UP-388 | 1371 | {item.label} | GlassMetricCard | Métrica |
| UP-389 | 1379 | Painel / conteúdo | Card | Painel |
| UP-390 | 1388 | {stage.label} | GlassMetricCard | Métrica |
| UP-391 | 1402 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-392 | 1498 | "Vendas por cor" | BreakdownCard | Painel |
| UP-393 | 1503 | "Vendas por tamanho" | BreakdownCard | Painel |
| UP-394 | 1508 | "Vendas por estado" | BreakdownCard | Painel |
| UP-395 | 1515 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-396 | 1611 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-397 | 1702 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-398 | 1761 | "Pedidos no período" | GlassMetricCard | Métrica |
| UP-399 | 1762 | "Valor total" | GlassMetricCard | Métrica |
| UP-400 | 1763 | "Pedidos atribuídos" | GlassMetricCard | Métrica |
| UP-401 | 1764 | "Receita atribuída" | GlassMetricCard | Métrica |
| UP-402 | 1771 | "Faturamento pago atribuído" | GlassMetricCard | Métrica |

## product-detail

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-403 | 79 | {label} | GlassMetricCard | Métrica |
| UP-404 | 221 | {product.name} | Card | Painel |
| UP-405 | 274 | "Faturamento histórico" | KpiTile | Métrica |
| UP-406 | 275 | "Unidades vendidas" | KpiTile | Métrica |
| UP-407 | 276 | "Ticket médio" | KpiTile | Métrica |
| UP-408 | 277 | "Sell-through" | KpiTile | Métrica |
| UP-409 | 287 | <TrendingUp className="h-4 w-4" />Evolução do faturamento | Card | Gráfico |
| UP-410 | 367 | Painel / conteúdo | Card | Gráfico |
| UP-411 | 385 | <Users className="h-4 w-4" />Principais compradores | Card | Tabela / lista / detalhe |

## products

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-412 | 412 | "Sales Power" | GlassMetricCard | Métrica |
| UP-413 | 413 | "Faturamento por SKU/dia" | GlassMetricCard | Métrica |
| UP-414 | 414 | "SKUs ativos" | GlassMetricCard | Métrica |
| UP-415 | 415 | "Período" | GlassMetricCard | Métrica |
| UP-416 | 424 | {insight.headline} | Card | Painel |
| UP-417 | 486 | Painel / conteúdo | Card | Painel |
| UP-418 | 578 | Painel / conteúdo | Card | Tabela / lista / detalhe |
| UP-419 | 723 | "Vendidos" | GlassMetricCard | Métrica |
| UP-420 | 724 | "Receita" | GlassMetricCard | Métrica |
| UP-421 | 725 | "Estoque" | GlassMetricCard | Métrica |

## rfm

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-422 | 159 | {title} | GlassMetricCard | Métrica |
| UP-423 | 283 | Painel / conteúdo | Card | Painel |
| UP-424 | 325 | "Recência" | RfmLogicCard | Métrica |
| UP-425 | 332 | "Frequência" | RfmLogicCard | Métrica |
| UP-426 | 339 | "Monetário" | RfmLogicCard | Métrica |
| UP-427 | 362 | {meta.label} | GlassMetricCard | Métrica |
| UP-428 | 378 | <span className="h-1.5 w-1.5 rounded-full bg-primary" />Evolução da composição dos segmentos | Card | Gráfico |
| UP-429 | 440 | <span className="h-1.5 w-1.5 rounded-full bg-chart-3" />Compradoras RFM <span className="text-muted-foreground font-normal">({formatNumber(total)})</span><InfoHint text="A lista mostra clientes que solicitaram pedidos no período filtrado. Por padrão entram todos os pedidos; use o filtro de status para analisar somente aprovados, pendentes ou recusados." /> | Card | Tabela / lista / detalhe |
| UP-430 | 677 | Painel / conteúdo | Card | Painel |
| UP-431 | 718 | "Solicitado" | GlassMetricCard | Métrica |
| UP-432 | 719 | "Atendido" | GlassMetricCard | Métrica |
| UP-433 | 720 | "Peças solicitadas" | GlassMetricCard | Métrica |
| UP-434 | 721 | "Peças atendidas" | GlassMetricCard | Métrica |

## sales-agent

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-435 | 33 | {title} | GlassMetricCard | Métrica |
| UP-436 | 47 | Painel / conteúdo | Card | Painel |
| UP-437 | 62 | "Conversas" | Metric | Métrica |
| UP-438 | 68 | "Cadastros" | Metric | Métrica |
| UP-439 | 74 | "Pedidos" | Metric | Métrica |
| UP-440 | 80 | "Números conectados" | Metric | Métrica |
| UP-441 | 88 | CRM simplificado | Card | Painel |
| UP-442 | 97 | Cadastros criados | Card | Tabela / lista / detalhe |

## scale

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-443 | 158 | {title} | Card | Painel |
| UP-444 | 199 | Painel / conteúdo | Card | Painel |
| UP-445 | 208 | "Receita" | GlassMetricCard | Métrica |
| UP-446 | 209 | "Mídia" | GlassMetricCard | Métrica |
| UP-447 | 210 | "Pedidos estimados" | GlassMetricCard | Métrica |
| UP-448 | 218 | "Carregando Escala" | DashLoadingCard | Painel |
| UP-449 | 350 | "Poder de venda" | DashboardKpiCard | Métrica |
| UP-450 | 368 | "Faturamento" | DashboardKpiCard | Métrica |
| UP-451 | 385 | "Qtd. vendas" | DashboardKpiCard | Métrica |
| UP-452 | 402 | "Ticket médio" | DashboardKpiCard | Métrica |
| UP-453 | 419 | "Giro" | DashboardKpiCard | Métrica |
| UP-454 | 438 | "Invest. mídia" | DashboardKpiCard | Métrica |
| UP-455 | 455 | "ROAS" | DashboardKpiCard | Métrica |
| UP-456 | 472 | "Custo por compra" | DashboardKpiCard | Métrica |
| UP-457 | 492 | Calculadora de projeção | Card | Painel |
| UP-458 | 565 | "Atual" | GlassMetricCard | Métrica |
| UP-459 | 567 | "Meta" | GlassMetricCard | Métrica |
| UP-460 | 568 | "Intervalo" | GlassMetricCard | Métrica |
| UP-461 | 577 | "Incremento de receita" | GlassMetricCard | Métrica |
| UP-462 | 578 | "Incremento de mídia" | GlassMetricCard | Métrica |
| UP-463 | 579 | "Gap de estoque" | GlassMetricCard | Métrica |
| UP-464 | 580 | "Peças adicionais" | GlassMetricCard | Métrica |
| UP-465 | 584 | Insights de escala | Card | Painel |
| UP-466 | 630 | Painel / conteúdo | ScenarioCard | Painel |
| UP-467 | 635 | "Categorias mais vendidas" | BreakdownCard | Painel |
| UP-468 | 636 | "Tamanhos mais vendidos" | BreakdownCard | Painel |
| UP-469 | 637 | "Cores mais vendidas" | BreakdownCard | Painel |
| UP-470 | 638 | "Poder por categoria" | BreakdownCard | Painel |
| UP-471 | 641 | Como a projeção foi calculada | Card | Painel |

## seller-detail

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-472 | 81 | {label} | GlassMetricCard | Métrica |
| UP-473 | 253 | {seller.name} | Card | Painel |
| UP-474 | 301 | Painel / conteúdo | Card | Painel |
| UP-475 | 308 | "Faturamento" | KpiCard | Métrica |
| UP-476 | 316 | "Pedidos" | KpiCard | Métrica |
| UP-477 | 323 | "Ticket médio" | KpiCard | Métrica |
| UP-478 | 330 | "Clientes" | KpiCard | Métrica |
| UP-479 | 337 | "Taxa de aprovação" | KpiCard | Métrica |
| UP-480 | 344 | "% de conversão" | KpiCard | Métrica |
| UP-481 | 358 | <TrendingUp className="h-4 w-4" />Evolução do faturamento | Card | Gráfico |
| UP-482 | 461 | <BarChart2 className="h-4 w-4" />Faturamento por categoria | Card | Gráfico |
| UP-483 | 476 | <MapPin className="h-4 w-4" />Faturamento por estado | Card | Gráfico |
| UP-484 | 496 | <Users className="h-4 w-4" />Principais clientes | Card | Tabela / lista / detalhe |
| UP-485 | 586 | <ShoppingBag className="h-4 w-4" />Pedidos recentes | Card | Tabela / lista / detalhe |

## sellers

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-486 | 177 | "Faturamento total" | GlassMetricCard | Métrica |
| UP-487 | 181 | "Vendedoras ativas" | GlassMetricCard | Métrica |
| UP-488 | 185 | "Principal vendedora" | GlassMetricCard | Métrica |
| UP-489 | 192 | {insight.headline} | Card | Painel |
| UP-490 | 255 | Painel / conteúdo | Card | Gráfico |
| UP-491 | 415 | Painel / conteúdo | Card | Painel |
| UP-492 | 455 | {seller.name} | Card | Painel |

## stock-intelligence

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-493 | 133 | {label} | GlassMetricCard | Métrica |
| UP-494 | 160 | Painel / conteúdo | Card | Painel |
| UP-495 | 388 | {insight.headline} | Card | Painel |
| UP-496 | 458 | Painel / conteúdo | Card | Painel |
| UP-497 | 465 | "Total de unidades em estoque" | KpiCard | Métrica |
| UP-498 | 472 | "Cobertura média em dias" | KpiCard | Métrica |
| UP-499 | 479 | "SKUs com risco de ruptura" | KpiCard | Métrica |
| UP-500 | 487 | "SKUs com risco de excesso" | KpiCard | Métrica |
| UP-501 | 495 | "Sell-through Rate" | KpiCard | Métrica |
| UP-502 | 513 | Painel / conteúdo | Card | Painel |
| UP-503 | 553 | Todos os SKUs | Card | Tabela / lista / detalhe |
| UP-504 | 744 | Painel / conteúdo | Card | Gráfico |
| UP-505 | 822 | Painel / conteúdo | Card | Gráfico |
| UP-506 | 882 | Painel / conteúdo | Card | Gráfico |
| UP-507 | 970 | "Unidades vendidas" | GlassMetricCard | Métrica |
| UP-508 | 971 | "Unidades em estoque" | GlassMetricCard | Métrica |
| UP-509 | 972 | "Velocidade diária" | GlassMetricCard | Métrica |
| UP-510 | 973 | "Dias de cobertura" | GlassMetricCard | Métrica |

## utm

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-511 | 75 | {label} | GlassMetricCard | Métrica |
| UP-512 | 344 | "Sessões" | KpiCard | Métrica |
| UP-513 | 351 | "Cadastros" | KpiCard | Métrica |
| UP-514 | 357 | "% de aprovação" | KpiCard | Métrica |
| UP-515 | 364 | "Compradores" | KpiCard | Métrica |
| UP-516 | 370 | "Faturamento" | KpiCard | Métrica |
| UP-517 | 377 | "% de conversão" | KpiCard | Métrica |
| UP-518 | 384 | "ROAS" | KpiCard | Métrica |
| UP-519 | 397 | {insight.headline} | Card | Painel |
| UP-520 | 471 | Faturamento por {GROUP_LABELS[groupBy]} | Card | Gráfico |
| UP-521 | 527 | % de conversão por {GROUP_LABELS[groupBy]} | Card | Gráfico |
| UP-522 | 599 | Painel / conteúdo | Card | Painel |

## whatsapp-connections

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-523 | 727 | <PlugZap className="h-4 w-4 text-primary" />Conectar WhatsApp Business | Card | Painel |
| UP-524 | 903 | Painel / conteúdo | Card | Painel |
| UP-525 | 908 | "Conexões" | GlassMetricCard | Métrica |
| UP-526 | 911 | Painel / conteúdo | Card | Painel |
| UP-527 | 916 | "Números cadastrados" | GlassMetricCard | Métrica |
| UP-528 | 919 | Painel / conteúdo | Card | Painel |
| UP-529 | 947 | Painel / conteúdo | Card | Painel |
| UP-530 | 964 | <Webhook className="h-4 w-4 text-primary" />Webhook da Meta | Card | Painel |
| UP-531 | 1009 | {syncCopy.title} | Card | Painel |
| UP-532 | 1076 | "Mensagens importadas" | GlassMetricCard | Métrica |
| UP-533 | 1077 | "Eventos de histórico" | GlassMetricCard | Métrica |
| UP-534 | 1095 | <Smartphone className="h-4 w-4 text-primary" />Telefones de campanha | Card | Painel |
| UP-535 | 1190 | {numberTitle(phone)} | Card | Painel |

## whatsapp-conversations

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-536 | 215 | Painel / conteúdo | Card | Painel |
| UP-537 | 220 | "Conversas" | GlassMetricCard | Métrica |
| UP-538 | 223 | Painel / conteúdo | Card | Painel |
| UP-539 | 228 | "Mensagens aguardando" | GlassMetricCard | Métrica |
| UP-540 | 231 | Painel / conteúdo | Card | Painel |
| UP-541 | 236 | "Encerradas" | GlassMetricCard | Métrica |
| UP-542 | 239 | Painel / conteúdo | Card | Painel |
| UP-543 | 252 | Conversas | Card | Painel |

## whatsapp-sends

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-544 | 169 | <Send className="h-4 w-4 text-primary" />Envio teste WhatsApp | Card | Painel |

## whatsapp-templates

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-545 | 764 | "Aprovados" | GlassMetricCard | Métrica |
| UP-546 | 765 | "Pendentes" | GlassMetricCard | Métrica |
| UP-547 | 766 | "Recusados" | GlassMetricCard | Métrica |
| UP-548 | 804 | {phoneLabel(selectedPhone)} | Card | Painel |
| UP-549 | 856 | Variaveis para templates e automacoes | Card | Painel |
| UP-550 | 922 | Criar template | Card | Painel |
| UP-551 | 1283 | Modelos cadastrados | Card | Tabela / lista / detalhe |

## whatsapp

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-552 | 213 | {label} | GlassMetricCard | Métrica |
| UP-553 | 423 | <MessageCircle className="h-4 w-4 text-primary" />Atendimento WhatsApp | Card | Painel |
| UP-554 | 489 | "Total de conversas" | KpiCard | Métrica |
| UP-555 | 490 | "Novos leads" | KpiCard | Métrica |
| UP-556 | 491 | "Leads recorrentes" | KpiCard | Métrica |
| UP-557 | 492 | "Mensagens recebidas" | KpiCard | Métrica |
| UP-558 | 493 | "Mensagens enviadas" | KpiCard | Métrica |
| UP-559 | 494 | "Tempo 1ª resposta" | KpiCard | Métrica |
| UP-560 | 495 | "SLA cumprido" | KpiCard | Métrica |
| UP-561 | 496 | "Leads sem resposta" | KpiCard | Métrica |
| UP-562 | 497 | "Aguardando resposta" | KpiCard | Métrica |
| UP-563 | 498 | "Encerradas" | KpiCard | Métrica |
| UP-564 | 499 | "Perdidas" | KpiCard | Métrica |
| UP-565 | 503 | Conversas por dia | Card | Gráfico |
| UP-566 | 518 | Conversas por hora | Card | Gráfico |
| UP-567 | 533 | Recebidas vs enviadas | Card | Gráfico |
| UP-568 | 549 | Ranking por conversas atendidas | Card | Gráfico |
| UP-569 | 566 | Funil comercial do WhatsApp | Card | Gráfico |
| UP-570 | 600 | Taxa de avanço por etapa | Card | Painel |
| UP-571 | 634 | Tempo médio de primeira resposta por perfil WhatsApp | Card | Gráfico |
| UP-572 | 650 | Conversas sem resposta | Card | Tabela / lista / detalhe |
| UP-573 | 678 | Motivos de perda | Card | Tabela / lista / detalhe |
| UP-574 | 703 | Produtividade por perfil WhatsApp | Card | Tabela / lista / detalhe |

## purchase-insights

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-575 | 15 | Painel / conteúdo | Card | Painel |
| UP-576 | 34 | Painel / conteúdo | Card | Painel |
| UP-577 | 34 | Painel / conteúdo | Card | Painel |
| UP-578 | 36 | Distribuição de compradores | Card | Painel |
| UP-579 | 42 | "Compram na primeira semana" | GlassMetricCard | Métrica |
| UP-580 | 43 | "Compram em até 30 dias" | GlassMetricCard | Métrica |
| UP-581 | 44 | "Mediana até o pedido" | GlassMetricCard | Métrica |

## acquisition-funnel

| ID | Linha | Título / label | Componente | Família |
|---|---:|---|---|---|
| UP-582 | 7 | {title} | Card | Painel |

