---
name: Tactile Modern Groovebox
colors:
  surface: '#121316'
  surface-dim: '#121316'
  surface-bright: '#38393c'
  surface-container-lowest: '#0d0e11'
  surface-container-low: '#1b1b1f'
  surface-container: '#1f1f23'
  surface-container-high: '#292a2d'
  surface-container-highest: '#343538'
  on-surface: '#e3e2e6'
  on-surface-variant: '#c5c9ac'
  inverse-surface: '#e3e2e6'
  inverse-on-surface: '#2f3034'
  outline: '#8f9378'
  outline-variant: '#444932'
  surface-tint: '#b0d500'
  primary: '#ffffff'
  on-primary: '#2a3400'
  primary-container: '#caf300'
  on-primary-container: '#596c00'
  inverse-primary: '#536600'
  secondary: '#d3fbff'
  on-secondary: '#00363a'
  secondary-container: '#00eefc'
  on-secondary-container: '#00686f'
  tertiary: '#ffffff'
  on-tertiary: '#630f00'
  tertiary-container: '#ffdad2'
  on-tertiary-container: '#c12600'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#caf300'
  primary-fixed-dim: '#b0d500'
  on-primary-fixed: '#171e00'
  on-primary-fixed-variant: '#3e4c00'
  secondary-fixed: '#7df4ff'
  secondary-fixed-dim: '#00dbe9'
  on-secondary-fixed: '#002022'
  on-secondary-fixed-variant: '#004f54'
  tertiary-fixed: '#ffdad2'
  tertiary-fixed-dim: '#ffb4a3'
  on-tertiary-fixed: '#3d0600'
  on-tertiary-fixed-variant: '#8c1900'
  background: '#121316'
  on-background: '#e3e2e6'
  surface-variant: '#343538'
typography:
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Space Grotesk
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 30px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 24px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Space Grotesk
    fontSize: 16px
    fontWeight: '700'
    lineHeight: 20px
    letterSpacing: 0em
  body-lg:
    fontFamily: Space Grotesk
    fontSize: 15px
    fontWeight: '500'
    lineHeight: 20px
  body-md:
    fontFamily: Space Grotesk
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  body-sm:
    fontFamily: Space Grotesk
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 14px
  label-lg:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.04em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.06em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 9px
    fontWeight: '700'
    lineHeight: 12px
    letterSpacing: 0.1em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 0.5rem
  gutter-mobile: 0.375rem
  margin: 0.75rem
  margin-mobile: 0.5rem
  space-xs: 0.25rem
  space-sm: 0.375rem
  space-md: 0.5rem
  space-lg: 0.75rem
  space-xl: 1rem
---

## Brand & Style

This design system channels the immediacy and utilitarian charm of boutique pocket synthesizers into a high-precision, screen-native mobile digital instrument. The visual identity rejects kitsch skeuomorphism (no faux brushed aluminum or simulated Phillips screws) while avoiding sterile minimalism. Instead, it relies on bold, technical graphic design: crisp silkscreen-style typographic markings, chunky tactile component footprints, and high-visibility illuminated states reminiscent of silicone stage hardware.

Targeted at electronic musicians, beatmakers, and sound designers on the move, the UI prioritizes instantaneous visual feedback, single-glance status recognition, and thumb-anchored stage playability. Surfaces evoke a micro-textured, injection-molded matte chassis with luminous backlit elements that cut through low-light stage or club environments.

## Colors

The palette operates on a three-tier system: a stealth matte substrate, functional chassis neutrals, and high-intensity fluorescent functional tracks.

### Base Chassis Substrates
- **Base Ground (Deep Matte Chassis):** `#121316` – Backing instrument housing.
- **Surface Elevation 1 (Module Bays):** `#18191E` – Sequencer lanes and rotary control clusters.
- **Surface Elevation 2 (Pad Wells & Controls):** `#22242B` – Unlit step trigs, rotary caps, and utility button caps.
- **Border / Silk Mark Neutral:** `#323642` – Dividing channels, track borders, and silk-screened grouping rails.

### Functional Signal Accents
- **Primary / Acid Lime (`#D4FF00`):** Step trigs active state, Acid Bass voice parameters, active sequence playhead index.
- **Secondary / Electric Aqua (`#00F0FF`):** FM Tone synth engine, pitch transposition, and modulation tracks.
- **Tertiary / Punch Hot Coral (`#FF4D26`):** Drum engine, transient punch levels, and kick trigger indicators.
- **Warning / Write Amber (`#FF9900`):** Live record armed (`REC/WRITE`), parameter locks, and destructive utility operations.
- **FX Mangler Magenta (`#FF1E83`):** Beat repeat, stutter, tape delay time, and master saturation bus.

## Typography

Typography establishes an industrial, hardware-silkscreen hierarchy. 

