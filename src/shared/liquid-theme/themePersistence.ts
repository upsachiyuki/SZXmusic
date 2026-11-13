import type { LiquidThemeMode } from "./types";

export const DEFAULT_THEME_STORAGE_KEY = "szxmusic-theme";
export const DEFAULT_SOUND_STORAGE_KEY = "szxmusic-liquid-sound";

export interface PersistedSoundPrefs {
  enabled: boolean;
  volume: number;
}

export function loadPersistedTheme(
  key = DEFAULT_THEME_STORAGE_KEY,
  fallback: LiquidThemeMode = "dark"
): LiquidThemeMode {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === "light" || raw === "dark") return raw;
  } catch {
    // ignore storage access restrictions
  }
  return fallback;
}

export function savePersistedTheme(
  theme: LiquidThemeMode,
  key = DEFAULT_THEME_STORAGE_KEY
): void {
  try {
    window.localStorage.setItem(key, theme);
  } catch {
    // ignore
  }
}

export function loadPersistedSoundPrefs(
  key = DEFAULT_SOUND_STORAGE_KEY
): PersistedSoundPrefs {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedSoundPrefs>;
      return {
        enabled: Boolean(parsed.enabled ?? false),
        volume:
          typeof parsed.volume === "number" && Number.isFinite(parsed.volume)
            ? Math.max(0, Math.min(1, parsed.volume))
            : 0.45,
      };
    }
  } catch {
    // ignore
  }
  return { enabled: false, volume: 0.45 };
}

export function savePersistedSoundPrefs(
  prefs: PersistedSoundPrefs,
  key = DEFAULT_SOUND_STORAGE_KEY
): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function supportsSvgClipPath(): boolean {
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") {
    return typeof SVGClipPathElement !== "undefined";
  }
  return (
    CSS.supports("clip-path", "url(#test)") ||
    CSS.supports("-webkit-clip-path", "url(#test)")
  );
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
