export type BrazilianState = {
  name: string;
  code: string;
};

export type BrazilianCity = {
  id: number;
  name: string;
};

export const BRAZILIAN_STATES: BrazilianState[] = [
  { name: "Acre", code: "AC" },
  { name: "Alagoas", code: "AL" },
  { name: "Amapá", code: "AP" },
  { name: "Amazonas", code: "AM" },
  { name: "Bahia", code: "BA" },
  { name: "Ceará", code: "CE" },
  { name: "Distrito Federal", code: "DF" },
  { name: "Espírito Santo", code: "ES" },
  { name: "Goiás", code: "GO" },
  { name: "Maranhão", code: "MA" },
  { name: "Mato Grosso", code: "MT" },
  { name: "Mato Grosso do Sul", code: "MS" },
  { name: "Minas Gerais", code: "MG" },
  { name: "Pará", code: "PA" },
  { name: "Paraíba", code: "PB" },
  { name: "Paraná", code: "PR" },
  { name: "Pernambuco", code: "PE" },
  { name: "Piauí", code: "PI" },
  { name: "Rio de Janeiro", code: "RJ" },
  { name: "Rio Grande do Norte", code: "RN" },
  { name: "Rio Grande do Sul", code: "RS" },
  { name: "Rondônia", code: "RO" },
  { name: "Roraima", code: "RR" },
  { name: "Santa Catarina", code: "SC" },
  { name: "São Paulo", code: "SP" },
  { name: "Sergipe", code: "SE" },
  { name: "Tocantins", code: "TO" },
];

const IBGE_LOCATIONS_URL = "https://servicodados.ibge.gov.br/api/v1/localidades";
const cityCache = new Map<string, BrazilianCity[]>();

export async function fetchBrazilianCities(
  stateCode: string,
  signal?: AbortSignal,
): Promise<BrazilianCity[]> {
  const normalizedState = stateCode.trim().toUpperCase();
  if (!BRAZILIAN_STATES.some((state) => state.code === normalizedState)) {
    return [];
  }

  const cached = cityCache.get(normalizedState);
  if (cached) return cached;

  const response = await fetch(
    `${IBGE_LOCATIONS_URL}/estados/${encodeURIComponent(normalizedState)}/municipios?orderBy=nome`,
    { signal },
  );
  if (!response.ok) {
    throw new Error("Não foi possível consultar as cidades no IBGE.");
  }

  const payload = (await response.json()) as { id?: unknown; nome?: unknown }[];
  const cities = payload
    .filter((city) => typeof city.id === "number" && typeof city.nome === "string")
    .map((city) => ({ id: city.id as number, name: String(city.nome) }));

  if (cities.length === 0) {
    throw new Error("Nenhuma cidade foi encontrada para este estado.");
  }

  cityCache.set(normalizedState, cities);
  return cities;
}
