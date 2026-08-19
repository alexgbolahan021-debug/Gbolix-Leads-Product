import { csvFieldAliases, leadInputSchema, type LeadInput } from "@shared/leadContracts";

export type CsvParseResult = {
  headers: string[];
  mapping: Partial<Record<keyof LeadInput, string>>;
  valid: LeadInput[];
  invalid: Array<{ row: number; message: string }>;
};

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let buffer = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];
    if (character === '"' && inQuotes && next === '"') {
      buffer += '"';
      index += 1;
    } else if (character === '"') {
      inQuotes = !inQuotes;
    } else if (character === "," && !inQuotes) {
      cells.push(buffer.trim());
      buffer = "";
    } else {
      buffer += character;
    }
  }
  cells.push(buffer.trim());
  return cells;
}

function findHeader(headers: string[], aliases: string[]) {
  return headers.find(header => aliases.includes(header.trim().toLowerCase()));
}

export function parseLeadCsv(content: string): CsvParseResult {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) {
    return { headers: [], mapping: {}, valid: [], invalid: [{ row: 1, message: "CSV needs a header row and at least one business row." }] };
  }
  if (lines.length > 2501) {
    return { headers: [], mapping: {}, valid: [], invalid: [{ row: 1, message: "CSV is limited to 2,500 data rows per engine operation." }] };
  }

  const headers = parseCsvLine(lines[0]);
  const mapping = Object.fromEntries(
    Object.entries(csvFieldAliases)
      .map(([field, aliases]) => [field, findHeader(headers, aliases)])
      .filter(([, header]) => Boolean(header))
  ) as Partial<Record<keyof LeadInput, string>>;

  if (!mapping.businessName) {
    return { headers, mapping, valid: [], invalid: [{ row: 1, message: "Map one header to business name, company, or name." }] };
  }

  const valid: LeadInput[] = [];
  const invalid: Array<{ row: number; message: string }> = [];
  for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
    const values = parseCsvLine(lines[rowIndex]);
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    const input = Object.fromEntries(
      Object.entries(mapping).map(([field, header]) => [field, header ? record[header] ?? "" : ""])
    );
    const parsed = leadInputSchema.safeParse(input);
    if (parsed.success) valid.push(parsed.data);
    else invalid.push({ row: rowIndex + 1, message: parsed.error.issues.map(issue => issue.message).join("; ") });
  }

  return { headers, mapping, valid, invalid };
}

export function parseDomainList(content: string) {
  const valid: LeadInput[] = [];
  const invalid: Array<{ row: number; message: string }> = [];
  const rows = content.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  if (rows.length > 2500) {
    return { valid, invalid: [{ row: 1, message: "Domain lists are limited to 2,500 rows per engine operation." }] };
  }
  rows.forEach((domain, index) => {
    try {
      const url = new URL(domain.includes("://") ? domain : `https://${domain}`);
      if (!url.hostname.includes(".")) throw new Error("Domain must include a public suffix.");
      valid.push({ businessName: url.hostname.replace(/^www\./, ""), website: url.toString() });
    } catch {
      invalid.push({ row: index + 1, message: "Invalid domain or website URL." });
    }
  });
  return { valid, invalid };
}
