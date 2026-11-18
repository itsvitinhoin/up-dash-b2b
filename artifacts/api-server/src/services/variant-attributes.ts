function normalizeSizeCandidate(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

/** Normalize legacy Nuvemshop items whose variation values arrived in size/color order. */
export function looksLikeSize(value: string | null | undefined): boolean {
  const normalized = normalizeSizeCandidate(value);
  if (/^(?:PP|P|M|G|GG|XG|XGG|XXG|XS|S|L|XL|XXL|XXXL|G[1-9])\s*[-/–—]\s*\d{1,3}$/.test(normalized)) return true;
  return /^(PP|P|M|G|GG|XG|XGG|XXG|EXG|EG|XP|XS|S|L|XL|XXL|XXXL|U|UNICO|UNICA|ONE SIZE|TAMANHO UNICO|G[1-9]|GG[1-9]|[1-9]G|[1-9]XL|\d{1,3})$/.test(
    normalized,
  );
}

// "P"/"M"/"G" e códigos numéricos curtos colidem com nome/código de cor real (ex.: cor "G",
// cor numérica "012"). Só reclassificar cor->tamanho sem nenhuma outra evidência (ver uso
// abaixo) quando o valor não tem leitura plausível como cor.
function looksUnambiguouslyLikeSize(value: string | null | undefined): boolean {
  const normalized = normalizeSizeCandidate(value);
  return /^(?:GG|XG|XGG|XXG|EXG|EG|XXL|XXXL|U|UNICO|UNICA|ONE SIZE|TAMANHO UNICO|G[1-9]|GG[1-9]|[1-9]G|[1-9]XL)$/.test(normalized);
}

export function normalizedVariantAttrs(row: {
  color: string | null;
  size: string | null;
}) {
  let color = row.color?.trim() || null;
  let size = row.size?.trim() || null;
  // Legacy imports split a composite size before joining it to a color.
  const splitColor = color?.split(/\s*\/\s*/);
  if (splitColor && splitColor.length > 1 && looksLikeSize(splitColor[0]) && size && looksLikeSize(size)) {
    const remaining = splitColor.slice(1).join(" / ");
    if (!looksLikeSize(remaining)) { size = size.split(/\s*[-/]\s*/).includes(splitColor[0]) ? size : `${size} / ${splitColor[0]}`; color = remaining; }
  }
  // Restore a shade whose expiry date was incorrectly split at its slash.
  if (color && size && /\bVAL[^/]*\d{1,2}\s*$/i.test(color) && /^\d{4}\)$/.test(size)) return {color:`${color}/${size}`,size:null};
  if (looksLikeSize(color) && size && !looksLikeSize(size))
    return { color: size, size: color };
  if (!size && looksUnambiguouslyLikeSize(color)) return { color: null, size: color };
  if (!color && size && !looksLikeSize(size))
    return { color: size, size: null };
  return { color, size };
}

/** Values are separate source options: slashes inside one option are not delimiters. */
export function variantAttributesFromValues(values: readonly string[]) {
  const parts=values.map(value=>value.trim()).filter(Boolean);
  const index=parts.findIndex(looksLikeSize);
  if(index>=0) return {size:parts[index],color:parts.filter((_,i)=>i!==index).join(" / ") || null};
  return {color:parts[0] ?? null,size:parts.slice(1).join(" / ") || null};
}
