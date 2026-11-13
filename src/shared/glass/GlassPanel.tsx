import { useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";

export interface GlassPanelProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  radius?: number;
  dense?: boolean;
  /** Enables mild SVG edge refraction along the rim (L2). */
  refractRim?: boolean;
  /** Temporarily flatten heavy filters while dragging on Windows 10/11. */
  isDragging?: boolean;
}

/**
 * Multi-layer Liquid Glass panel (Medium intensity):
 * L0: Windows Acrylic/Mica blur behind the window (handled by Rust/win-integration)
 * L1: Tinted translucent surface + subtle noise grain
 * L2: Subtle SVG displacement refraction along rim edges
 * L3: 1px top specular highlight + bottom inner shadow + pointer-tracking conic rim
 * L4: Foreground content
 */
export function GlassPanel({
  children,
  className = "",
  style,
  radius = 14,
  dense = false,
  refractRim = true,
  isDragging = false,
}: GlassPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pointer, setPointer] = useState({ x: 50, y: 12, active: false });

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPointer({ x, y, active: true });
  };

  const handleMouseLeave = () => {
    setPointer((prev) => ({ ...prev, active: false }));
  };

  const baseBg = dense ? "var(--glass-bg-dense)" : "var(--glass-bg)";

  return (
    <div
      ref={panelRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={className}
      style={{
        position: "relative",
        borderRadius: radius,
        background: baseBg,
        backdropFilter: isDragging ? "none" : "blur(18px) saturate(135%)",
        WebkitBackdropFilter: isDragging ? "none" : "blur(18px) saturate(135%)",
        border: "1px solid var(--glass-border)",
        boxShadow: [
          "inset 0 1px 0 0 var(--glass-top-edge)",
          "inset 0 -1px 0 0 var(--glass-bottom-edge)",
          "0 18px 46px -14px var(--glass-shadow)",
        ].join(", "),
        overflow: "hidden",
        ...style,
      }}
    >
      {/* L1: subtle surface grain for contrast & tactile paper feel */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          filter: "url(#szx-grain)",
          opacity: 0.7,
          zIndex: 0,
        }}
      />

      {/* L2: subtle rim refraction ring */}
      {refractRim && !isDragging && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: radius,
            pointerEvents: "none",
            border: "10px solid transparent",
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.08), transparent 40%, var(--glass-rim) 100%) border-box",
            WebkitMask:
              "linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)",
            WebkitMaskComposite: "xor",
            maskComposite: "exclude",
            filter: "url(#szx-refract)",
            opacity: 0.72,
            zIndex: 1,
          }}
        />
      )}

      {/* L3: pointer-tracking specular sheen */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: radius,
          pointerEvents: "none",
          background: `radial-gradient(420px circle at ${pointer.x}% ${pointer.y}%, var(--glass-rim), transparent 62%)`,
          opacity: pointer.active ? 0.65 : 0.25,
          transition: "opacity 220ms ease",
          zIndex: 1,
        }}
      />

      {/* L4: Foreground content */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          width: "100%",
          height: "100%",
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </div>
    </div>
  );
}
