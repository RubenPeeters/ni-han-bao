import { ActivityBuffer, flushActivity, type ActivityWriter } from "./activity.js";
import { flushReactions, ReactionBuffer, type ReactionWriter } from "./reactions.js";
import { flushTimeline, TimelineBuffer, VoiceSessions, type TimelineWriter } from "./timeline.js";

/** Everything counted in one server between flushes, kept apart from every other server. */
export class Server {
  readonly activity = new ActivityBuffer();
  readonly reactions = new ReactionBuffer();
  readonly timeline = new TimelineBuffer();
  readonly voice = new VoiceSessions();

  /** `liveFrom`: the server's backfill boundary (see countsLive in history.ts). */
  constructor(
    readonly id: string,
    readonly liveFrom: string,
  ) {}
}

export type ServerWriter = ActivityWriter & ReactionWriter & TimelineWriter;

/**
 * Flushes every server through the writer for its own guild id, so counts never cross
 * servers. A failing stream is reported and kept for the next flush; the other streams and
 * servers still go out. Returns whether everything was written.
 */
export async function flushServers(
  servers: Iterable<Server>,
  writerFor: (guildId: string) => ServerWriter,
  onError: (guildId: string, stream: string, err: unknown) => void,
  now: Date,
): Promise<boolean> {
  let ok = true;
  for (const server of servers) {
    const writer = writerFor(server.id);
    const failed = (stream: string) => (err: unknown) => {
      ok = false;
      onError(server.id, stream, err);
    };
    await flushActivity(server.activity, writer).catch(failed("activity"));
    await flushReactions(server.reactions, writer).catch(failed("reactions"));
    // Count open voice sessions up to now, so a crash loses at most one flush interval.
    server.timeline.addVoice(server.voice.collect(now));
    await flushTimeline(server.timeline, writer).catch(failed("timeline"));
  }
  return ok;
}
