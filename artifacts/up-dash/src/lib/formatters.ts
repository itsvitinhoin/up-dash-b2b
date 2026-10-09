// Active locale & currency, hot-swapped per signed-in client. The defaults
// match a fresh install (Brazilian Portuguese). Calling `setActiveCurrency`
// is enough to retint every dashboard number in the app — components don't
// need to be currency-aware.
let _activeLocale = "pt-BR";
let _activeCurrency = "BRL";

export function setActiveCurrency(currency: string, locale: string): void {
  if (currency) _activeCurrency = currency;
  if (locale) _activeLocale = locale;
}

export function getActiveCurrency(): { currency: string; locale: string } {
  return { currency: _activeCurrency, locale: _activeLocale };
}

export const formatCurrency = (
  value: number,
  opts: { currency?: string; locale?: string; compact?: boolean } = {},
) => {
  return new Intl.NumberFormat(opts.locale ?? _activeLocale, {
    style: "currency",
    currency: opts.currency ?? _activeCurrency,
    maximumFractionDigits: 2,
    ...(opts.compact ? { notation: "compact", maximumFractionDigits: 1 } : {}),
  }).format(value);
};

// Auto-compacts to short notation (e.g. "R$ 601,2 mil") when |value| ≥ 10 000,
// so KPI tiles never overflow their card width.
export const formatCurrencySmart = (
  value: number,
  opts: { currency?: string; locale?: string } = {},
) => formatCurrency(value, { ...opts, compact: Math.abs(value) >= 10_000 });

/**
 * Data que o ERP manda só com o DIA (meia-noite UTC): mostra o dia UTC, sem converter para o fuso do navegador.
 * Achado 09/10/2026: `new Date("2026-09-14T00:00:00.000Z")` no fuso de São Paulo virava "13/09 21:00" (um dia a menos e hora falsa).
 */
export const formatErpDate = (value: string | Date | null | undefined, short = false): string => {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = short ? String(date.getUTCFullYear()).slice(-2) : String(date.getUTCFullYear());
  return `${day}/${month}/${year}`;
};

export const formatPercentage = (value: number) => {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
};

export const formatNumber = (
  value: number,
  opts: { locale?: string } = {},
) => {
  return new Intl.NumberFormat(opts.locale ?? _activeLocale).format(value);
};
