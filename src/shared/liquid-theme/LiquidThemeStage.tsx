import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { computeLiquidClipPath } from "./liquidPath";
import { sharedLiquidSound } from "./liquidAudio";
import {
  DEFAULT_SOUND_STORAGE_KEY,
  loadPersistedSoundPrefs,
  prefersReducedMotion,
  savePersistedSoundPrefs,
  supportsSvgClipPath,
} from "./themePersistence";
import type {
  LiquidDirection,
  LiquidOrigin,
  LiquidThemeContextValue,
  LiquidThemeMode,
  LiquidThemeStageProps,
} from "./types";

const LiquidThemeContext = createContext<LiquidThemeContextValue | null>(null);

export function useLiquidTheme(): LiquidThemeContextValue {
  const ctx = useContext(LiquidThemeContext);
  if (!ctx) {
    throw new Error("useLiquidTheme must be used inside <LiquidThemeStage>");
  }
  return ctx;
}

function getOriginFromTrigger(
  trigger?: MouseEvent<HTMLElement> | HTMLElement | null
): LiquidOrigin {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const fallback: LiquidOrigin = { x: vw - 64, y: 42, width: 32, height: 32 };
  if (!trigger || typeof window === "undefined") return fallback;

  const el =
    "currentTarget" in trigger
      ? (trigger.currentTarget as HTMLElement | null)
      : trigger;
  if (!el || typeof el.getBoundingClientRect !== "function") return fallback;

  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return fallback;
  return {
    x: rect.left + rect.width / 2,
    y: rect.bottom - 2,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Reusable Dual-Layer Liquid Theme Reveal Stage:
 * - Renders base layer (current theme) and temporary SVG-clipped reveal layer (target theme).
 * - Uses a single requestAnimationFrame loop mutating only `<path d="...">` directly (zero per-frame React re-renders).
 * - Syncs scroll positions (both window scroll and inner `[data-liquid-scroll]` containers) and keeps
 *   sticky/fixed elements pixel-aligned while preventing duplicate IDs, focus, or event bindings via `inert`.
 */
export function LiquidThemeStage({
  theme,
  onThemeChange,
  durationMs = 1150,
  soundAdapter = sharedLiquidSound,
  soundEnabled: controlledSoundEnabled,
  onSoundEnabledChange,
  soundVolume: controlledSoundVolume,
  onSoundVolumeChange,
  soundPersistKey = DEFAULT_SOUND_STORAGE_KEY,
  layoutMode = "fixed-app",
  layerClassName = "",
  children,
}: LiquidThemeStageProps) {
  const reactId = useId().replace(/:/g, "");
  const clipId = `szx-liquid-clip-${reactId}`;

  const [persistedSound] = useState(() => loadPersistedSoundPrefs(soundPersistKey));
  const [uncontrolledEnabled, setUncontrolledEnabled] = useState(persistedSound.enabled);
  const [uncontrolledVolume, setUncontrolledVolume] = useState(persistedSound.volume);

  const soundEnabled = controlledSoundEnabled ?? uncontrolledEnabled;
  const soundVolume = controlledSoundVolume ?? uncontrolledVolume;

  const [revealTarget, setRevealTarget] = useState<LiquidThemeMode | null>(null);

  const logicalThemeRef = useRef<LiquidThemeMode>(theme);
  logicalThemeRef.current = theme;

  const baseLayerRef = useRef<HTMLDivElement | null>(null);
  const revealLayerRef = useRef<HTMLDivElement | null>(null);
  const clipPathRef = useRef<SVGPathElement | null>(null);

  const rafRef = useRef<number | null>(null);
  const animStateRef = useRef<{
    active: boolean;
    startTime: number;
    duration: number;
    origin: LiquidOrigin;
    triggerEl: HTMLElement | null;
    vw: number;
    vh: number;
    direction: LiquidDirection;
    targetTheme: LiquidThemeMode;
  } | null>(null);

  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  const soundVolumeRef = useRef(soundVolume);
  soundVolumeRef.current = soundVolume;
  const adapterRef = useRef(soundAdapter);
  adapterRef.current = soundAdapter;

  const setSoundEnabled = useCallback(
    (next: boolean) => {
      if (controlledSoundEnabled === undefined) {
        setUncontrolledEnabled(next);
      }
      onSoundEnabledChange?.(next);
      savePersistedSoundPrefs({ enabled: next, volume: soundVolumeRef.current }, soundPersistKey);
      if (!next) {
        adapterRef.current?.abort();
      }
    },
    [controlledSoundEnabled, onSoundEnabledChange, soundPersistKey]
  );

  const setSoundVolume = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(1, next));
      if (controlledSoundVolume === undefined) {
        setUncontrolledVolume(clamped);
      }
      onSoundVolumeChange?.(clamped);
      savePersistedSoundPrefs({ enabled: soundEnabledRef.current, volume: clamped }, soundPersistKey);
      adapterRef.current?.setVolume?.(clamped);
    },
    [controlledSoundVolume, onSoundVolumeChange, soundPersistKey]
  );

  const cancelAnimation = useCallback((abortSound: boolean) => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    animStateRef.current = null;
    if (abortSound) {
      adapterRef.current?.abort();
    }
  }, []);

  const commitNow = useCallback(
    (nextTheme: LiquidThemeMode, isNaturalComplete: boolean) => {
      const direction: LiquidDirection = nextTheme === "dark" ? "to-dark" : "to-light";
      cancelAnimation(!isNaturalComplete);
      if (isNaturalComplete && soundEnabledRef.current && soundVolumeRef.current > 0.005) {
        adapterRef.current?.complete(direction);
      }
      onThemeChange(nextTheme);
      setRevealTarget(null);
    },
    [cancelAnimation, onThemeChange]
  );

  // Sync scroll containers & window scroll into the reveal overlay
  const syncScrollPositions = useCallback(() => {
    const base = baseLayerRef.current;
    const rev = revealLayerRef.current;
    if (!base || !rev) return;

    if (layoutMode === "document") {
      rev.scrollTop = window.scrollY;
      rev.scrollLeft = window.scrollX;
    } else {
      rev.scrollTop = base.scrollTop;
      rev.scrollLeft = base.scrollLeft;
    }

    const baseScrolls = base.querySelectorAll<HTMLElement>("[data-liquid-scroll]");
    const revScrolls = rev.querySelectorAll<HTMLElement>("[data-liquid-scroll]");
    const count = Math.min(baseScrolls.length, revScrolls.length);
    for (let i = 0; i < count; i++) {
      revScrolls[i].scrollTop = baseScrolls[i].scrollTop;
      revScrolls[i].scrollLeft = baseScrolls[i].scrollLeft;
    }
  }, [layoutMode]);

  // Mark reveal layer inert + sync dimensions/scroll immediately on mount
  useLayoutEffect(() => {
    const rev = revealLayerRef.current;
    if (!revealTarget || !rev) return;

    (rev as HTMLElement & { inert: boolean }).inert = true;
    if (layoutMode === "document") {
      rev.style.width = `${document.documentElement.clientWidth}px`;
      rev.style.height = `${document.documentElement.clientHeight}px`;
    }
    syncScrollPositions();
  }, [layoutMode, revealTarget, syncScrollPositions]);

  // Keep viewport, button origin, scroll, and visibility synchronized during animation
  useEffect(() => {
    if (!revealTarget) return;

    const handleResize = () => {
      const st = animStateRef.current;
      if (!st) return;
      st.vw = document.documentElement.clientWidth || window.innerWidth;
      st.vh = document.documentElement.clientHeight || window.innerHeight;
      if (st.triggerEl && st.triggerEl.isConnected) {
        st.origin = getOriginFromTrigger(st.triggerEl);
      }
      const rev = revealLayerRef.current;
      if (rev && layoutMode === "document") {
        rev.style.width = `${st.vw}px`;
        rev.style.height = `${st.vh}px`;
      }
    };

    const handleScroll = () => {
      syncScrollPositions();
      const st = animStateRef.current;
      if (st && st.triggerEl && st.triggerEl.isConnected) {
        st.origin = getOriginFromTrigger(st.triggerEl);
      }
    };

    const handleVisibility = () => {
      if (document.hidden && animStateRef.current) {
        commitNow(animStateRef.current.targetTheme, false);
      }
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, { passive: true, capture: true });
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [commitNow, layoutMode, revealTarget, syncScrollPositions]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimation(true);
    };
  }, [cancelAnimation]);

  const setThemeAnimated = useCallback(
    (nextTheme: LiquidThemeMode, trigger?: MouseEvent<HTMLElement> | HTMLElement | null) => {
      const prevTheme = logicalThemeRef.current;
      if (nextTheme === prevTheme && !animStateRef.current) return;

      const direction: LiquidDirection = nextTheme === "dark" ? "to-dark" : "to-light";

      // Interruption handling: if already animating, abort old stream without chime and commit previous target
      if (animStateRef.current) {
        const interruptedTarget = animStateRef.current.targetTheme;
        cancelAnimation(true);
        if (interruptedTarget !== nextTheme) {
          onThemeChange(interruptedTarget);
          logicalThemeRef.current = interruptedTarget;
        }
      }

      // Reduced motion or unsupported clipPath fallback
      if (prefersReducedMotion() || !supportsSvgClipPath()) {
        if (soundEnabledRef.current && soundVolumeRef.current > 0.005) {
          adapterRef.current?.playReducedCue?.(direction, soundVolumeRef.current);
        }
        onThemeChange(nextTheme);
        setRevealTarget(null);
        return;
      }

      const triggerEl =
        trigger && "currentTarget" in trigger
          ? (trigger.currentTarget as HTMLElement | null)
          : trigger ?? null;
      const origin = getOriginFromTrigger(trigger);
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const vh = document.documentElement.clientHeight || window.innerHeight;

      // Seed initial 0% frame immediately before mounting reveal layer so there is zero 1-frame flash
      const initialFrame = computeLiquidClipPath({ progress: 0, vw, vh, origin });
      clipPathRef.current?.setAttribute("d", initialFrame.pathD);

      if (soundEnabledRef.current && soundVolumeRef.current > 0.005) {
        adapterRef.current?.start(direction, soundVolumeRef.current);
      }

      const state = {
        active: true,
        startTime: performance.now(),
        duration: Math.max(300, durationMs),
        origin,
        triggerEl,
        vw,
        vh,
        direction,
        targetTheme: nextTheme,
      };
      animStateRef.current = state;
      setRevealTarget(nextTheme);

      const step = (now: number) => {
        const current = animStateRef.current;
        if (!current || !current.active) return;

        const elapsed = now - current.startTime;
        const progress = Math.min(1, Math.max(0, elapsed / current.duration));
        const frame = computeLiquidClipPath({
          progress,
          vw: current.vw,
          vh: current.vh,
          origin: current.origin,
        });

        clipPathRef.current?.setAttribute("d", frame.pathD);

        if (soundEnabledRef.current && soundVolumeRef.current > 0.005) {
          adapterRef.current?.onProgress(progress, frame.stage, current.direction);
        }

        if (progress < 1) {
          rafRef.current = requestAnimationFrame(step);
        } else {
          rafRef.current = null;
          animStateRef.current = null;
          commitNow(current.targetTheme, true);
        }
      };

      rafRef.current = requestAnimationFrame(step);
    },
    [cancelAnimation, commitNow, durationMs, onThemeChange]
  );

  const toggleTheme = useCallback(
    (trigger?: MouseEvent<HTMLElement> | HTMLElement | null) => {
      const current = animStateRef.current?.targetTheme ?? logicalThemeRef.current;
      const next: LiquidThemeMode = current === "dark" ? "light" : "dark";
      setThemeAnimated(next, trigger);
    },
    [setThemeAnimated]
  );

  const previewSound = useCallback(
    (dir?: LiquidDirection) => {
      const d = dir ?? (logicalThemeRef.current === "dark" ? "to-light" : "to-dark");
      adapterRef.current?.preview?.(d, Math.max(0.15, soundVolumeRef.current));
    },
    []
  );

  const baseCtx = useMemo<LiquidThemeContextValue>(
    () => ({
      theme,
      isTransitioning: revealTarget !== null,
      isRevealLayer: false,
      direction: theme === "dark" ? "to-light" : "to-dark",
      soundEnabled,
      soundVolume,
      toggleTheme,
      setThemeAnimated,
      setSoundEnabled,
      setSoundVolume,
      previewSound,
    }),
    [
      previewSound,
      revealTarget,
      setSoundEnabled,
      setSoundVolume,
      setThemeAnimated,
      soundEnabled,
      soundVolume,
      theme,
      toggleTheme,
    ]
  );

  const revealCtx = useMemo<LiquidThemeContextValue>(
    () => ({
      ...baseCtx,
      theme: revealTarget ?? theme,
      isRevealLayer: true,
    }),
    [baseCtx, revealTarget, theme]
  );

  const layerStyle: React.CSSProperties =
    layoutMode === "document"
      ? { width: "100%", minHeight: "100%" }
      : { width: "100%", height: "100%", overflow: "hidden" };

  return (
    <LiquidThemeContext.Provider value={baseCtx}>
      {/* Dynamic SVG clipPath updated imperatively in single rAF loop */}
      <svg
        aria-hidden="true"
        width="0"
        height="0"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          pointerEvents: "none",
          zIndex: -1,
        }}
      >
        <defs>
          <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
            <path ref={clipPathRef} d="" />
          </clipPath>
        </defs>
      </svg>

      {/* Base Theme Layer */}
      <div
        ref={baseLayerRef}
        data-theme={theme}
        className={`szx-lt-layer szx-lt-base ${layerClassName}`}
        style={layerStyle}
      >
        {children(baseCtx)}
      </div>

      {/* Clipped Reveal Theme Overlay (mounted only while liquid flows) */}
      {revealTarget && (
        <LiquidThemeContext.Provider value={revealCtx}>
          <div
            ref={revealLayerRef}
            data-theme={revealTarget}
            aria-hidden="true"
            className={`szx-lt-layer szx-lt-reveal ${layerClassName}`}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: "100vw",
              height: "100vh",
              overflow: layoutMode === "document" ? "auto" : "hidden",
              scrollbarWidth: "none",
              pointerEvents: "none",
              userSelect: "none",
              zIndex: 9999,
              clipPath: `url(#${clipId})`,
              WebkitClipPath: `url(#${clipId})`,
              willChange: "clip-path",
            }}
          >
            {children(revealCtx)}
          </div>
        </LiquidThemeContext.Provider>
      )}
    </LiquidThemeContext.Provider>
  );
}
