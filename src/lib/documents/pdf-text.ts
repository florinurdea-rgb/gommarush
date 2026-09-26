import "server-only";
import { inflateSync, inflateRawSync } from "node:zlib";

/**
 * Minimal, dependency-free text-layer extractor for PDFs.
 *
 * WHY HAND-ROLLED: a text PDF should not need an AI call at all, and pulling in
 * pdfjs (several MB) for a fast path we hit on every upload is a poor trade on a
 * serverless deployment.
 *
 * WHAT IT HANDLES: uncompressed and FlateDecode content streams with standard
 * text-showing operators (Tj, TJ, ', ") and literal/hex strings.
 *
 * WHAT IT DOES NOT: CID/Type0 fonts with custom CMaps, and any other encoding
 * where the byte values in the content stream are glyph indices rather than
 * characters. Those come back as garbage, which is exactly why
 * `looksLikeUsableText` gates the result — a failed extraction must degrade to
 * the AI provider or the manual form, never to plausible-looking nonsense.
 */

/** PDF escape sequences inside literal strings. */
const ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
  "(": "(",
  ")": ")",
  "\\": "\\",
};

function decodeLiteralString(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char !== "\\") {
      out += char;
      continue;
    }

    const next = input[i + 1];
    if (next === undefined) break;

    if (ESCAPES[next] !== undefined) {
      out += ESCAPES[next];
      i += 1;
      continue;
    }

    // Octal character code: \101 -> "A"
    const octal = /^[0-7]{1,3}/.exec(input.slice(i + 1));
    if (octal) {
      out += String.fromCharCode(parseInt(octal[0], 8));
      i += octal[0].length;
      continue;
    }

    // Line continuation: backslash before a newline emits nothing.
    if (next === "\n" || next === "\r") {
      i += 1;
      continue;
    }

    out += next;
    i += 1;
  }
  return out;
}

function decodeHexString(input: string): string {
  const hex = input.replace(/[^0-9A-Fa-f]/g, "");
  let out = "";
  for (let i = 0; i + 1 < hex.length; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return out;
}

/**
 * Pulls the content streams out of the raw PDF bytes, inflating the compressed
 * ones. Latin1 keeps the byte<->char mapping lossless for the text operators.
 */
function extractContentStreams(pdf: Buffer): string[] {
  const streams: string[] = [];
  const haystack = pdf.toString("latin1");

  const streamPattern = /stream\r?\n?/g;
  let match: RegExpExecArray | null;

  while ((match = streamPattern.exec(haystack)) !== null) {
    const start = match.index + match[0].length;
    const end = haystack.indexOf("endstream", start);
    if (end === -1) continue;

    const raw = pdf.subarray(start, end);
    // The dictionary immediately before `stream` tells us the filter.
    const dictionaryStart = Math.max(0, match.index - 500);
    const dictionary = haystack.slice(dictionaryStart, match.index);

    if (/\/FlateDecode/.test(dictionary)) {
      try {
        streams.push(inflateSync(raw).toString("latin1"));
      } catch {
        try {
          // Some writers omit the zlib header.
          streams.push(inflateRawSync(raw).toString("latin1"));
        } catch {
          // Not inflatable — skip rather than emit binary noise.
        }
      }
    } else if (!/\/(DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode|RunLengthDecode|ASCII85Decode|LZWDecode)/.test(dictionary)) {
      streams.push(raw.toString("latin1"));
    }

    streamPattern.lastIndex = end;
  }

  return streams;
}

/** Reads the text-showing operators out of one content stream. */
function textFromStream(stream: string): string {
  const pieces: string[] = [];

  // Literal (…) and hex <…> strings followed by a show operator, plus TJ arrays.
  const pattern = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|\bTJ\b|\bTj\b|\bTD\b|\bTd\b|\bT\*\b|\bET\b|'|"/g;
  let match: RegExpExecArray | null;
  let pending = "";

  while ((match = pattern.exec(stream)) !== null) {
    const token = match[0];

    if (token.startsWith("(")) {
      pending += decodeLiteralString(token.slice(1, -1));
      continue;
    }
    if (token.startsWith("<")) {
      pending += decodeHexString(token.slice(1, -1));
      continue;
    }

    // Positioning and show operators end the current run of text.
    if (token === "Tj" || token === "TJ" || token === "'" || token === '"') {
      if (pending) {
        pieces.push(pending);
        pending = "";
      }
      continue;
    }
    if (token === "TD" || token === "Td" || token === "T*" || token === "ET") {
      if (pending) {
        pieces.push(pending);
        pending = "";
      }
      // A line/paragraph break in the layout.
      pieces.push("\n");
      continue;
    }
  }

  if (pending) pieces.push(pending);

  return pieces
    .join("")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ *\n */g, "\n")
    .trim();
}

