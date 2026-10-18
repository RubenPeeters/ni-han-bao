import { formatExact, formatRelative } from "@/lib/time";

export function RelativeTime({ date }: { date: Date }) {
  return (
    <time dateTime={date.toISOString()} title={formatExact(date)}>
      {formatRelative(date)}
    </time>
  );
}
