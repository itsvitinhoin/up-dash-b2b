type Period = "previous" | "current";
type Counts = { carts: number; checkouts: number };
export type CheckoutEvent = {
  period: Period;
  channel: string;
  campaign: string;
  device: string;
  event: string;
  count: number;
  days?: number;
};
export type CheckoutItem = Counts & {
  period: Period;
  channel: string;
  campaign: string;
  id: string;
  name: string;
};
export type CheckoutDiagnosticData = {
  source: "ga4" | "bigquery";
  events: CheckoutEvent[];
  items: CheckoutItem[];
};

export type CheckoutDiagnosis = {
  source: CheckoutDiagnosticData["source"] | "nuvemshop" | "meta";
  factors: { label: string; detail: string }[];
  unresolved: string;
  action: string;
  followUp: string;
  targetVariantId?: string;
};

export type CheckoutStock = {
  observedAt: string;
  variants: ReadonlyMap<string, number | null>;
};

type Entry = { key: string; name: string; period: Period } & Counts;
type Comparison = ReturnType<typeof compare>[number];

const whole = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const timestamp = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});
const percent = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 1,
});

function compare(entries: Entry[]) {
  const groups = new Map<string, Record<Period, Counts> & { name: string }>();
  for (const entry of entries) {
    const pair = groups.get(entry.key) ?? {
      name: entry.name,
      previous: { carts: 0, checkouts: 0 },
      current: { carts: 0, checkouts: 0 },
    };
    if (entry.period === "current") pair.name = entry.name;
    pair[entry.period].carts += entry.carts;
    pair[entry.period].checkouts += entry.checkouts;
    groups.set(entry.key, pair);
  }
  return [...groups].map(([key, pair]) => ({
    ...pair,
    key,
    gap: pair.previous.carts
      ? (pair.current.carts * pair.previous.checkouts) / pair.previous.carts -
        pair.current.checkouts
      : 0,
  }));
}

function losses(rows: Comparison[], minimum: number) {
  return rows
    .filter(({ previous, current, gap }) =>
      previous.carts >= minimum && current.carts >= minimum && gap >= 1 &&
      previous.checkouts <= previous.carts && current.checkouts <= current.carts,
    )
    .sort((a, b) => b.gap - a.gap || b.current.carts - a.current.carts ||
      a.key.localeCompare(b.key));
}

function countsBy(
  events: CheckoutEvent[],
  dimension: "channel" | "campaign" | "device",
) {
  return compare(events.flatMap((row) =>
    row.event === "add_to_cart" || row.event === "begin_checkout"
      ? [{
          key: row[dimension],
          name: row[dimension],
          period: row.period,
          carts: row.event === "add_to_cart" ? row.count : 0,
          checkouts: row.event === "begin_checkout" ? row.count : 0,
        }]
      : [],
  ));
}

function sameTotals(rows: Comparison[], expected: Record<Period, Counts>) {
  return (["previous", "current"] as const).every((period) =>
    rows.reduce((sum, row) => sum + row[period].carts, 0) === expected[period].carts &&
    rows.reduce((sum, row) => sum + row[period].checkouts, 0) === expected[period].checkouts,
  );
}

const identified = (key: string) => Boolean(key) && !key.startsWith("(");
const channelNames: Record<string, string> = {
  "Paid Social": "Social Pago",
  Direct: "Direto",
  "Organic Search": "Busca Orgânica",
  "Paid Search": "Busca Paga",
  "Organic Social": "Social Orgânico",
  "Organic Shopping": "Shopping Orgânico",
};
const labelChannel = (key: string) => channelNames[key] ?? key;
const formatCounts = ({ carts, checkouts }: Counts) =>
  `${whole.format(checkouts)} de ${whole.format(carts)}`;
const formatRate = ({ carts, checkouts }: Counts) => percent.format(checkouts / carts);
const formatComparison = ({ previous, current }: Comparison) =>
  `${formatCounts(previous)} (${formatRate(previous)}) → ${formatCounts(current)} (${formatRate(current)})`;

