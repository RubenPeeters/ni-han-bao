/**
 * Where to send a visitor after login: `next` when it is a path on this site, else the server
 * picker. `next` comes from the query string, so this is what keeps the callback from being an
 * open redirect.
 */
export function nextPath(next: string | null): string {
  if (!next || next.length > 300 || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/s";
  }
  // Parsed the way a browser would (it drops tabs and newlines, reads `\` as `/`), so "/\t/evil"
  // cannot slip through as a path and become "//evil".
  const url = new URL(next, "http://site.invalid");
  if (url.origin !== "http://site.invalid") return "/s";
  // Logging in from the home page still lands on the picker.
  return url.pathname === "/" ? "/s" : next;
}
