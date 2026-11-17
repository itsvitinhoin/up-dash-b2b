/** Normalize legacy Nuvemshop items whose variation values arrived in size/color order. */
export function looksLikeSize(value: string | null | undefined): boolean {
  const normalized = (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
  if (/^(?:PP|P|M|G|GG|XG|XGG|XXG|XS|S|L|XL|XXL|XXXL|G[1-9])\s*[-–—]\s*\d{1,3}$/.test(normalized)) return true;
  return /^(PP|P|M|G|GG|XG|XGG|XXG|EXG|EG|XP|XS|S|L|XL|XXL|XXXL|U|UNICO|UNICA|ONE SIZE|TAMANHO UNICO|G[1-9]|GG[1-9]|[1-9]G|[1-9]XL|\d{1,3})$/.test(
    normalized,
  );
}
export function normalizedVariantAttrs(row: {
  color: string | null;
  size: string | null;
}) {
  const color = row.color?.trim() || null;
  const size = row.size?.trim() || null;
  if (looksLikeSize(color) && size && !looksLikeSize(size))
    return { color: size, size: color };
  if (looksLikeSize(color) && !size) return { color: null, size: color };
  if (!color && size && !looksLikeSize(size))
    return { color: size, size: null };
  return { color, size };
}
