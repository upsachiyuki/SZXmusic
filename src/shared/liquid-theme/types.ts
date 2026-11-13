import type { MouseEvent, ReactNode } from "react";

export type LiquidThemeMode = "light" | "dark";
export type LiquidDirection = "to-dark" | "to-light";
export type LiquidRevealStage = "idle" | "pouring" | "impact" | "rising" | "completing";

export interface LiquidOrigin {
  /** Horizontal center of the button relative to viewport */
  x: number;
  /** Bottom edge (or nozzle point) of the button relative to viewport */
  y: number;
  width: number;
  height: number;
}

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

export interface LiquidThemeContextValue {
  theme: LiquidThemeMode;
  isTransitioning: boolean;
  /** True only when rendering inside the temporary clipped reveal overlay */
  isRevealLayer: boolean;
  direction: LiquidDirection;
  soundEnabled: boolean;
  soundVolume: number;
  toggleTheme: (trigger?: MouseEvent<HTMLElement> | HTMLElement | null) => void;
  setThemeAnimated: (
    next: LiquidThemeMode,
    trigger?: MouseEvent<HTMLElement> | HTMLElement | null
  ) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setSoundVolume: (volume: number) => void;
  previewSound: (direction?: LiquidDirection) => void;
}

export interface LiquidThemeStageProps {
  /** Controlled theme mode */
  theme: LiquidThemeMode;
  /** Called to commit the new theme when transition completes (or immediately on fallback) */
  onThemeChange: (next: LiquidThemeMode) => void;
  /** Animation duration in ms (default 1150) */
  durationMs?: number;
  /** Optional custom sound adapter; defaults to built-in WebAudioLiquidSound */
  soundAdapter?: LiquidSoundAdapter | null;
  /** Initial / controlled sound enabled flag (default false) */
  soundEnabled?: boolean;
  onSoundEnabledChange?: (enabled: boolean) => void;
  /** Initial / controlled volume 0..1 (default 0.45) */
  soundVolume?: number;
  onSoundVolumeChange?: (volume: number) => void;
  /** localStorage key prefix for sound settings */
  soundPersistKey?: string;
  /**
   * "fixed-app": fixed full-viewport shell (like desktop/Tauri window)
   * "document": scrollable document / window-scrolled web page (supports sticky/fixed alignment)
   */
  layoutMode?: "fixed-app" | "document";
  /** Optional wrapper class applied to both base and reveal layers */
  layerClassName?: string;
  children: (ctx: LiquidThemeContextValue) => ReactNode;
}
