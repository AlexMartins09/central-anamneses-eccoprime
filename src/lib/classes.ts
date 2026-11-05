/** Sugestões de turma/série por segmento (o campo continua livre: a família pode digitar "7º ano B"). */
const SERIES = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${from + i}º ano`);

const SUGGESTIONS: Record<string, string[]> = {
  "educacao-infantil": ["Maternal", "Pré-escola"],
  "fundamental-1": SERIES(1, 5),
  "fundamental-2": [...SERIES(6, 9), "1ª série do Médio", "2ª série do Médio", "3ª série do Médio"],
};

export function classSuggestions(segmentSlug: string): string[] {
  return SUGGESTIONS[segmentSlug] ?? [];
}
