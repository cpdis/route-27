import { formatLocalTime } from "../lib/format";
import type { LeaveCue as Cue } from "../lib/leave";

function WalkIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="13" cy="4" r="1.6" /><path d="M10 21l2-6 3 3v3M8 12l2-4 3 1 2 3 2 1M12 15l-1-5" />
    </svg>
  );
}

/** Sits under the hero countdown: when to leave home for this bus, given the walk to the stop. */
export default function LeaveCue({ cue, walkMinutes }: { cue: Cue | null; walkMinutes: number }) {
  if (!cue) return null;
  const walk = `${walkMinutes} min walk`;
  let main: string;
  let sub: string;
  let urgent = false;
  if (cue.kind === "leave-in") {
    main = `Leave in ${cue.minutes} min`;
    sub = `by ${formatLocalTime.format(new Date(cue.leaveBy))} · ${walk}`;
  } else if (cue.kind === "leave-now") {
    main = "Leave now";
    sub = walk;
    urgent = true;
  } else {
    main = "Too tight on foot";
    sub = cue.next && cue.minutes != null
      ? `For the ${formatLocalTime.format(new Date(cue.next.expected))}, leave in ${cue.minutes} min`
      : walk;
  }
  return (
    <div className={"leave" + (urgent ? " is-urgent" : "") + (cue.kind === "too-tight" ? " is-missed" : "")} role="status">
      <WalkIcon />
      <strong>{main}</strong>
      <span className="leave-sub">{sub}</span>
    </div>
  );
}
