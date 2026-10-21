// Feedback to forge's intake (#244), from the bot and from the site's server action: no imports,
// so the site can use it without pulling in discord.js.

export const FEEDBACK_REPO = "RubenPeeters/ni-han-bao";
export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 4000;
export const FEEDBACK_KINDS = [
  { value: "feature", label: "An idea" },
  { value: "bug", label: "A problem" },
] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]["value"];

export interface FeedbackInput {
  kind: string;
  title: string;
  description: string;
  submitter: { name: string; id: string };
  /** Where it was sent from: command, card or deck id, message link, page. Empty values are left out. */
  context: Record<string, string | null | undefined>;
}

export interface FeedbackRequest {
  repo: string;
  kind: FeedbackKind;
  title: string;
  body: string;
  submitter: string;
}

// A context value ends inside a fenced block on one line: no backticks or line breaks to break out of it.
const oneLine = (s: string) => s.replace(/[`\r\n]+/g, " ").trim();

/** The intake's request body, or what the member must fix first. */
export function feedbackRequest(input: FeedbackInput): FeedbackRequest | string {
  const kind = FEEDBACK_KINDS.find((k) => k.value === input.kind)?.value;
  if (!kind) return "Pick whether it is an idea or a problem.";
  const title = oneLine(input.title).slice(0, TITLE_MAX);
  const description = input.description.trim().slice(0, DESCRIPTION_MAX);
  if (!title || !description) return "Give it a title and a description.";
  const lines = Object.entries(input.context)
    .map(([key, value]) => [key, oneLine(value ?? "")])
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${value}`);
  return {
    repo: FEEDBACK_REPO,
    kind,
    title,
    body: lines.length ? `${description}\n\n\`\`\`text\n${lines.join("\n")}\n\`\`\`` : description,
    submitter: `${oneLine(input.submitter.name)} (${input.submitter.id})`,
  };
}

/** The issue link from the intake's answer, or null when it has none we know. */
export function issueUrl(answer: unknown): string | null {
  const a = answer as { url?: unknown; html_url?: unknown; issue_url?: unknown; issue?: { html_url?: unknown; url?: unknown } } | null;
  const url = a?.html_url ?? a?.url ?? a?.issue_url ?? a?.issue?.html_url ?? a?.issue?.url;
  return typeof url === "string" && url.startsWith("https://") ? url : null;
}

/** POSTs the feedback; throws on failure with the status, never the token. */
export async function sendFeedback(forgeUrl: string, token: string, request: FeedbackRequest): Promise<string | null> {
  const res = await fetch(`${forgeUrl.replace(/\/$/, "")}/api/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`forge intake answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return issueUrl(await res.json().catch(() => null));
}

/** What the member reads after sending. */
export const feedbackThanks = (url: string | null) => (url ? `Thanks! It is filed as ${url}` : "Thanks! Your feedback is sent.");
export const FEEDBACK_FAILED = "Could not send your feedback. Please try again later.";