- **Space Grotesk** serves as the voice for brand labels, track names, patch titles, and panel headings. It delivers rigid mechanical geometries without feeling overly digital or flimsy.
- **JetBrains Mono** serves as the tactile telemetry engine. It handles all parameter readouts, step indexes (`01` through `16`), tempo indicators (`128.0 BPM`), and functional utility modes (`WRITE`, `PTN`, `MUTE`, `SOLO`). All numerical readouts use tabular, fixed-width figures to prevent layout shifting during rapid value scrolling.
- All hardware labels (`label-sm`, `label-md`) must be rendered in full uppercase with expanded tracking (`0.06em` to `0.1em`) to replicate industrial equipment stamping.

## Layout & Spacing

The layout is compact and dense, maximizing live performance space while maintaining distinct finger-separation bounds.

### Layout Model
- **Mobile First / Landscape Primary:** While responsive to portrait hand-held layouts, the primary instrument configuration is anchored in landscape or a 2-tier stacked portrait grid.
- **Sequencer Bay:** A persistent 16-step grid arranged as a 4×4 pad block (portrait) or a 2×8 linear strip (landscape).
- **Macro Deck:** A persistent top/side matrix holding 4 parameter knobs, page navigation (`1-16`, `17-32`, `33-48`, `49-64`), and master transport.
- **Micro-Gaps:** Tight gaps between active pads (`0.375rem` / `6px`) prevent mis-hits while ensuring pads maximize screen estate for thumb input.

## Elevation & Depth

Visual hierarchy does not use soft shadows or blurred multi-light sources. Elevation is established strictly through **contrast milling**, **nested container borders**, and **luminescent core emission**.

- **The Recessed Well (Inverted Depth):** Pad bays and parameter zones sit inside `#121316` enclosures surrounded by a crisp `1px` inner rule of `#18191E`.
- **The Physical Cap:** Buttons and knobs sit on `#22242B` with crisp outer micro-borders (`1px solid #323642`). When unlit, they absorb light.
- **Luminescent States (LED Backlight):** Activated triggers and illuminated state switches introduce no diffusion blur onto adjacent keys; instead, they feature an ultra-dense, concentrated internal rim glow (`box-shadow: inset 0 0 0 2px #COLOR, 0 0 12px rgba(COLOR, 0.45)`).
- **Hard Silkscreen Separators:** Control groups are delimited by solid `1px` or `2px` rails in `#2A2D37`, forming neat mechanical sections.

## Shapes

The interface is defined by tight, engineered corner radii (`0.25rem` / `4px` base) that reference injection-molded rubber keycaps and machined plastic modules.

- **Trigger Pads & Buttons:** Uniform `4px` corner radii. Sharp enough to feel geometric and technical, curved just enough to evoke soft silicone touch points.
- **Displays & OLED Windows:** Razor-sharp `2px` inner radius with high-contrast borders.
- **Rotary Dials:** Full circle caps (`9999px`) bounded inside squared control bays with inscribed angular ticks.
- **Pills & Toggles:** Square ends or micro-curved (`4px`) tags only. True capsules are reserved solely for live status indicators.

## Components

### 16-Step Trig Pads
- **Resting:** Solid `#22242B` core with a 1px border of `#323642`. Numbered `01` through `16` in `label-sm` JetBrains Mono (`#6C7284`).
- **Active / Triggered:** High-saturation background fill matching the track engine color (`#D4FF00` Bass, `#00F0FF` FM, `#FF4D26` Drums), typography inverted to `#121316` black.
- **Playhead Sweep:** A top 3px horizontal bar flash that rides across the steps in bright `#FFFFFF` without overriding the step's underlying trigger state.
- **Parameter Lock (Plock):** Dual-state visual featuring track accent border with a blinking center dot.

### Rotary Macro Knobs
- **Visual Anatomy:** Circular dark caps (`#18191E`) set within a square frame.
- **Value Indicator:** An outer arc ring that fills clockwise from 7 o'clock to 5 o'clock in the voice accent color, paired with a solid mechanical notch cutting inward from the rim.
- **Value Readout:** JetBrains Mono metric placed directly under the dial center (e.g., `CUTOFF: 2.4kHz`).

### Page Selectors (Bar Select)
- Divided 4-segment segmented strip: `[ 1-16 ] [ 17-32 ] [ 33-48 ] [ 49-64 ]`.
- Active bar is rendered in high-contrast solid white or accent tint with high-contrast dark text.
- Cue bar (queued for next cycle) blinks at 4Hz until the bar flips.

### Mode Toggles (REC / WRITE / PLAY / MUTE)
- Hard graphic switches. `WRITE` glows solid warning amber (`#FF9900`) when recording is active.
- `PLAY` locks in bright `#00F0FF` or `#D4FF00`.
- Buttons feature a 2px recessed state shift when pressed.

### Transport Bar & OLED Mini-Display
- Top-anchored mini dashboard mimicking a crisp 2-color monochrome OLED screen.
- Deep `#0B0C0E` background with `#00F0FF` or `#D4FF00` technical metrics: BPM, Master Swing %, Current Pattern, CPU/Battery bar.