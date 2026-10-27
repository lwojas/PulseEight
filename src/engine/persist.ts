// Saves patterns, the chain and the transport settings to localStorage. Performance state
// (mutes, solos, FX arming, the screen) is deliberately not saved.
import { BASS_TRACK, defaultSound, NUM_TRACKS, TRACKS } from "./spec";
import { MAX_STEPS, NUM_PATTERNS, type AppState, type Pattern } from "./state";
import { getState, observe, setState } from "./store";

const KEY = "pulse8.project.v1";

interface Saved {
  patterns: Pattern[];
  chain: number[];
  chainOn: boolean;
  bpm: number;
  swing: number;
  pattern: number;
}

function valid(p: unknown): p is Pattern {
  const x = p as Pattern;
  return (
    !!x && Array.isArray(x.tracks) && x.tracks.length === NUM_TRACKS && Array.isArray(x.fx) && x.fx.length === MAX_STEPS &&
    typeof x.length === "number" && !!x.mangler &&
    x.tracks.every((t, i) => Array.isArray(t.steps) && t.steps.length === MAX_STEPS && t.sound?.length === TRACKS[i].controls.length)
  );
}

export function loadProject(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as Saved;
    if (!Array.isArray(s.patterns) || s.patterns.length !== NUM_PATTERNS) return;
    // The bass gained a control (ENV MOD): older saves get its default sound, the rest is kept.
    for (const p of s.patterns) {
      const t = p?.tracks?.[BASS_TRACK];
      if (t && Array.isArray(t.sound) && t.sound.length !== TRACKS[BASS_TRACK].controls.length) t.sound = defaultSound(TRACKS[BASS_TRACK]);
    }
    if (!s.patterns.every(valid)) return;
    setState({
      patterns: s.patterns,
      chain: Array.isArray(s.chain) ? s.chain.filter((n) => n >= 0 && n < NUM_PATTERNS) : [],
      chainOn: !!s.chainOn,
      bpm: Number.isFinite(s.bpm) ? s.bpm : 128,
      swing: Number.isFinite(s.swing) ? s.swing : 0.5,
      pattern: s.pattern >= 0 && s.pattern < NUM_PATTERNS ? s.pattern : 0,
    });
  } catch {
    /* unreadable or blocked storage: start from the default project */
  }
}

export function autosave(): void {
  let timer: number | undefined;
  const persisted = (s: AppState) => [s.patterns, s.chain, s.chainOn, s.bpm, s.swing];
  observe((next, prev) => {
    const a = persisted(next);
    const b = persisted(prev);
    if (a.every((v, i) => v === b[i])) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      try {
        const s = getState();
        const saved: Saved = {
          patterns: s.patterns, chain: s.chain, chainOn: s.chainOn, bpm: s.bpm, swing: s.swing, pattern: s.pattern,
        };
        localStorage.setItem(KEY, JSON.stringify(saved));
      } catch {
        /* storage full or blocked: nothing to do */
      }
    }, 500);
  });
}
