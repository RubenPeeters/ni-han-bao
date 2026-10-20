/** A piece of a Discord message, for drawing bot replies in the docs. */
export type Token =
  | { kind: "text"; text: string }
  | { kind: "bold"; children: Token[] }
  | { kind: "channel"; name: string }
  | { kind: "link"; url: string }
  | { kind: "emoji"; name: string };

// The Markdown the bot's replies use: bold, escapes, channel mentions, <links> and custom emoji.
const PIECES = /(\*\*(?:\\.|[^\\])+?\*\*|\\.|<#\d+>|<https?:\/\/[^>\s]+>|<a?:\w+:\d+>)/;

/** `channels` names the channel ids the text mentions; an unknown one is drawn as Discord does. */
export function discordMarkdown(text: string, channels: Record<string, string> = {}): Token[] {
  return text
    .split(PIECES)
    .filter(Boolean)
    .map((piece): Token => {
      if (piece.startsWith("**") && piece.length > 4) return { kind: "bold", children: discordMarkdown(piece.slice(2, -2), channels) };
      if (piece.length === 2 && piece[0] === "\\") return { kind: "text", text: piece[1] };
      if (piece.startsWith("<#")) return { kind: "channel", name: channels[piece.slice(2, -1)] ?? "unknown" };
      if (piece.startsWith("<http")) return { kind: "link", url: piece.slice(1, -1) };
      if (/^<a?:/.test(piece)) return { kind: "emoji", name: piece.split(":")[1] };
      return { kind: "text", text: piece };
    });
}
