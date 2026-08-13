import Papa from "papaparse";

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

// Thin wrapper around papaparse — kept separate from mapping/validation
// so those stay pure and easy to unit test without a real CSV string.
export function parseCsv(content: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (result.errors.length > 0) {
    const first = result.errors[0]!;
    throw new Error(`CSV parse error at row ${first.row}: ${first.message}`);
  }

  return {
    headers: result.meta.fields ?? [],
    rows: result.data,
  };
}
