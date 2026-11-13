import type { LiquidOrigin, LiquidRevealStage } from "./types";

export interface LiquidPathFrame {
  pathD: string;
  stage: LiquidRevealStage;
  streamBottomY: number;
  waveCenterY: number;
}

export interface LiquidPathParams {
  progress: number;
  vw: number;
  vh: number;
  origin: LiquidOrigin;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeInOutSine(t: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

function f(n: number): string {
  return n.toFixed(1);
}

function circleSubpath(cx: number, cy: number, rx: number, ry: number): string {
  if (rx <= 0.4 || ry <= 0.4) return "";
  return `M${f(cx - rx)},${f(cy)}a${f(rx)},${f(ry)} 0 1,1 ${f(rx * 2)},0a${f(rx)},${f(ry)} 0 1,1 ${f(-rx * 2)},0Z`;
}

/**
 * Computes a single unified SVG path string containing:
 * 1) Slender swaying liquid column pouring from button bottom with thickness variation
 * 2) Separated falling droplets along the column
 * 3) Bottom impact splash crown + ballistic droplets + damped local ripple
 * 4) Rising multi-harmonic fluid wave surface covering the entire viewport at p=1
 */
export function computeLiquidClipPath({
  progress,
  vw,
  vh,
  origin,
}: LiquidPathParams): LiquidPathFrame {
  const p = clamp(progress, 0, 1);
  const w = Math.max(1, vw);
  const h = Math.max(1, vh);

  const nozzleX = clamp(origin.x, 12, w - 12);
  const nozzleY = clamp(origin.y, 0, h - 20);
  const dropSpan = Math.max(40, h - nozzleY);

  // Stage boundaries
  const IMPACT_P = 0.26;
  const POUR_END_P = 0.27;

  let stage: LiquidRevealStage = "pouring";
  if (p >= 0.96) {
    stage = "completing";
  } else if (p >= 0.42) {
    stage = "rising";
  } else if (p >= IMPACT_P) {
    stage = "impact";
  }

  // Rising pool baseline Y (from below viewport bottom to above top edge)
  const riseNorm = clamp((p - 0.23) / 0.77, 0, 1);
  const riseEase = easeInOutSine(Math.pow(riseNorm, 0.94));
  const topClearance = -72;
  const waveBaseY = h + 16 - (h + 16 - topClearance) * riseEase;

  // Wave amplitude envelope: grows quickly after impact, flattens near 1.0
  const poolPresence = clamp((p - 0.23) / 0.14, 0, 1);
  const settleOut = 1 - clamp((p - 0.88) / 0.12, 0, 1);
  const waveAmp = poolPresence * settleOut;

  // Impact ripple strength centered at nozzleX
  const tSinceImpact = Math.max(0, p - IMPACT_P);
  const impactDecay =
    p >= IMPACT_P ? Math.exp(-tSinceImpact * 5.2) * settleOut : 0;

  const waveYAt = (x: number): number => {
    if (p < 0.23) return h + 20;
    const nx = x / w;
    const primary = Math.sin(nx * Math.PI * 2.8 + p * 10.5) * 15 * waveAmp;
    const secondary = Math.sin(nx * Math.PI * 5.7 - p * 14.0 + 1.2) * 6.5 * waveAmp;

    const dx = Math.abs(x - nozzleX);
    const sigma = Math.max(95, w * 0.16);
    const localRipple =
      impactDecay *
      Math.exp(-dx / sigma) *
      Math.cos(dx * 0.055 - tSinceImpact * 26) *
      20;

    return waveBaseY + primary + secondary + localRipple;
  };

  const parts: string[] = [];

  // 1) Rising Wave Pool Path (smooth Catmull-Rom spline converted to cubic Beziers)
  if (p >= 0.23) {
    const samples = 32;
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= samples; i++) {
      const x = -14 + ((w + 28) * i) / samples;
      pts.push({ x, y: waveYAt(x) });
    }

    let wavePath = `M${f(pts[0].x)},${f(pts[0].y)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      wavePath += `C${f(cp1x)},${f(cp1y)} ${f(cp2x)},${f(cp2y)} ${f(p2.x)},${f(p2.y)}`;
    }
    wavePath += `L${f(w + 18)},${f(h + 24)}L-18,${f(h + 24)}Z`;
    parts.push(wavePath);
  }

  // 2) Pouring Liquid Column from Toggle Button
  const pourNorm = clamp(p / POUR_END_P, 0, 1);
  // Slight gravity acceleration curve
  const fallRatio = Math.pow(pourNorm, 1.28);
  const rawTipY = nozzleY + dropSpan * fallRatio;
  const waveCenterY = waveYAt(nozzleX);
  const streamBottomY =
    p < 0.23 ? rawTipY : Math.min(h + 12, waveCenterY + 14);

  // Draw stream until rising wave covers nozzleY
  if (waveCenterY > nozzleY - 6 && streamBottomY > nozzleY + 2) {
    const pinchFade = clamp((waveCenterY - (nozzleY - 6)) / 64, 0, 1);
    const baseHalfW = clamp(origin.width * 0.11, 3.6, 6.2) * (0.35 + 0.65 * pinchFade);
    const streamLen = streamBottomY - nozzleY;
    const steps = 14;

    const leftPts: Array<{ x: number; y: number }> = [];
    const rightPts: Array<{ x: number; y: number }> = [];

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = nozzleY + streamLen * t;
      // Organic sway along vertical length
      const sway =
        (Math.sin(t * 7.2 - p * 22) * 2.8 +
          Math.cos(t * 13.0 + p * 15) * 1.3) *
        Math.sin(t * Math.PI * 0.92);

      // Thickness variation: subtle necking + droplet bulb near tip during initial fall
      const necking = 1 - 0.26 * Math.sin(t * Math.PI);
      const tipBulb =
        p < 0.30 && t > 0.78
          ? 1 + 0.52 * Math.sin(((t - 0.78) / 0.22) * Math.PI)
          : 1;
      // Meniscus flare right where column enters the rising pool
      const poolFillet =
        p >= 0.24 && t > 0.82
          ? 1 + 1.45 * Math.pow((t - 0.82) / 0.18, 2) * pinchFade
          : 1;

      const halfW = baseHalfW * necking * tipBulb * poolFillet;
      const cx = nozzleX + sway;
      leftPts.push({ x: cx - halfW, y });
      rightPts.push({ x: cx + halfW, y });
    }

    // Clockwise (+1) winding matching wavePath & droplets so nonzero clipPath unions seamlessly
    let colPath = `M${f(rightPts[0].x)},${f(rightPts[0].y)}`;
    for (let i = 1; i < rightPts.length; i++) {
      const prev = rightPts[i - 1];
      const curr = rightPts[i];
      const my = (prev.y + curr.y) * 0.5;
      colPath += `Q${f(prev.x)},${f(my)} ${f(curr.x)},${f(curr.y)}`;
    }
    const tipL = leftPts[leftPts.length - 1];
    const tipR = rightPts[rightPts.length - 1];
    colPath += `Q${f((tipL.x + tipR.x) * 0.5)},${f(tipR.y + baseHalfW * 1.3)} ${f(tipL.x)},${f(tipL.y)}`;

    for (let i = leftPts.length - 2; i >= 0; i--) {
      const prev = leftPts[i + 1];
      const curr = leftPts[i];
      const my = (prev.y + curr.y) * 0.5;
      colPath += `Q${f(prev.x)},${f(my)} ${f(curr.x)},${f(curr.y)}`;
    }
    colPath += "Z";
    parts.push(colPath);

    // 3) Detached falling droplets trailing ahead/along the pouring column
    if (p > 0.05 && p < 0.36) {
      const d1y = Math.min(h - 6, rawTipY + 14 + Math.sin(p * 30) * 4);
      const d1x = nozzleX + Math.sin(p * 28) * 3.5;
      const d1r = baseHalfW * 0.88 * (1 - clamp((p - 0.25) / 0.08, 0, 1));
      if (d1y < waveCenterY - 2) {
        parts.push(circleSubpath(d1x, d1y, d1r, d1r * 1.45));
      }

      if (p > 0.11 && p < 0.33) {
        const d2y = nozzleY + streamLen * 0.58;
        const d2x = nozzleX - 8 + Math.cos(p * 24) * 3;
        const d2r = baseHalfW * 0.56;
        if (d2y < waveCenterY - 4) {
          parts.push(circleSubpath(d2x, d2y, d2r, d2r * 1.35));
        }
      }
    }
  }

  // 4) Bottom Impact Splash Droplets (parabolic arcs at IMPACT_P .. 0.54)
  if (p >= IMPACT_P && p <= 0.56) {
    const dt = clamp((p - IMPACT_P) / 0.28, 0, 1);
    const dropletSeeds = [
      { vx: -92, vy: 118, r: 4.8 },
      { vx: -58, vy: 155, r: 3.6 },
      { vx: -28, vy: 132, r: 2.9 },
      { vx: 26, vy: 138, r: 3.2 },
      { vx: 62, vy: 162, r: 3.9 },
      { vx: 96, vy: 112, r: 4.4 },
      { vx: -124, vy: 82, r: 2.6 },
      { vx: 128, vy: 76, r: 2.7 },
    ];
    const gravity = 290;
    const baseImpactY = Math.min(h - 4, waveYAt(nozzleX) + 4);
    const fade = 1 - easeOutQuad(clamp((dt - 0.7) / 0.3, 0, 1));

    for (const d of dropletSeeds) {
      const dx = d.vx * easeOutQuad(dt);
      const dy = -(d.vy * dt - 0.5 * gravity * dt * dt);
      const cx = nozzleX + dx;
      const cy = baseImpactY + dy;
      const radius = d.r * fade;
      if (cx > -10 && cx < w + 10 && cy < waveYAt(cx) + 4 && radius > 0.8) {
        parts.push(circleSubpath(cx, cy, radius, radius * 1.15));
      }
    }
  }

  return {
    pathD: parts.join(" "),
    stage,
    streamBottomY,
    waveCenterY,
  };
}
