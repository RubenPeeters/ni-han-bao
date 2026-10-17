export type Level = "info" | "warn" | "error" | "fatal";

/** An Error stringifies to {}, so errors are logged as their message (and stack, if any). */
function plain(value: unknown): unknown {
  return value instanceof Error ? { message: value.message, stack: value.stack } : value;
}

/** One line of JSON, so the container log can be grepped and parsed line by line. */
export function formatLog(
  level: Level,
  event: string,
  fields: Record<string, unknown>,
  now: Date,
): string {
  const line: Record<string, unknown> = { time: now.toISOString(), level, event };
  for (const [key, value] of Object.entries(fields)) line[key] = plain(value);
  return JSON.stringify(line);
}

/** Logs to stdout, the only stream `docker logs` needs; `guild` is added to every line. */
export function createLogger(guild: string) {
  return (level: Level, event: string, fields: Record<string, unknown> = {}): void => {
    console.log(formatLog(level, event, { guild, ...fields }, new Date()));
  };
}
