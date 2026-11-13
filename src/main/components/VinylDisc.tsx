import type { CSSProperties } from "react";

export function toBiliThumb(url: string, w = 240, h = 240): string {
  if (!url) return "";
  if (
    (url.includes("hdslb.com/bfs/") || url.includes("biliimg.com/bfs/")) &&
    !url.includes("@")
  ) {
    return `${url}@${w}w_${h}h_1c.webp`;
  }
  return url;
}

export interface VinylDiscProps {
  size: number;
  labelCoverUrl: string;
  spinning?: boolean;
  /** 33 1/3 RPM = 1.8s per revolution; hover preview = 6s */
  spinDurationSec?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Photoreal CSS vinyl disc:
 * - Micro-grooves via repeating-radial-gradient
 * - Rotating light sheen via conic-gradient
 * - 1:1 circular center label clipped from the video cover
 */
export function VinylDisc({
  size,
  labelCoverUrl,
  spinning = false,
  spinDurationSec = 1.8,
  className = "",
  style,
}: VinylDiscProps) {
  const labelSize = Math.round(size * 0.37);
  const spindleSize = Math.max(7, Math.round(size * 0.048));

  return (
    <div
      className={`szx-vinyl ${spinning ? "is-spinning" : ""} ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        position: "relative",
        background: `
          radial-gradient(circle at center,
            rgba(255,255,255,0.06) 0%,
            transparent 20%,
            rgba(0,0,0,0.6) 21%,
            transparent 22%
          ),
          repeating-radial-gradient(
            circle at center,
            #151413 0px,
            #151413 1.4px,
            #22201e 2.1px,
            #111010 3.2px
          )
        `,
        boxShadow:
          "inset 0 0 0 1px rgba(255,255,255,0.10), 0 14px 32px rgba(0,0,0,0.48)",
        animation: spinning ? `szx-spin ${spinDurationSec}s linear infinite` : undefined,
        ...style,
      }}
    >
      {/* Conic specular groove reflection */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 1,
          borderRadius: "50%",
          background: `conic-gradient(
            from 25deg,
            transparent 0deg,
            rgba(255, 245, 232, 0.14) 24deg,
            transparent 58deg,
            transparent 185deg,
            rgba(217, 119, 87, 0.16) 210deg,
            rgba(255, 245, 232, 0.10) 226deg,
            transparent 255deg,
            transparent 360deg
          )`,
          pointerEvents: "none",
        }}
      />

      {/* Center circular label from video cover */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: labelSize,
          height: labelSize,
          transform: "translate(-50%, -50%)",
          borderRadius: "50%",
          overflow: "hidden",
          border: "2px solid rgba(255,244,232,0.22)",
          boxShadow: "0 0 0 3px #121110",
        }}
      >
        <img
          src={toBiliThumb(labelCoverUrl, 180, 180)}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      </div>

      {/* Center spindle hole */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: spindleSize,
          height: spindleSize,
          transform: "translate(-50%, -50%)",
          borderRadius: "50%",
          background: "#0b0a0a",
          border: "1.5px solid rgba(255,245,232,0.35)",
          boxShadow: "inset 0 1px 2px rgba(0,0,0,0.8)",
        }}
      />
    </div>
  );
}
