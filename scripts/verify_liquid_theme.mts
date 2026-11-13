import assert from "node:assert/strict";
import { computeLiquidClipPath } from "../src/shared/liquid-theme/liquidPath.ts";
import { WebAudioLiquidSound } from "../src/shared/liquid-theme/liquidAudio.ts";
import {
  loadPersistedSoundPrefs,
  loadPersistedTheme,
  prefersReducedMotion,
  savePersistedSoundPrefs,
  savePersistedTheme,
  supportsSvgClipPath,
} from "../src/shared/liquid-theme/themePersistence.ts";

// 1. Geometry & kinematics across stages, desktop & mobile
for (const viewport of [
  { name: "desktop", vw: 1440, vh: 900, origin: { x: 1260, y: 48, width: 64, height: 36 } },
  { name: "mobile", vw: 390, vh: 844, origin: { x: 320, y: 42, width: 58, height: 34 } },
]) {
  const f0 = computeLiquidClipPath({ progress: 0, ...viewport });
  const fPour = computeLiquidClipPath({ progress: 0.14, ...viewport });
  const fImpact = computeLiquidClipPath({ progress: 0.30, ...viewport });
  const fRiseEarly = computeLiquidClipPath({ progress: 0.48, ...viewport });
  const fRiseLate = computeLiquidClipPath({ progress: 0.82, ...viewport });
  const fDone = computeLiquidClipPath({ progress: 1, ...viewport });

  assert.equal(f0.stage, "pouring", `${viewport.name}: p=0 should be pouring`);
  assert.equal(fPour.stage, "pouring", `${viewport.name}: p=0.14 should be pouring`);
  assert.equal(fImpact.stage, "impact", `${viewport.name}: p=0.30 should be impact`);
  assert.equal(fRiseEarly.stage, "rising", `${viewport.name}: p=0.48 should be rising`);
  assert.equal(fRiseLate.stage, "rising", `${viewport.name}: p=0.82 should be rising`);
  assert.equal(fDone.stage, "completing", `${viewport.name}: p=1 should be completing`);

  assert.ok(fPour.streamBottomY > f0.streamBottomY, "stream must fall downward during pouring");
  assert.ok(fRiseLate.waveCenterY < fRiseEarly.waveCenterY, "pool wave must rise upward");
  assert.ok(fDone.waveCenterY < 0, "at p=1 wave must clear viewport top (y < 0)");
  assert.ok(fPour.pathD.includes("a"), "pouring path should include falling droplets");
  assert.ok(fImpact.pathD.includes("a"), "impact path should include splash droplets");
  assert.ok(!fPour.pathD.includes("NaN") && !fDone.pathD.includes("NaN"), "pathD must be finite");
}

// Clamping edge cases
const fEdge = computeLiquidClipPath({
  progress: 0.5,
  vw: 320,
  vh: 568,
  origin: { x: -40, y: 9999, width: 20, height: 20 },
});
assert.ok(!fEdge.pathD.includes("NaN"), "out-of-bounds origin must clamp without NaN");

// Verify consistent clockwise winding flags (droplets use sweep-flag=1, column starts to the right of wave impact center)
const fImpactWinding = computeLiquidClipPath({
  progress: 0.3,
  vw: 1280,
  vh: 840,
  origin: { x: 1140, y: 50, width: 64, height: 36 },
});
assert.ok(fImpactWinding.pathD.includes("a") && !fImpactWinding.pathD.includes(" 0 1,0 "), "droplet arcs must use clockwise sweep-flag=1");

// Environment fallbacks: prefersReducedMotion + supportsSvgClipPath
(globalThis as unknown as { window: Record<string, unknown> }).window = {
  matchMedia: (q: string) => ({ matches: q.includes("reduced-motion") }),
};
assert.equal(prefersReducedMotion(), true);
assert.equal(typeof supportsSvgClipPath(), "boolean");

// 2. Theme & Sound persistence (default OFF, storage round-trip, malformed recovery)
const mem = new Map<string, string>();
(globalThis as unknown as { window: Record<string, unknown> }).window = {
  localStorage: {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => mem.set(k, v),
  },
};

assert.deepEqual(loadPersistedSoundPrefs("test-sound"), { enabled: false, volume: 0.45 });
mem.set("test-sound", "{bad json");
assert.deepEqual(loadPersistedSoundPrefs("test-sound"), { enabled: false, volume: 0.45 });

savePersistedSoundPrefs({ enabled: true, volume: 1.8 }, "test-sound");
assert.deepEqual(loadPersistedSoundPrefs("test-sound"), { enabled: true, volume: 1 });

savePersistedSoundPrefs({ enabled: false, volume: -0.4 }, "test-sound");
assert.deepEqual(loadPersistedSoundPrefs("test-sound"), { enabled: false, volume: 0 });

assert.equal(loadPersistedTheme("test-theme", "light"), "light");
mem.set("test-theme", "sepia");
assert.equal(loadPersistedTheme("test-theme", "light"), "light");
savePersistedTheme("dark", "test-theme");
assert.equal(loadPersistedTheme("test-theme", "light"), "dark");

// 3. Web Audio resilience when AudioContext is unavailable or fails
(globalThis as unknown as { window: Record<string, unknown> }).window = {
  AudioContext: class BrokenAudioContext {
    constructor() {
      throw new Error("Audio subsystem disabled");
    }
  },
};
const brokenAudio = new WebAudioLiquidSound();
brokenAudio.start("to-dark", 0.5);
brokenAudio.onProgress(0.3, "impact", "to-dark");
brokenAudio.onProgress(0.6, "rising", "to-dark");
brokenAudio.complete("to-dark");
brokenAudio.abort();
brokenAudio.preview("to-light", 0.5);
brokenAudio.playReducedCue("to-dark", 0.5);
brokenAudio.dispose();

// 4. Web Audio stage sync + clean stop with mock AudioContext
let flowStopCount = 0;
const makeParam = () => ({
  value: 0,
  setValueAtTime() {},
  linearRampToValueAtTime() {},
  exponentialRampToValueAtTime() {},
  setTargetAtTime() {},
  cancelScheduledValues() {},
});
class MockAudioContext {
  sampleRate = 48000;
  currentTime = 1.0;
  state = "running";
  destination = {};
  resume = async () => {};
  close = async () => {};
  createGain = () => ({ gain: makeParam(), connect() {}, disconnect() {} });
  createBiquadFilter = () => ({ type: "bandpass", frequency: makeParam(), Q: makeParam(), connect() {}, disconnect() {} });
  createOscillator = () => ({ type: "sine", frequency: makeParam(), connect() {}, disconnect() {}, start() {}, stop() {} });
  createBuffer = (_ch: number, len: number) => ({ getChannelData: () => new Float32Array(len) });
  createBufferSource = () => ({
    buffer: null,
    loop: false,
    connect() {},
    disconnect() {},
    start() {},
    stop() {
      flowStopCount++;
    },
  });
}
(globalThis as unknown as { window: Record<string, unknown> }).window = {
  AudioContext: MockAudioContext,
};
const okAudio = new WebAudioLiquidSound();
okAudio.start("to-dark", 0.6);
okAudio.onProgress(0.28, "impact", "to-dark");
okAudio.onProgress(0.35, "impact", "to-dark"); // same stage repeated
okAudio.onProgress(0.55, "rising", "to-dark");
okAudio.abort();
assert.ok(flowStopCount >= 1, "abort() must stop active continuous flow sources");
okAudio.dispose();

console.log("liquid_theme_unit_tests: ALL PASSED");
