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

export const formatPercentage = (value: number) => {
  return `${value.toFixed(1)}%`;
};

export const formatNumber = (
  value: number,
  opts: { locale?: string } = {},
) => {
  return new Intl.NumberFormat(opts.locale ?? _activeLocale).format(value);
};
