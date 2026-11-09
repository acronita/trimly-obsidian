/**
 * Reads a spreadsheet the user picked, Excel or CSV, into rows of text. All in memory:
 * nothing is written anywhere. Excel is read by hand (an .xlsx is a zip of XML, and the
 * platform can inflate) so the plugin doesn't need a new dependency.
 *
 * Kept free of Obsidian imports so it can be unit tested in Node.
 */

export type Rows = string[][];

/** Far more than any statement: past this it isn't one. */
const MAX_BYTES = 20 * 1024 * 1024;

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The files of a zip, from its central directory. */
export async function unzip(bytes: Uint8Array, wanted: (name: string) => boolean, encoding = "utf-8"): Promise<Map<string, string>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not a zip");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = new Map<string, string>();
  const decoder = new TextDecoder();
  const content = new TextDecoder(encoding);
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("bad zip");
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (wanted(name)) {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      out.set(name, content.decode(method === 0 ? data : await inflate(data)));
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

const xmlText = (raw: string) =>
  raw
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

function columnIndex(ref: string): number {
  let index = 0;
  for (const ch of ref.replace(/\d+/g, "")) index = index * 26 + ch.charCodeAt(0) - 64;
  return index - 1;
}

function sheetRows(xml: string, shared: string[]): Rows {
  const rows: Rows = [];
  for (const [, row] of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const [, attrs, body] of row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const at = columnIndex(attrs.match(/\br="([A-Z]+\d*)"/)?.[1] ?? "A");
      const type = attrs.match(/\bt="(\w+)"/)?.[1];
      const value = (body ?? "").match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
      while (cells.length < at) cells.push("");
      cells[at] = type === "s" ? (shared[Number(value)] ?? "") : type === "inlineStr" ? xmlText(body ?? "") : xmlText(value);
    }
    rows.push(cells.map((c) => c ?? ""));
  }
  return rows;
}

/** Every sheet of a workbook, in file order. */
export async function readXlsx(bytes: Uint8Array): Promise<Rows[]> {
  const files = await unzip(bytes, (n) => n === "xl/sharedStrings.xml" || /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  const shared = [...(files.get("xl/sharedStrings.xml") ?? "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(([, si]) =>
    [...si.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(([, t]) => xmlText(t)).join("")
  );
  return [...files.entries()]
    .filter(([name]) => name.includes("/worksheets/"))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([, xml]) => sheetRows(xml, shared));
}

/** Rows of a CSV, whichever of the usual separators it uses. */
export function parseCsv(text: string): Rows {
  const clean = text.replace(new RegExp("^\\uFEFF"), "");
  const first = clean.split(/\r?\n/, 1)[0] ?? "";
  const separator = [";", "\t", ","].map((s) => [s, first.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: Rows = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === separator) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

/** Excel in Brazil often saves CSV as Windows-1252, where accents aren't valid UTF-8. */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** The sheets of a file, by what it is rather than what it is called; a zip is an Excel file. */
export async function readSpreadsheet(bytes: Uint8Array): Promise<Rows[]> {
  if (bytes.length > MAX_BYTES) throw new Error("too large");
  return bytes[0] === 0x50 && bytes[1] === 0x4b ? readXlsx(bytes) : [parseCsv(decodeText(bytes))];
}