/**
 * Whether extracted text is trustworthy enough to parse.
 *
 * A CID-font PDF yields the right *amount* of characters but the wrong ones, so
 * length alone is not enough: we also require a plausible ratio of readable
 * characters. Getting this gate wrong in the permissive direction would mean
 * feeding nonsense into the review form, which is precisely the failure mode the
 * spec forbids.
 */
export function looksLikeUsableText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 40) return false;

  const readable = trimmed.replace(/[^\p{L}\p{N}\s.,;:@/\\()\-+&%'"#°]/gu, "").length;
  const ratio = readable / trimmed.length;
  if (ratio < 0.85) return false;

  // Real invoices contain words, not just symbols and digits.
  const letters = (trimmed.match(/\p{L}/gu) ?? []).length;
  return letters >= 20;
}

export interface PdfTextResult {
  text: string;
  usable: boolean;
  streamCount: number;
}

export function extractPdfText(pdf: Buffer): PdfTextResult {
  let streams: string[] = [];
  try {
    streams = extractContentStreams(pdf);
  } catch {
    return { text: "", usable: false, streamCount: 0 };
  }

  const text = streams
    .map((stream) => textFromStream(stream))
    .filter(Boolean)
    .join("\n")
    .trim();

  return { text, usable: looksLikeUsableText(text), streamCount: streams.length };
}

/**
 * DOCX text extraction. A .docx is a zip; word/document.xml holds the body.
 * Implemented with the same no-dependency approach: locate the entry in the
 * central directory and inflate it.
 */
export function extractDocxText(docx: Buffer): PdfTextResult {
  try {
    const target = "word/document.xml";
    const haystack = docx.toString("latin1");

    // Walk local file headers (PK\x03\x04) looking for word/document.xml.
    let offset = 0;
    while (true) {
      const signature = haystack.indexOf("PK", offset);
      if (signature === -1) break;

      const compressionMethod = docx.readUInt16LE(signature + 8);
      const compressedSize = docx.readUInt32LE(signature + 18);
      const nameLength = docx.readUInt16LE(signature + 26);
      const extraLength = docx.readUInt16LE(signature + 28);
      const nameStart = signature + 30;
      const name = docx.subarray(nameStart, nameStart + nameLength).toString("latin1");
      const dataStart = nameStart + nameLength + extraLength;

      if (name === target && compressedSize > 0) {
        const data = docx.subarray(dataStart, dataStart + compressedSize);
        const xml = (compressionMethod === 0 ? data : inflateRawSync(data)).toString("utf8");

        const text = xml
          // Paragraph and break boundaries become newlines.
          .replace(/<w:p\b[^>]*>/g, "\n")
          .replace(/<w:br\b[^>]*\/?>/g, "\n")
          .replace(/<w:tab\b[^>]*\/?>/g, "\t")
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/[ \t]+/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

        return { text, usable: looksLikeUsableText(text), streamCount: 1 };
      }

      offset = dataStart + compressedSize;
      // Streamed zips report size 0 in the local header; fall back to scanning.
      if (compressedSize === 0) offset = signature + 4;
    }
  } catch {
    // Fall through to the empty result.
  }

  return { text: "", usable: false, streamCount: 0 };
}
