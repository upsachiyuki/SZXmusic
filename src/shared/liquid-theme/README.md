# Liquid Theme Reveal Module (`@shared/liquid-theme`)

Reusable SVG `<clipPath>` Liquid Theme Reveal transition + Web Audio API synchronized sound synthesis for React + TypeScript applications.

## Features

- **Real Liquid Kinematics (`liquidPath.ts`)**:
  - Slender swaying column pours directly from the clicked toggle button bottom edge with width variation and necking.
  - Detached falling droplets travel ahead of/alongside the column.
  - Bottom impact triggers a symmetric splash crown, ballistic droplets, and damped local ripples around the impact X axis.
  - Pool rises monotonically with a multi-harmonic fluid wave surface covering `100%` of the viewport (`light <-> dark`).
- **Single `requestAnimationFrame` Loop (`LiquidThemeStage.tsx`)**:
  - Mutates only `<path ref={clipPathRef} d="..." />` per frame inside a `clipPathUnits="userSpaceOnUse"` `<clipPath>` (no per-frame React component re-renders or DOM layout thrashing).
  - Seeds `progress = 0` synchronously before mounting the reveal overlay so there is zero 1-frame flash.
- **Alignment, Focus & State Safety**:
  - Reveal layer uses `inert`, `aria-hidden="true"`, `pointer-events: none`, and `user-select: none`.
  - Synchronizes `window` scroll, inner `[data-liquid-scroll]` containers, `resize`, `sticky` headers, and `fixed` dock bars across both layers.
  - Handles rapid repeat clicks (cleanly interrupts prior transition and restarts in new direction without firing a premature completion chime), window `visibilitychange` (tab backgrounding commits cleanly and stops audio), `prefers-reduced-motion: reduce`, and missing SVG `clip-path` support.
- **Synchronized Web Audio API (`liquidAudio.ts`)**:
  - Defaults to **OFF** (`soundEnabled = false`); persists toggle + volume (`0..1`) in `localStorage`.
  - Initializes/resumes a single shared `AudioContext` strictly inside user click handlers (no autoplay).
  - Synthesizes direction-distinct pour onset, bottom impact splash droplets, filtered flowing water rising pitch with actual animation progress, and soft completion chime (`to-dark` warm/deeper vs `to-light` crisp/brighter).
  - Aborts active oscillators/noise sources cleanly on interruption, mute, volume `<= 0.005`, tab hide, or unmount. Never blocks theme switching if Web Audio is unavailable.

## Quick Usage

```tsx
import { useState } from "react";
import { LiquidThemeStage, type LiquidThemeMode } from "@shared/liquid-theme";

export function App() {
  const [theme, setTheme] = useState<LiquidThemeMode>("light");

  return (
    <LiquidThemeStage
      theme={theme}
      onThemeChange={setTheme}
      durationMs={1150}
      layoutMode="document" // or "fixed-app" for full-viewport desktop/dashboard shells
    >
      {(liquid) => (
        <div data-theme={liquid.theme}>
          <button
            type="button"
            tabIndex={liquid.isRevealLayer ? -1 : undefined}
            onClick={(e) => !liquid.isRevealLayer && liquid.toggleTheme(e)}
          >
            Toggle Theme
          </button>
        </div>
      )}
    </LiquidThemeStage>
  );
}
```

## Integrating External / Existing Audio Systems

Implement `LiquidSoundAdapter` (from `@shared/liquid-theme`) and pass it via `<LiquidThemeStage soundAdapter={myAdapter}>`:

```ts
export interface LiquidSoundAdapter {
  start(direction: LiquidDirection, volume: number): void;
  onProgress(progress: number, stage: LiquidRevealStage, direction: LiquidDirection): void;
  complete(direction: LiquidDirection): void;
  abort(): void;
  setVolume?(volume: number): void;
  preview?(direction: LiquidDirection, volume: number): void;
  playReducedCue?(direction: LiquidDirection, volume: number): void;
  dispose(): void;
}
```

Pass `soundAdapter={null}` if you want pure liquid animation without any sound module.

## Dual-Layer Rendering Notes & Scope

- **Native Re-theming**: Both base and reveal layers render live React trees under `[data-theme="light"]` and `[data-theme="dark"]`, so DOM, SVG charts, text colors, and CSS variables transition sharply without blurry image snapshots.
- **Form & Scroll Retention**: Render controlled inputs (`value={state}`) and pass `readOnly={liquid.isRevealLayer}` + `tabIndex={liquid.isRevealLayer ? -1 : undefined}`; add `data-liquid-scroll="name"` to any nested scrollable container so both layers stay scroll-synced. Avoid duplicate static `id` attributes inside `children`.
- **Canvas / WebGL / `<video>` / Shadow DOM**:
  - Static bitmaps are not used. However, imperative `<canvas>`, WebGL contexts, or `<video>` elements inside `children` will instantiate twice during the ~1.15s reveal overlay if mounted unconditionally inside the reveal layer, and custom Canvas/WebGL renderers must read CSS variables or `liquid.theme` explicitly to repaint in the target theme (CSS custom properties do not automatically recolor pixels already drawn onto a 2D/WebGL canvas).
  - Light DOM `<svg>` filter/gradient `id`s (such as `<RefractionFilterDefs />`) should be placed once outside `<LiquidThemeStage>` to keep SVG IDs unique.
  - Web Components with Shadow DOM inherit CSS custom properties across shadow boundaries automatically, though internal `:host([data-theme=...])` styling may need the custom properties passed down.

## FOUC Prevention

Include a blocking inline script inside `<head>` before mounting React:

```html
<script>
  try {
    var t = localStorage.getItem("szxmusic-theme");
    if (t === "light" || t === "dark") {
      document.documentElement.setAttribute("data-theme", t);
    }
  } catch (e) {}
</script>
```

## Running Locally

- Standalone Showcase (`#F1F0ED`, `#141319`, `#060609`, `#F4F2F8`, `#E07A2E`, `#2F6BFF`, `#14A3A8`):
  ```bash
  npm install
  npm run dev
  ```
  Open `http://localhost:1420/demo.html` in a browser (Main SZXmusic UI at `/` and Desktop Widget at `/widget.html`).
- Typecheck & Production Build:
  ```bash
  npm run build
  ```
