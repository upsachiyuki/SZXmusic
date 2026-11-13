import type { MouseEvent } from "react";
import {
  ArrowRightLeft,
  Edit3,
  Pause,
  Play,
  Plus,
  Radio,
  SkipBack,
  SkipForward,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { AudioQualityOption } from "@shared/ipc/tauriBridge";
import type { CrateItem, TrackItem } from "@shared/mock/catalog";
import type { DetailViewMode } from "./TrackDetailView";
import { VinylDisc } from "./VinylDisc";

export interface TurntablePanelProps {
  crate: CrateItem;
  cratesCount?: number;
  currentTrack: TrackItem;
  isPlaying: boolean;
  positionSec: number;
  volume: number;
  muted: boolean;
  preferredQuality: number;
  availableQualities: AudioQualityOption[];
  detailOpen: boolean;
  detailMode?: DetailViewMode;
  isRevealLayer?: boolean;
  mode: "radio" | "loop:all" | "loop:one";
  streamStatus: string;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onCycleMode: () => void;
  onSelectTrack: (track: TrackItem) => void;
  onSeek: (sec: number) => void;
  onSetVolume: (vol: number) => void;
  onToggleMute: () => void;
  onChangeQuality: (qualityId: number) => void;
  onToggleDetail: () => void;
  onOpenDetailMode?: (mode: DetailViewMode) => void;
  onVerifyLiveStream: (track: TrackItem) => void;
  onFetchRelated?: (bvid: string, seedTitle: string) => void;
  onRequestRenameCrate?: (crate: CrateItem) => void;
  onRequestDeleteCrate?: (crate: CrateItem) => void;
  onRequestAddTrack?: (crate: CrateItem) => void;
  onRequestTransferTracks?: (crate: CrateItem) => void;
  onRemoveTrackFromCrate?: (crateId: string, trackId: string) => void;
  onTrackContextMenu?: (e: MouseEvent<HTMLElement>, track: TrackItem, crate: CrateItem) => void;
  onTurntableContextMenu?: (e: MouseEvent<HTMLElement>) => void;
}

export function formatTime(sec: number): string {
  const safe = Number.isFinite(sec) ? sec : 0;
  const s = Math.max(0, Math.floor(safe));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function TurntablePanel({
  crate,
  cratesCount = 2,
  currentTrack,
  isPlaying,
  positionSec,
  volume,
  muted,
  preferredQuality,
  availableQualities,
  detailOpen,
  detailMode = "sub",
  isRevealLayer = false,
  mode,
  streamStatus,
  onTogglePlay,
  onPrev,
  onNext,
  onCycleMode,
  onSelectTrack,
  onSeek,
  onSetVolume,
  onToggleMute,
  onChangeQuality,
  onToggleDetail,
  onOpenDetailMode,
  onVerifyLiveStream: _onVerifyLiveStream,
  onFetchRelated,
  onRequestRenameCrate,
  onRequestDeleteCrate,
  onRequestAddTrack,
  onRequestTransferTracks,
  onRemoveTrackFromCrate,
  onTrackContextMenu,
  onTurntableContextMenu,
}: TurntablePanelProps) {
  const pct =
    currentTrack.durationSec > 0
      ? Math.min(100, Math.max(0, (positionSec / currentTrack.durationSec) * 100))
      : 0;

  const modeDisplay =
    mode === "loop:all" ? "顺序" : mode === "loop:one" ? "单曲" : "漫游";

  // Count how many rows share the same bvid so expanded multi-P crates don't repeat P1/113 badges
  const bvidRowCounts = new Map<string, number>();
  for (const t of crate.tracks) {
    bvidRowCounts.set(t.bvid, (bvidRowCounts.get(t.bvid) ?? 0) + 1);
  }

  return (
    <aside className="szx-right-pane">
      {/* Turntable Platter (Click disc/platter to open Track Detail, or click 字/弹 directly) */}
      <div
        className="szx-turntable-card"
        onClick={onToggleDetail}
        onContextMenu={(e) => {
          if (onTurntableContextMenu) {
            e.preventDefault();
            e.stopPropagation();
            onTurntableContextMenu(e);
          }
        }}
        title="点击黑胶唱盘展开/收起详情页 · 右上角「字 / 弹」直达居中字幕或弹幕瀑布流"
        style={{
          cursor: "pointer",
          borderColor: detailOpen ? "var(--accent)" : undefined,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 14,
            display: "flex",
            alignItems: "center",
            zIndex: 5,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: isPlaying ? "var(--accent)" : "var(--ink-dim)",
              boxShadow: isPlaying ? "0 0 8px var(--accent)" : "none",
            }}
          />
        </div>

        {/* Top-right Calligraphic "字 / 弹" Button */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: 7,
            right: 9,
            zIndex: 6,
            display: "inline-flex",
            alignItems: "center",
            height: 26,
            padding: 2,
            borderRadius: 999,
            border: "1px solid var(--glass-border)",
            background: "var(--panel-glass)",
            boxShadow: "inset 0 1px 0 var(--specular)",
          }}
        >
          <button
            type="button"
            onClick={() => {
              if (detailOpen && detailMode === "sub") {
                onToggleDetail();
              } else {
                onOpenDetailMode?.("sub");
              }
            }}
            title="字 · 打开居中滚动字幕/歌词视图"
            style={{
              border: "none",
              height: 20,
              padding: "0 8px",
              borderRadius: 999,
              cursor: "pointer",
              fontFamily: "'STKaiti', 'KaiTi', 'Songti SC', 'SimSun', var(--font-serif)",
              fontSize: 12.5,
              fontWeight: 700,
              background:
                detailOpen && detailMode === "sub" ? "var(--accent)" : "transparent",
              color:
                detailOpen && detailMode === "sub" ? "#faf9f5" : "var(--ink)",
              transition: "all 160ms ease",
            }}
          >
            字
          </button>
          <span
            style={{
              fontSize: 10,
              color: "var(--ink-dim)",
              padding: "0 1px",
              userSelect: "none",
              fontFamily: "var(--font-serif)",
            }}
          >
            /
          </span>
          <button
            type="button"
            onClick={() => {
              if (detailOpen && detailMode === "danmaku") {
                onToggleDetail();
              } else {
                onOpenDetailMode?.("danmaku");
              }
            }}
            title="弹 · 打开 B 站弹幕瀑布流视图"
            style={{
              border: "none",
              height: 20,
              padding: "0 8px",
              borderRadius: 999,
              cursor: "pointer",
              fontFamily: "'STKaiti', 'KaiTi', 'Songti SC', 'SimSun', var(--font-serif)",
              fontSize: 12.5,
              fontWeight: 700,
              background:
                detailOpen && detailMode === "danmaku" ? "var(--accent)" : "transparent",
              color:
                detailOpen && detailMode === "danmaku" ? "#faf9f5" : "var(--ink)",
              transition: "all 160ms ease",
            }}
          >
            弹
          </button>
        </div>

        <VinylDisc
          size={190}
          labelCoverUrl={currentTrack.coverUrl}
          spinning={isPlaying}
          spinDurationSec={1.8}
        />

        {/* Minimal Tonearm SVG */}
        <svg
          className="szx-tonearm"
          viewBox="0 0 96 165"
          style={{
            transform: isPlaying ? "rotate(18deg)" : "rotate(-8deg)",
          }}
        >
          <circle cx="72" cy="24" r="14" fill="var(--panel)" stroke="var(--line)" strokeWidth="2" />
          <circle cx="72" cy="24" r="5" fill="var(--accent)" />
          <path
            d="M72 24 L64 98 L40 134"
            fill="none"
            stroke="var(--ink-dim)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect
            x="30"
            y="128"
            width="16"
            height="24"
            rx="3"
            transform="rotate(28 38 140)"
            fill="var(--ink)"
          />
        </svg>

        {/* Bottom mini transport + Stream Quality Selector */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            bottom: 8,
            left: 10,
            right: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 6,
            zIndex: 5,
          }}
        >
          <select
            value={preferredQuality}
            disabled={isRevealLayer}
            tabIndex={isRevealLayer ? -1 : undefined}
            onChange={(e) => onChangeQuality(Number(e.target.value))}
            title={`当前：${currentTrack.qualityLabel} · ${streamStatus}`}
            className="szx-mono"
            style={{
              maxWidth: 118,
              height: 26,
              padding: "0 6px",
              borderRadius: 6,
              border: "1px solid var(--glass-border)",
              background: "var(--panel)",
              color: "var(--ink)",
              fontSize: 10,
              cursor: "pointer",
              outline: "none",
            }}
          >
            {availableQualities.map((q) => (
              <option key={q.id} value={q.id}>
                {q.id === 0 ? `自动 (${currentTrack.qualityLabel})` : q.label}
              </option>
            ))}
          </select>

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              type="button"
              className="szx-icon-btn"
              onClick={onPrev}
              title="上一首 / 上一分P (Ctrl + ←)"
              style={{ height: 28, minWidth: 28, padding: 0 }}
            >
              <SkipBack size={12} />
            </button>
            <button
              type="button"
              className="szx-icon-btn"
              onClick={onTogglePlay}
              title={isPlaying ? "暂停 (Space)" : "播放 (Space)"}
              style={{
                height: 28,
                minWidth: 28,
                padding: 0,
                borderColor: "var(--accent)",
                background: "var(--accent)",
                color: "#faf9f5",
              }}
            >
              {isPlaying ? <Pause size={12} /> : <Play size={12} />}
            </button>
            <button
              type="button"
              className="szx-icon-btn"
              onClick={onNext}
              title="下一首 / 下一分P (Ctrl + →)"
              style={{ height: 28, minWidth: 28, padding: 0 }}
            >
              <SkipForward size={12} />
            </button>
            <button
              type="button"
              className="szx-icon-btn szx-mono"
              onClick={onCycleMode}
              title="切换播放模式（顺序连播 / 单曲循环 / 电台漫游）"
              style={{ height: 28, fontSize: 10, padding: "0 7px" }}
            >
              <Radio size={11} />
              {modeDisplay}
            </button>
          </div>
        </div>
      </div>

      {/* Selected Crate Info + Crate Edit/Add/Delete + Seek + Volume */}
      <div
        style={{
          padding: "8px 10px",
          borderRadius: 10,
          background: "var(--panel-glass)",
          border: "1px solid var(--glass-border)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
          }}
        >
          <strong
            style={{
              fontSize: 13,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
              flex: 1,
            }}
            title={crate.title}
          >
            {crate.title}
          </strong>

          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <span
              className="szx-mono"
              style={{
                fontSize: 10,
                color: "var(--ink-dim)",
                marginRight: 2,
              }}
            >
              {crate.tracks.length} 首
            </span>
            {onFetchRelated && currentTrack.bvid.startsWith("BV") && (
              <button
                type="button"
                className="szx-icon-btn"
                onClick={() => onFetchRelated(currentTrack.bvid, currentTrack.title)}
                title="拉取 B 站相似视频生成推荐黑胶箱"
                style={{ height: 22, minWidth: 22, padding: 0 }}
              >
                <Sparkles size={10} />
              </button>
            )}
            {onRequestAddTrack && (
              <button
                type="button"
                className="szx-icon-btn szx-mono"
                onClick={() => onRequestAddTrack(crate)}
                title="向当前黑胶播放列表添加曲目"
                style={{ height: 22, padding: "0 6px", fontSize: 10 }}
              >
                <Plus size={10} />
                加歌
              </button>
            )}
            {onRequestTransferTracks && crate.tracks.length > 0 && (
              <button
                type="button"
                className="szx-icon-btn szx-mono"
                onClick={() => onRequestTransferTracks(crate)}
                title="一键批量转移当前黑胶或分 P 合集到其他黑胶"
                style={{ height: 22, padding: "0 6px", fontSize: 10 }}
              >
                <ArrowRightLeft size={10} />
                转移
              </button>
            )}
            {onRequestRenameCrate && (
              <button
                type="button"
                className="szx-icon-btn"
                onClick={() => onRequestRenameCrate(crate)}
                title="自定义此黑胶名称"
                style={{ height: 22, minWidth: 22, padding: 0 }}
              >
                <Edit3 size={10} />
              </button>
            )}
            {onRequestDeleteCrate && cratesCount > 1 && (
              <button
                type="button"
                className="szx-icon-btn"
                onClick={() => onRequestDeleteCrate(crate)}
                title="删除此黑胶唱片箱"
                style={{ height: 22, minWidth: 22, padding: 0, color: "var(--warn)" }}
              >
                <Trash2 size={10} />
              </button>
            )}
          </div>
        </div>

        {/* Seek Bar */}
        <div
          style={{
            marginTop: 7,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span className="szx-mono" style={{ fontSize: 10, color: "var(--ink-dim)" }}>
            {formatTime(positionSec)}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(1, currentTrack.durationSec)}
            value={Math.floor(positionSec)}
            readOnly={isRevealLayer}
            tabIndex={isRevealLayer ? -1 : undefined}
            onChange={(e) => onSeek(Number(e.target.value))}
            aria-label="播放进度"
            style={{
              flex: 1,
              accentColor: "var(--accent)",
              height: 4,
              cursor: "pointer",
            }}
          />
          <span className="szx-mono" style={{ fontSize: 10, color: "var(--ink-dim)" }}>
            {formatTime(currentTrack.durationSec)}
          </span>
        </div>

        {/* Volume Bar */}
        <div
          style={{
            marginTop: 5,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <button
            type="button"
            onClick={onToggleMute}
            title={muted || volume === 0 ? "取消静音 (M)" : "静音 (M)"}
            style={{
              border: "none",
              background: "transparent",
              color: muted || volume === 0 ? "var(--warn)" : "var(--ink-dim)",
              padding: 0,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            {muted || volume === 0 ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={muted ? 0 : volume}
            readOnly={isRevealLayer}
            tabIndex={isRevealLayer ? -1 : undefined}
            onChange={(e) => onSetVolume(Number(e.target.value))}
            aria-label="音量控制"
            title="调节音量 (↑ / ↓)"
            style={{
              flex: 1,
              accentColor: "var(--accent)",
              height: 3,
              cursor: "pointer",
            }}
          />
          <span
            className="szx-mono"
            style={{ fontSize: 10, color: "var(--ink-dim)", minWidth: 28, textAlign: "right" }}
          >
            {muted ? "静音" : `${volume}%`}
          </span>
        </div>
      </div>

      {/* Terminal Monospace Tracklist */}
      <div
        data-liquid-scroll="tracklist"
        className="szx-mono"
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 3,
          paddingRight: 2,
        }}
      >
        {crate.tracks.length === 0 ? (
          <div
            style={{
              padding: "24px 12px",
              textAlign: "center",
              color: "var(--ink-dim)",
              fontSize: 11,
              border: "1px dashed var(--line)",
              borderRadius: 10,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>当前黑胶播放列表为空</span>
            {onRequestAddTrack && (
              <button
                type="button"
                className="szx-icon-btn szx-mono"
                onClick={() => onRequestAddTrack(crate)}
                style={{ fontSize: 11, borderColor: "var(--accent)", color: "var(--accent)" }}
              >
                <Plus size={12} />
                添加曲目到此黑胶
              </button>
            )}
          </div>
        ) : (
          crate.tracks.map((trk, idx) => {
            const isCurrent = trk.id === currentTrack.id;
            const totalPages = trk.pages?.length ?? 0;
            const hasExpandedSiblingRows = (bvidRowCounts.get(trk.bvid) ?? 0) > 1;
            const activePageNo =
              isCurrent && currentTrack.bvid === trk.bvid
                ? currentTrack.page
                : trk.page;
            const matchedPagePart =
              trk.pages?.find((p) => p.page === (hasExpandedSiblingRows ? trk.page : activePageNo))
                ?.part?.trim() ?? "";
            const cleanedPagePart = matchedPagePart
              .replace(/^(?:p|ep)\s*0*\d{1,3}[\s.:：\-–—_)]*/i, "")
              .replace(/^\d{1,3}(?:[.)、_:：]|\s*[-–—])\s*/, "")
              .trim();
            const displayTitle =
              !hasExpandedSiblingRows &&
              isCurrent &&
              currentTrack.bvid === trk.bvid &&
              totalPages > 1 &&
              activePageNo !== trk.page &&
              cleanedPagePart &&
              cleanedPagePart !== trk.rawTitle?.trim()
                ? cleanedPagePart
                : trk.title;
            const showPageBadge = totalPages > 1 || trk.page > 1;
            const showArtist =
              Boolean(trk.artist) &&
              trk.artist !== "未知艺人" &&
              trk.artist !== crate.title;
            return (
              <div
                key={trk.id}
                className={`szx-track-row ${isCurrent ? "is-current" : ""}`}
                onClick={() => onSelectTrack(trk)}
                onContextMenu={(e) => {
                  if (onTrackContextMenu) {
                    e.preventDefault();
                    e.stopPropagation();
                    onTrackContextMenu(e, trk, crate);
                  }
                }}
                style={trk.isInvalid ? { opacity: 0.48 } : undefined}
                title={
                  trk.isInvalid
                    ? "原 B 站视频已失效，但本地保留歌名/艺人记录"
                    : `${displayTitle} · P${trk.page}${totalPages > 1 ? `/${totalPages}` : ""}（原题：${trk.rawTitle}，右键打开菜单）`
                }
              >
                <span style={{ color: isCurrent ? "var(--accent)" : "var(--ink-dim)" }}>
                  {isCurrent ? "▶" : String(idx + 1).padStart(2, "0")}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontWeight: isCurrent ? 600 : 400,
                        textDecoration: trk.isInvalid ? "line-through" : undefined,
                      }}
                    >
                      {showArtist ? `${displayTitle} — ${trk.artist}` : displayTitle}
                    </span>
                    {showPageBadge && (
                      <span
                        style={{
                          flexShrink: 0,
                          fontSize: 9,
                          padding: "0 4px",
                          borderRadius: 4,
                          background: !hasExpandedSiblingRows || isCurrent ? "var(--accent-soft)" : "transparent",
                          color: !hasExpandedSiblingRows || isCurrent ? "var(--accent)" : "var(--ink-dim)",
                          border:
                            !hasExpandedSiblingRows || isCurrent
                              ? "1px solid var(--accent)"
                              : "1px solid var(--line)",
                        }}
                        title={
                          hasExpandedSiblingRows
                            ? `多P分集：第 ${trk.page}${totalPages > 1 ? `/${totalPages}` : ""} P`
                            : `多P合集视频：当前第 ${activePageNo}/${totalPages} P，按顺序自动连播`
                        }
                      >
                        {!hasExpandedSiblingRows && totalPages > 1
                          ? `P${activePageNo}/${totalPages}`
                          : `P${trk.page}`}
                      </span>
                    )}
                    {trk.isInvalid && (
                      <span
                        style={{
                          flexShrink: 0,
                          fontSize: 9,
                          padding: "0 4px",
                          borderRadius: 4,
                          color: "var(--warn)",
                          border: "1px solid var(--warn)",
                        }}
                      >
                        已失效
                      </span>
                    )}
                  </div>
                  {isCurrent && (
                    <div
                      style={{
                        marginTop: 3,
                        height: 2,
                        width: "100%",
                        background: "var(--line)",
                        borderRadius: 99,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${pct}%`,
                          background: "var(--accent)",
                        }}
                      />
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ color: isCurrent ? "var(--accent)" : "var(--ink-dim)" }}>
                    {formatTime(trk.durationSec)}
                  </span>
                  {onRemoveTrackFromCrate && (
                    <button
                      type="button"
                      className="szx-track-remove-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveTrackFromCrate(crate.id, trk.id);
                      }}
                      title="从当前黑胶播放列表移除此曲目"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
