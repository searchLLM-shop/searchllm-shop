// lib/jsonLoose.js
//
// Parses the FIRST complete JSON object in a model reply, ignoring anything
// before or after it. The small models behind the clarify and intent steps are
// told to reply with JSON only, but now and then add a sentence after it; plain
// JSON.parse then throws ("Unexpected non-whitespace character after JSON"),
// and the clarifying question was silently skipped for that shopper. Strings
// and escapes are respected, so braces inside text don't confuse the scan.

export function parseFirstJsonObject(raw) {
  const text = String(raw ?? "");
  const start = text.indexOf("{");
  if (start < 0) throw new Error("no JSON object in reply");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error("unterminated JSON object in reply");
}
