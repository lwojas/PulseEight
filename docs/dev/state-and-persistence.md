# State & persistence

## The model

```
AppState
├─ project (persisted)
│  ├─ projectName, bpm, swing, pattern (current), chain[], chainOn
│  ├─ scale: { root, scale, preset }
│  ├─ arp[8]: ArpSettings per track
│  └─ patterns[64]: Pattern
│       ├─ length (16 | 32 | 48 | 64)
│       ├─ tracks[8]: TrackPattern
│       │    ├─ steps[64]: { on, note, acc, slide, gate? }
│       │    ├─ sound[]   normalised 0..1, one per control in spec.ts
│       │    ├─ level, oct, preset (name of last loaded preset; cosmetic)
│       │    ├─ last?: 1-based last step (absent = pattern length); the track loops there, see timing
│       │    ├─ dly: { send, mode, time, div }
│       │    └─ rev: { send, size }
│       ├─ fxLanes[3]  one recorded punch-in take each (FX_LANES):
│       │    ├─ fx[64]     punch id per step (0 = none)
│       │    └─ fxLvl[64]  sweep level 0..1 at the start of each step
│       └─ mangler: { sweep, param[] }   sweep-in time and character knob per punch
└─ performance (not persisted)
   mutes, solos, focus, page, selStep, follow, tab, seqView, write, erase, punch, punchSel,
   chainEdit, copyArm, audio, playing, playPattern, chainPos, cue, fxPlay, keyHighlight, storageBlocked
```

All 64 patterns always exist in memory (`NUM_PATTERNS`). Every pattern holds 64 steps for every track regardless of
`length`: lengthening a pattern reveals data rather than allocating it.

### Immutability

State is never mutated. `setState` shallow-merges a patch; `editPattern(edit, index?)` clones one pattern with
`structuredClone`, applies the edit and replaces it in a copied `patterns` array. Reference equality is the change
signal: `next.patterns !== prev.patterns` is how the controller, persistence and params know to react. Selectors in
`useStore` should return primitives or stable references.

### Observers

`observe((next, prev) => …)` is the non-React subscription. It runs synchronously inside `setState`, before React
listeners. Three subsystems use it: the controller (to sync audio), persistence (to autosave), and params (to report
changes with their origin). Keep observer work cheap and idempotent: it runs on every change.

### Origins

`source.ts` keeps an ambient tag for the duration of one synchronous write. Anything not wrapped in
`withSource(...)` is `ui`. The scheduler's own pattern, chain and page moves are `internal`. See [MIDI](midi.md#echo).

## Normalised controls

`TrackPattern.sound[i]` is 0..1. `spec.ts` converts it to engine units through `normToUnits`, which handles linear and
exponential tapers and stepped controls (`steps`). Saving normalised values means a range can be retuned, or a preset
re-authored, without invalidating any project.

Presets are authored in engine units (`{ tune: 50 }`, readable in a diff) and converted at load by `presets.ts`.

## Persistence

`persist.ts` (policy) over `db.ts` (IndexedDB mechanism). Two object stores:

| Store | Holds |
|---|---|
| `current` | A single autosave slot |
| `saves` | Named projects, keyed by id, with `savedAt` |

IndexedDB rather than `localStorage`: 64 patterns are ~1.7 MB, and `localStorage` is string-only and capped around 5 MB
for the whole origin.

### What is saved

`Saved` = `projectName, patterns, chain, chainOn, bpm, swing, pattern, scale, arp`. `snapshot()` builds it; the autosave
observer compares the same list (`persisted`) by reference to decide whether anything changed. **If you add a persisted
field, add it to all three** (see recipe below).

### Autosave

500 ms debounce after a change, flushed immediately on `visibilitychange → hidden` and `pagehide`. A failed write sets
`storageBlocked`, which the UI surfaces. The initial restore (`loadProject`) runs before the first render and before
autosave starts, so it cannot be overwritten by defaults.

### In a plugin host

Inside the VST3 build the autosave slot is replaced by the DAW session (`restoreFromHost`, `toHostSnapshot`, publishing from
`autosave`). The rules, and why, are in [VST3 build](vst.md#project-recovery-closing-and-reopening-the-window).

### Export and import

A JSON file `{ app, version: 1, name, project }` named `<name>.pulse8.json`. Untouched patterns serialise as `null`
(`sparse`) because 64 full patterns are large; import fills them with fresh ones.

### Validation and migration

Every load path (autosave, named save, import) goes through `parseProject`:

1. Bounds-check the container (1–64 patterns) and pad short arrays with fresh patterns (older saves held 16).
2. Per-pattern fix-ups (`migrate`): the old single FX send became delay and reverb sends; punches gained per-FX
   parameters; a written punch gained a sweep level (`fxLvl`); the single `fx`/`fxLvl` lane became `fxLanes`, the old lane
   becoming lane 1.
3. Track-specific fix-ups (the bass gained ENV MOD: a pattern whose sound array is the wrong length gets that track's
   default sound).
4. `valid()` — structural checks: every track present, 64 steps, the right number of controls, lane lengths.
   A project failing validation is rejected whole; it is never partially loaded.
5. Scalars are clamped or defaulted; `scale` and `arp` pass through their own `normalize*`.

**The rule for changing the shape of saved data:** old projects must keep loading. Add a step in `migrate` /
`parseProject`, never raise `valid()` without a migration that satisfies it, and add a test.

### Blocked storage

Private windows and blocked site data make IndexedDB throw. The app stays fully usable; `storageBlocked` drives the SAVE
warning, and export remains the way out.

### Other storage

`localStorage` holds two per-browser conveniences: `pulse8.keyHighlight` and `pulse8.midi` (enabled, ports, follow
clock). Every access is wrapped in try/catch.
