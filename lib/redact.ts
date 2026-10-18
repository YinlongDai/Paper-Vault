// Server-side redaction for visitors who may not read private notes.
// The real text never leaves the server; the client gets filler of similar length to show blurred.

const FILLER =
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat ";

/** Filler text roughly as long as `s` (capped), keeping line breaks so the blurred block has a similar shape. */
export function redactText(s: string) {
  const text = String(s ?? "");
  if (!text.trim()) return "";
  const lines = text.slice(0, 1200).split("\n");
  let offset = 0;
  return lines
    .map((line) => {
      const n = line.trim().length;
      let out = "";
      while (out.length < n) {
        out += FILLER.slice(offset % FILLER.length, (offset % FILLER.length) + (n - out.length));
        offset += n;
      }
      return out.trim();
    })
    .join("\n");
}