export function diagnoseCheckout(
  data: CheckoutDiagnosticData,
  expected: Record<Period, Counts>,
  stock?: CheckoutStock,
): CheckoutDiagnosis | null {
  const channels = countsBy(data.events, "channel");
  if (!sameTotals(channels, expected)) return null;

  const channel = losses(channels.filter(({ key }) => identified(key)), 20)[0];
  if (!channel) return null;
  const segment = data.events.filter(({ channel: name }) => name === channel.key);
  const campaign = losses(
    countsBy(segment, "campaign").filter(({ key }) => identified(key)),
    20,
  )[0];
  const scope = campaign
    ? segment.filter(({ campaign: name }) => name === campaign.key)
    : segment;
  const devices = countsBy(scope, "device");
  const mobile = devices.find(({ key }) => key === "mobile");
  const mainScope = campaign ?? channel;
  const onMobile = Boolean(
    mobile && mobile.previous.carts >= mainScope.previous.carts * 0.8 &&
      mobile.current.carts >= mainScope.current.carts * 0.8 && mobile.gap >= 1,
  );
  const channelName = labelChannel(channel.key);
  const factors = [{
    label: channelName,
    detail: `${formatComparison(channel)}. Foi o maior desvio entre os canais identificados com volume comparável, cerca de ${whole.format(channel.gap)} inícios de checkout abaixo do esperado pela taxa do período anterior.`,
  }];
  if (campaign) {
    factors.push({
      label: onMobile ? "Campanha e dispositivo" : "Campanha",
      detail: `${campaign.name} em ${channelName}${onMobile ? ", com a queda concentrada no celular" : ""}. ${formatComparison(campaign)}.`,
    });
  }

  const compareItems = (items: CheckoutItem[]) => losses(compare(
    items.filter(({ id }) => identified(id)).map((row) => ({ ...row, key: row.id })),
  ), 4).slice(0, 2);
  const channelItems = data.items.filter((row) => row.channel === channel.key);
  const campaignItems = campaign
    ? compareItems(channelItems.filter((row) => row.campaign === campaign.key))
    : [];
  const productScope = campaignItems.length ? "da campanha" : channelItems.length
    ? `de ${channelName}` : "da loja";
  const products = campaignItems.length ? campaignItems : compareItems(
    channelItems.length ? channelItems : data.items.filter((row) => !row.channel),
  );
  if (products.length) {
    factors.push({
      label: `Variantes ${productScope}`,
      detail: products.map((product) =>
        `${product.name} (${formatCounts(product.previous)} → ${formatCounts(product.current)})`,
      ).join(" · ") + ". Unidades no checkout por unidades adicionadas. Volume por variante limitado.",
    });
  }

  const balances = products.flatMap(({ key, name }) => {
    const quantity = stock?.variants.get(key);
    return quantity == null ? [] : [`${name} · ${whole.format(quantity)} unidades`];
  });
  if (stock && balances.length) {
    factors.push({
      label: "Estoque consultado",
      detail: `${balances.join(" · ")}. Saldo conferido em ${timestamp.format(new Date(stock.observedAt))}. O saldo durante os carrinhos analisados é desconhecido.`,
    });
  }

  const eventTotal = (event: string, period: Period) =>
    data.events.reduce((sum, row) =>
      sum + (row.event === event && row.period === period ? row.count : 0), 0);
  const previousViews = eventTotal("view_cart", "previous");
  const currentViews = eventTotal("view_cart", "current");
  const previousRemovals = eventTotal("remove_from_cart", "previous");
  const currentRemovals = eventTotal("remove_from_cart", "current");
  if (previousViews >= expected.previous.checkouts && currentViews >= expected.current.checkouts &&
    previousViews > 0 && currentViews > 0 &&
    expected.current.checkouts / currentViews < expected.previous.checkouts / previousViews) {
    const from = { carts: previousViews, checkouts: expected.previous.checkouts };
    const to = { carts: currentViews, checkouts: expected.current.checkouts };
    factors.push({
      label: "Sinais no carrinho",
      detail: `Os inícios de checkout por visualização do carrinho caíram de ${formatRate(from)} para ${formatRate(to)}.` +
        (currentRemovals > previousRemovals
          ? ` As remoções subiram de ${whole.format(previousRemovals)} para ${whole.format(currentRemovals)}.`
          : ""),
    });
  }
  const other = channels.filter(({ key, previous, current }) =>
    key !== channel.key && identified(key) && previous.carts < 20 &&
    current.carts - previous.carts >= 10 && current.checkouts < previous.checkouts,
  ).sort((a, b) => b.current.carts - b.previous.carts - (a.current.carts - a.previous.carts))[0];
  if (other) {
    factors.push({
      label: "Mudança no perfil de tráfego",
      detail: `${labelChannel(other.key)} teve ${whole.format(other.previous.carts)} → ${whole.format(other.current.carts)} adições e ${whole.format(other.previous.checkouts)} → ${whole.format(other.current.checkouts)} inícios de checkout. Base anterior pequena para estimar impacto.`,
    });
  }

  const target = campaign ? `da campanha ${campaign.name}` : `de ${channelName}`;
  const relevantProducts = campaign ? campaignItems : channelItems.length ? products : [];
  const testVariant = relevantProducts.find(({ key }) => stock?.variants.get(key) !== 0);
  const product = testVariant?.name;
  return {
    source: data.source,
    targetVariantId: testVariant?.key,
    factors,
    unresolved: "O GA4 localiza a queda por eventos. A causa técnica ainda exige verificar o clique para iniciar o checkout e o retorno do cálculo de frete.",
    action: `Reproduzir ${onMobile ? "no celular " : ""}o carrinho ${target}${product ? ` com ${product}` : ""}. Testar CEP, cálculo de frete, subtotal e o botão de checkout. Registrar onde a passagem falha e corrigir o ponto reproduzido antes de rever a verba.`,
    followUp: `Em 7 dias, medir inícios de checkout por adição ao carrinho ${target} e acompanhar os erros registrados no carrinho.`,
  };
}
