export const PROVINCE_TO_STATE: Record<string, string> = {
  acre: "AC",
  alagoas: "AL",
  amapá: "AP",
  amapa: "AP",
  amazonas: "AM",
  bahia: "BA",
  ceará: "CE",
  ceara: "CE",
  "distrito federal": "DF",
  "espírito santo": "ES",
  "espirito santo": "ES",
  goiás: "GO",
  goias: "GO",
  maranhão: "MA",
  maranhao: "MA",
  "minas gerais": "MG",
  "mato grosso": "MT",
  "mato grosso do sul": "MS",
  pará: "PA",
  para: "PA",
  paraíba: "PB",
  paraiba: "PB",
  paraná: "PR",
  parana: "PR",
  pernambuco: "PE",
  piauí: "PI",
  piaui: "PI",
  "rio de janeiro": "RJ",
  "rio grande do norte": "RN",
  "rio grande do sul": "RS",
  rondônia: "RO",
  rondonia: "RO",
  roraima: "RR",
  "santa catarina": "SC",
  "são paulo": "SP",
  "sao paulo": "SP",
  sergipe: "SE",
  tocantins: "TO",
};

const states = new Set(Object.values(PROVINCE_TO_STATE));

export function brazilianState(province: unknown, country: unknown) {
  if (typeof country === "string" && country.trim() && country.trim().toUpperCase() !== "BR") return null;
  if (typeof province !== "string") return null;
  const value = province.trim().replace(/\s+/g, " ");
  const code = value.toUpperCase();
  return states.has(code) ? code : PROVINCE_TO_STATE[value.toLowerCase()] ?? null;
}
