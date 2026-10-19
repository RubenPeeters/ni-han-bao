/** A server card's line on the logged-in home: the server's week, then the visitor's rank. */
export function serverSummary(weekMessages: number, rank: number | null): string {
  const week = `${weekMessages.toLocaleString("en-US")} ${weekMessages === 1 ? "message" : "messages"} this week`;
  return `${week} · ${rank ? `you are #${rank} all time` : "no messages from you yet"}`;
}
