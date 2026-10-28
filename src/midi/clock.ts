// A MIDI clock follower: system real-time messages (Clock, Start, Continue, Stop) and Song Position
// Pointer in; a tempo, a position and transport events out. It is pure: it never reads a clock of its
// own (every message arrives with the time it was received) and knows nothing about the application.
//
// MIDI clock is 24 pulses per quarter note. A step here is a 16th note = 6 pulses, which is also the
// unit of Song Position Pointer.
//
//   Start      the next clock pulse is song position 0
//   Continue   the next clock pulse is the last Song Position Pointer (or where it stopped)
//   Stop       halt; the position is kept for a Continue
//   SPP        move the position; while running, the move takes effect on the next pulse

export const PPQN = 24;
export const PULSES_PER_STEP = 6;

export interface ClockEvents {
  /** The transport starts: song step `step` begins at `time` (seconds, the caller's clock). */
  start(step: number, time: number): void;
  stop(): void;
  /** A 16th-note boundary passed: song step `step` began at `time`. Fired for every step while running. */
  step(step: number, time: number): void;
  /** The tempo changed (quarter notes per minute, already smoothed and rounded to 0.1). */
  tempo(bpm: number): void;
}

export interface ClockFollower {
  /** `status` and data bytes of a system message, received at `time` (seconds). */
  handle(data: ArrayLike<number>, time: number): void;
  readonly running: boolean;
  /** Time of the last pulse, or -Infinity before any. */
  readonly lastPulse: number;
}

const TEMPO_WINDOW = PPQN; // average over one beat
/** A tempo change smaller than this is jitter and is not reported. */
const TEMPO_HYSTERESIS = 0.15;

export function createClockFollower(on: ClockEvents): ClockFollower {
  let running = false;
  /** Waiting for the first pulse after Start/Continue/SPP-while-running. */
  let armed = false;
  /** Song position, in steps, the next pulse belongs to when armed. */
  let position = 0;
  let pulse = 0; // pulses since `position` began
  let lastPulse = -Infinity;
  const times: number[] = [];
  let bpm = 0;

  function reportTempo(time: number) {
    times.push(time);
    if (times.length > TEMPO_WINDOW + 1) times.shift();
    if (times.length <= TEMPO_WINDOW) return;
    const per = (times[times.length - 1] - times[0]) / TEMPO_WINDOW;
    if (!(per > 0)) return;
    const est = 60 / (per * PPQN);
    if (Math.abs(est - bpm) >= TEMPO_HYSTERESIS) {
      bpm = Math.round(est * 10) / 10;
      on.tempo(bpm);
    }
  }

  return {
    get running() { return running; },
    get lastPulse() { return lastPulse; },
    handle(data, time) {
      switch (data[0]) {
        case 0xf8: { // clock
          // a gap this long is not a tempo: start measuring again
          if (times.length && time - times[times.length - 1] > 0.5) times.length = 0;
          lastPulse = time;
          reportTempo(time);
          if (armed) {
            armed = false;
            running = true;
            pulse = 0;
            on.start(position, time);
            on.step(position, time);
            return;
          }
          if (!running) return;
          pulse++;
          if (pulse % PULSES_PER_STEP === 0) on.step(position + pulse / PULSES_PER_STEP, time);
          return;
        }
        case 0xfa: // start
          position = 0;
          armed = true;
          if (running) { running = false; on.stop(); }
          return;
        case 0xfb: // continue
          if (!running) armed = true;
          return;
        case 0xfc: // stop
          if (running) {
            // remember where we were so Continue resumes there
            position += Math.floor(pulse / PULSES_PER_STEP);
            on.stop();
          }
          running = false;
          armed = false;
          return;
        case 0xf2: { // song position pointer
          position = (data[1] & 0x7f) | ((data[2] & 0x7f) << 7);
          if (running) { running = false; armed = true; on.stop(); }
          return;
        }
      }
    },
  };
}
