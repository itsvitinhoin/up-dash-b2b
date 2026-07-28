// Mapa DDD -> UF usado como fallback quando não há endereço/estado real
// cadastrado. Extraído de services/upzero-sync.ts (onde já era usado pro
// heat map de clients UpZero) pra ser reaproveitado também pelo lado Vesti.
export const DDD_TO_STATE: Record<string, string> = {
  "11": "SP", "12": "SP", "13": "SP", "14": "SP", "15": "SP", "16": "SP", "17": "SP", "18": "SP", "19": "SP",
  "21": "RJ", "22": "RJ", "24": "RJ",
  "27": "ES", "28": "ES",
  "31": "MG", "32": "MG", "33": "MG", "34": "MG", "35": "MG", "37": "MG", "38": "MG",
  "41": "PR", "42": "PR", "43": "PR", "44": "PR", "45": "PR", "46": "PR",
  "47": "SC", "48": "SC", "49": "SC",
  "51": "RS", "53": "RS", "54": "RS", "55": "RS",
  "61": "DF",
  "62": "GO", "64": "GO",
  "63": "TO",
  "65": "MT", "66": "MT",
  "67": "MS",
  "68": "AC",
  "69": "RO",
  "71": "BA", "73": "BA", "74": "BA", "75": "BA", "77": "BA",
  "79": "SE",
  "81": "PE", "87": "PE",
  "82": "AL",
  "83": "PB",
  "84": "RN",
  "85": "CE", "88": "CE",
  "86": "PI", "89": "PI",
  "91": "PA", "93": "PA", "94": "PA",
  "92": "AM", "97": "AM",
  "95": "RR",
  "96": "AP",
  "98": "MA", "99": "MA",
};

export function stateFromPhoneDdd(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  let national = digits;
  if (national.startsWith("55") && national.length >= 12) national = national.slice(2);
  if (national.startsWith("0") && national.length >= 11) national = national.slice(1);
  const ddd = national.slice(0, 2);
  return DDD_TO_STATE[ddd] ?? null;
}
