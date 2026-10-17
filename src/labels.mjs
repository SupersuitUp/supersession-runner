// The `**Label:** value` header a schedule file uses: read every label above the first `## `
// heading, and set one in place (or add it at the end of the header) without touching the rest.
const LABEL = /^\*\*([A-Za-z][A-Za-z ]*):\*\*\s*(.*)$/;

export const labelLine = (label, value) => `**${label}:** ${value}`;

/** { lowercased label: value } for the header. */
export function readLabels(text) {
  const out = {};
  for (const line of String(text).split("\n")) {
    if (/^##\s/.test(line)) break;
    const m = line.match(LABEL);
    if (m) out[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return out;
}

/** The text with one label set: replaced where it is, else added after the header's last label. */
export function setLabel(text, label, value) {
  const lines = String(text).split("\n");
  let cut = lines.findIndex((l) => /^##\s/.test(l));
  if (cut < 0) cut = lines.length;
  let last = -1;
  for (let i = 0; i < cut; i++) {
    const m = lines[i].match(LABEL);
    if (!m) continue;
    last = i;
    if (m[1].trim().toLowerCase() === String(label).toLowerCase()) { lines[i] = labelLine(label, value); return lines.join("\n"); }
  }
  if (last >= 0) lines.splice(last + 1, 0, labelLine(label, value));
  else {
    const h = lines.findIndex((l) => /^#\s/.test(l));
    lines.splice(h >= 0 ? h + 2 : 0, 0, labelLine(label, value));
  }
  return lines.join("\n");
}
