import { useState, type MouseEvent, type WheelEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronUp, ChevronDown, Plus, Edit3, Trash2 } from "lucide-react";
import type { CrateItem } from "@shared/mock/catalog";
import { VinylDisc, toBiliThumb } from "./VinylDisc";

export interface VinylCrateProps {
  crates: CrateItem[];
  activeCrateId: string;
  rowOffset?: number;
  glassBlurPx?: number;
  onRowOffsetChange?: (next: number) => void;
  onSelectCrate: (crate: CrateItem) => void;
  onRequestCreateCrate?: () => void;
  onRequestRenameCrate?: (crate: CrateItem) => void;
  onRequestDeleteCrate?: (crate: CrateItem) => void;
  onCrateContextMenu?: (e: MouseEvent<HTMLElement>, crate: CrateItem) => void;
}

const SPRING = { type: "spring" as const, stiffness: 260, damping: 26 };
const VISIBLE_DEPTH = 3; // 3 rows visible front-to-back in each of the 3 columns

export function VinylCrate({
  crates,
  activeCrateId,
  rowOffset: controlledRowOffset,
  glassBlurPx = 8,
  onRowOffsetChange,
  onSelectCrate,
  onRequestCreateCrate,
  onRequestRenameCrate,
  onRequestDeleteCrate,
  onCrateContextMenu,
}: VinylCrateProps) {
  const reducedMotion = useReducedMotion();
  const [uncontrolledOffset, setUncontrolledOffset] = useState(0);
  const rawRowOffset = controlledRowOffset ?? uncontrolledOffset;
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Split filtered/ordered crates across 3 columns (col 0, 1, 2)
  const columns: CrateItem[][] = [[], [], []];
  crates.forEach((crate, index) => {
    columns[index % 3].push(crate);
  });

  const maxRows = Math.max(...columns.map((col) => col.length), 1);
  const maxOffset = Math.max(0, maxRows - 1);
  const rowOffset = Math.max(0, Math.min(rawRowOffset, maxOffset));

  const setRowOffset = (updater: number | ((prev: number) => number)) => {
    const next = typeof updater === "function" ? updater(rowOffset) : updater;
    const clamped = Math.max(0, Math.min(maxOffset, next));
    if (controlledRowOffset === undefined) {
      setUncontrolledOffset(clamped);
    }
    onRowOffsetChange?.(clamped);
  };

  const stepRow = (delta: number) => {
    setRowOffset((prev) => Math.max(0, Math.min(maxOffset, prev + delta)));
  };

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaY) < 6) return;
    stepRow(e.deltaY > 0 ? 1 : -1);
  };

  return (
    <div className="szx-crate-stage" onWheel={handleWheel}>
      {/* Top micro header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
          padding: "0 4px",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="szx-serif" style={{ fontSize: 16, fontWeight: 600 }}>
            唱片箱
          </span>
          <span className="szx-mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>
            {crates.length} 张
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {onRequestCreateCrate && (
            <button
              type="button"
              className="szx-icon-btn szx-mono"
              onClick={onRequestCreateCrate}
              title="新建自定义黑胶唱片箱"
              style={{
                height: 26,
                padding: "0 9px",
                fontSize: 11,
                borderColor: "var(--accent)",
                color: "var(--accent)",
              }}
            >
              <Plus size={12} />
              新建黑胶
            </button>
          )}
          {maxRows > 1 && (
            <>
              <button
                type="button"
                className="szx-icon-btn szx-mono"
                onClick={() => stepRow(-1)}
                disabled={rowOffset <= 0}
                title="向前翻"
                style={{ opacity: rowOffset <= 0 ? 0.4 : 1, padding: "0 8px", height: 26 }}
              >
                <ChevronUp size={14} />
              </button>
              <span className="szx-mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>
                {rowOffset + 1}/{maxRows}
              </span>
              <button
                type="button"
                className="szx-icon-btn szx-mono"
                onClick={() => stepRow(1)}
                disabled={rowOffset >= maxOffset}
                title="向后翻"
                style={{ opacity: rowOffset >= maxOffset ? 0.4 : 1, padding: "0 8px", height: 26 }}
              >
                <ChevronDown size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 3-Column Frosted Glass Crate */}
      <div className="szx-crate-box">
        {crates.length === 0 && (
          <div
            className="szx-mono"
            style={{
              gridColumn: "1 / -1",
              alignSelf: "center",
              justifySelf: "center",
              zIndex: 40,
              padding: "18px 24px",
              borderRadius: 12,
              background: "var(--panel-glass)",
              border: "1px solid var(--glass-border)",
              color: "var(--ink-dim)",
              fontSize: 12,
              textAlign: "center",
            }}
          >
            本地唱片箱未找到匹配项 · 按 Enter 或点击顶部「搜B站」在线搜索
          </div>
        )}
        {columns.map((colItems, colIdx) => (
          <div key={colIdx} className="szx-col-slot">
            {colItems.map((crate, itemIdx) => {
              const depth = itemIdx - rowOffset;
              // Virtualization: keep only visible rows + 1 flipped front ghost
              if (depth < -1 || depth >= VISIBLE_DEPTH) return null;

              const isFlippedPast = depth < 0;
              const isHovered = hoveredId === crate.id;
              const isSelected = activeCrateId === crate.id;

              const yShift = isFlippedPast
                ? 85
                : -depth * 44 - (isHovered ? 8 : 0);
              const scale = isFlippedPast ? 1.04 : 1 - depth * 0.065;
              const rotateX = isFlippedPast ? -58 : depth * 2.5;
              const opacity = isFlippedPast ? 0 : Math.max(0.45, 1 - depth * 0.16);
              const zIndex = isFlippedPast ? 1 : 20 - depth * 4;

              const leadCover = crate.covers[0] ?? "";
              const isCollage = crate.covers.length >= 4;

              return (
                <motion.div
                  key={crate.id}
                  className="szx-sleeve-card"
                  style={{
                    zIndex,
                    pointerEvents: isFlippedPast ? "none" : "auto",
                  }}
                  initial={false}
                  animate={{
                    y: yShift,
                    scale,
                    rotateX,
                    opacity,
                  }}
                  transition={reducedMotion ? { duration: 0.01 } : SPRING}
                  onMouseEnter={() => {
                    if (!isFlippedPast) setHoveredId(crate.id);
                  }}
                  onMouseLeave={() => setHoveredId((curr) => (curr === crate.id ? null : curr))}
                  onClick={() => {
                    if (!isFlippedPast) onSelectCrate(crate);
                  }}
                  onContextMenu={(e) => {
                    if (!isFlippedPast && onCrateContextMenu) {
                      e.preventDefault();
                      e.stopPropagation();
                      onCrateContextMenu(e, crate);
                    }
                  }}
                >
                  {/* Peeking Vinyl Disc behind sleeve */}
                  <motion.div
                    style={{
                      position: "absolute",
                      left: "50%",
                      top: -54,
                      marginLeft: -82,
                      zIndex: 1,
                      pointerEvents: "none",
                      filter: isHovered
                        ? "drop-shadow(0 0 14px var(--accent-glow))"
                        : "none",
                    }}
                    animate={{
                      y: isHovered ? -30 : isSelected ? -14 : 0,
                    }}
                    transition={reducedMotion ? { duration: 0.01 } : SPRING}
                  >
                    <VinylDisc
                      size={164}
                      labelCoverUrl={leadCover}
                      spinning={isHovered}
                      spinDurationSec={5.2}
                    />
                  </motion.div>

                  {/* Video Cover Sleeve (Single Hero Cover or 2x2 Video Cover Collage) */}
                  <div
                    className={`szx-sleeve-face ${isSelected ? "is-active" : ""}`}
                    style={{
                      boxShadow: isHovered
                        ? "0 0 18px var(--accent-glow), 0 16px 32px rgba(0,0,0,0.48)"
                        : undefined,
                    }}
                  >
                    {isCollage ? (
                      <div className="szx-sleeve-collage">
                        {crate.covers.slice(0, 4).map((cov, idx) => (
                          <img
                            key={idx}
                            src={toBiliThumb(cov, 180, 180)}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            referrerPolicy="no-referrer"
                            draggable={false}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                        ))}
                      </div>
                    ) : (
                      <img
                        src={toBiliThumb(leadCover, 300, 300)}
                        alt={crate.title}
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
                    )}

                    {/* Subtle frosted sleeve tag for back rows; front row uses signature on the glass */}
                    {depth > 0 && (
                      <div className="szx-sleeve-caption">
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {crate.title}
                        </span>
                        <span
                          className="szx-mono"
                          style={{
                            fontSize: 10,
                            color: isSelected ? "var(--accent)" : "#d4d1c8",
                            flexShrink: 0,
                          }}
                        >
                          {crate.tracks.length}T
                        </span>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        ))}

        {/* Front translucent frosted glass crate wall + Handwritten Signature Titles */}
        <div
          className="szx-crate-glass-front"
          style={
            {
              "--crate-glass-blur": `${glassBlurPx}px`,
            } as React.CSSProperties
          }
        >
          <div className="szx-crate-dividers">
            <div />
            <div />
            <div />
          </div>

          <div className="szx-crate-signatures">
            {columns.map((colItems, colIdx) => {
              const frontCrate = colItems[rowOffset];
              if (!frontCrate) {
                return <div key={colIdx} className="szx-glass-sig-slot" />;
              }
              const isSelected = activeCrateId === frontCrate.id;
              return (
                <div
                  key={frontCrate.id}
                  className={`szx-glass-sig-slot ${isSelected ? "is-active" : ""}`}
                  style={{ pointerEvents: "auto", cursor: "pointer" }}
                  onClick={() => onSelectCrate(frontCrate)}
                  onDoubleClick={() => onRequestRenameCrate?.(frontCrate)}
                  onContextMenu={(e) => {
                    if (onCrateContextMenu) {
                      e.preventDefault();
                      e.stopPropagation();
                      onCrateContextMenu(e, frontCrate);
                    }
                  }}
                  title={`${frontCrate.title}（点击切换 / 双击重命名 / 右键更多操作）`}
                >
                  <div className="szx-glass-sig-title">
                    {frontCrate.title}
                  </div>
                  <svg
                    className="szx-glass-sig-flourish"
                    viewBox="0 0 84 10"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 7.5 C 24 2, 56 2.5, 81 6"
                      stroke={isSelected ? "var(--accent)" : "currentColor"}
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span className="szx-glass-sig-meta">
                      {frontCrate.tracks.length} 首
                    </span>
                    {onRequestRenameCrate && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRequestRenameCrate(frontCrate);
                        }}
                        title="自定义黑胶名称"
                        style={{
                          border: "none",
                          background: "rgba(0,0,0,0.45)",
                          color: "#f4f2ed",
                          borderRadius: 99,
                          width: 18,
                          height: 18,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        <Edit3 size={10} />
                      </button>
                    )}
                    {onRequestDeleteCrate && crates.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRequestDeleteCrate(frontCrate);
                        }}
                        title="删除此黑胶"
                        style={{
                          border: "none",
                          background: "rgba(0,0,0,0.45)",
                          color: "var(--warn)",
                          borderRadius: 99,
                          width: 18,
                          height: 18,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        <Trash2 size={10} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
