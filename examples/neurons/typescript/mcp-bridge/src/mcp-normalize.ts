import type { McpCallResult } from './mcp-client.js';

/**
 * Collapse an MCP tool result into clean, addressable data. Ported verbatim
 * from the desktop tester's `mcp-normalize.ts` (HOL-1308).
 *
 * MCP tools return their payload as a `content` array of typed blocks; text
 * tools put a JSON document *re-encoded as a string* in `content[0].text`.
 * Stored raw that's backslash soup and un-addressable by dot-path. This unwraps
 * one layer of string-encoding, and only when the string is actually a JSON
 * object/array:
 *
 *   1. `structuredContent` (MCP 2025-06-18) → use verbatim.
 *   2. Else if every block is text → JSON-parse each when it parses; one block
 *      collapses to its value, multiple to an array.
 *   3. Else (image/audio/resource/mixed) → return raw `content` untouched.
 *
 * Defensive, not a scrub: non-JSON text is preserved verbatim (an
 * `Error: not found` message on an `isError` result, a plain-text file), so
 * failures and prose stay intact.
 */
export function normalizeMcpContent(result: McpCallResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;

  const content = result.content;
  if (!Array.isArray(content)) return content ?? null;

  const texts: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      texts.push((block as { text: string }).text);
    } else {
      return content;
    }
  }
  if (texts.length === 0) return content;

  const parsed = texts.map(maybeParseJson);
  return parsed.length === 1 ? parsed[0] : parsed;
}

function maybeParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) return text;
  const first = trimmed[0];
  if (first !== '{' && first !== '[') return text;
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}
