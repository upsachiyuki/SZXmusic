import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, FileText, Heart, Sparkles } from "lucide-react";
import type { LyricLineItem, TrackLyricsBundle } from "@shared/ipc/tauriBridge";
import type { TrackItem } from "@shared/mock/catalog";
import { formatTime } from "./TurntablePanel";

export type DetailViewMode = "sub" | "danmaku" | "info";

export interface TrackDetailViewProps {
  track: TrackItem;
  positionSec: number;
  isLiked: boolean;
  inTauri: boolean;
  mode: DetailViewMode;
  onChangeMode: (next: DetailViewMode) => void;
  onClose: () => void;
  onSeek: (sec: number) => void;
  onToggleLike: () => void;
  onSelectPageCid: (bvid: string, cid: number, partTitle: string) => void;
  fetchTrackLyrics: (
    bvid: string,
    cid?: number,
    title?: string,
    artist?: string
  ) => Promise<TrackLyricsBundle | null>;
}

function buildFallbackSubtitles(track: TrackItem): LyricLineItem[] {
  const dur = Math.max(60, track.durationSec || 180);
  const safeEnergy = Math.max(0, Math.min(5, Math.round(track.energy || 3)));
  const lines = [
    `♪ ${track.title} — ${track.artist}`,
    `原视频标题：${track.rawTitle || track.title}`,
    `音源标识：${track.bvid} · P${track.page || 1} · ${track.qualityLabel}`,
    `调性 ${track.musicalKey || "C"} · ${track.bpm || 100} BPM · 能量指数 ${"▮".repeat(safeEnergy)}`,
    track.reasonTag ? `收听印记：${track.reasonTag}` : "黑胶唱针已落槽 · 实时双声道频谱采集中",
    "居中视图专用于展示 B 站 CC 字幕与 LRC 时间轴同步歌词",
    "点击右上「字 / 弹」按钮，可随时切换居中字幕与弹幕瀑布流",
    "点击任意时间轴字幕行，即可精准跳转至对应播放秒数",
    `—— ${track.title} · 尾奏余韵 ——`,
  ];
  const step = dur / lines.length;
  return lines.map((text, idx) => ({
    timeSec: Math.round(idx * step),
    endSec: Math.round((idx + 1) * step),
    text,
    subText: idx === 0 ? "前奏 Intro" : idx === lines.length - 1 ? "尾奏 Outro" : "CC 字幕轴",
    kind: "subtitle",
  }));
}

function buildFallbackDanmaku(track: TrackItem): LyricLineItem[] {
  const dur = Math.max(60, track.durationSec || 180);
  const comments = [
    `前排打卡！《${track.title}》黑胶质感绝了`,
    `这个前奏一响直接DNA动了`,
    `${track.artist} 的声音在耳机里太通透了`,
    `音质 ${track.qualityLabel} 听感拉满，感谢 UP 主分享`,
    `深夜独自听这张黑胶，氛围感直接封神`,
    `注意听这里的鼓点和贝斯走线（${track.bpm} BPM）`,
    `副歌高潮来了！！！全屏弹幕护体`,
    `已经在循环播放歌单里常驻了`,
    `每次听到这一段都会起鸡皮疙瘩`,
    `B 站宝藏音源，配上液态毛玻璃唱机太舒服了`,
    `这段间奏的乐器分离度好高`,
    `完播打卡，再来亿遍！`,
  ];
  const step = dur / comments.length;
  return comments.map((text, idx) => ({
    timeSec: Math.max(1, Math.round(idx * step + (idx % 3) * 2)),
    endSec: Math.round((idx + 1) * step),
    text,
    subText: `弹幕 #${idx + 1}`,
    kind: "danmaku",
  }));
}

export function TrackDetailView({
  track,
  positionSec,
  isLiked,
  inTauri,
  mode,
  onChangeMode,
  onClose,
  onSeek,
  onToggleLike,
  onSelectPageCid,
  fetchTrackLyrics,
}: TrackDetailViewProps) {
  const [bundle, setBundle] = useState<TrackLyricsBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const activeCardRef = useRef<HTMLButtonElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!inTauri || !track.bvid.startsWith("BV")) {
      setBundle(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void fetchTrackLyrics(track.bvid, track.cid, track.title, track.artist)
      .then((res) => {
        if (!cancelled) {
          setBundle(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBundle(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fetchTrackLyrics, inTauri, track.artist, track.bvid, track.cid, track.title]);

  const isRealBiliTrack =
    inTauri && track.bvid.startsWith("BV") && !track.id.startsWith("trk-");

  // Dedicated Subtitle / Lyric lines for Centered View ("字")
  const subtitleLines = useMemo(() => {
    if (bundle && bundle.lines.length > 0 && bundle.lines[0]?.kind !== "danmaku") {
      return bundle.lines;
    }
    if (isRealBiliTrack) {
      return [];
    }
    return buildFallbackSubtitles(track);
  }, [bundle, isRealBiliTrack, track]);

  // Dedicated Danmaku items for Waterfall View ("弹")
  const danmakuItems = useMemo(() => {
    if (bundle && bundle.danmaku.length > 0) {
      return bundle.danmaku;
    }
    if (isRealBiliTrack) {
      return [];
    }
    return buildFallbackDanmaku(track);
  }, [bundle, isRealBiliTrack, track]);

  const activeList = mode === "danmaku" ? danmakuItems : subtitleLines;

  const activeIndex = useMemo(() => {
    let best = 0;
    for (let i = 0; i < activeList.length; i++) {
      if (activeList[i].timeSec <= positionSec + 0.35) {
        best = i;
      } else {
        break;
      }
    }
    return best;
  }, [activeList, positionSec]);

  // Smoothly keep active subtitle line or danmaku card centered in viewport
  useEffect(() => {
    const el = activeCardRef.current;
    const container = scrollContainerRef.current;
    if (!el || !container) return;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const offset = eRect.top - cRect.top - cRect.height * 0.4 + eRect.height * 0.5;
    if (Math.abs(offset) > 42) {
      container.scrollBy({ top: offset, behavior: "smooth" });
    }
  }, [activeIndex, mode]);

  const pagesList = useMemo(() => {
    if (bundle && bundle.pages.length > 0) return bundle.pages;
    if (track.pages && track.pages.length > 0) return track.pages;
    return [];
  }, [bundle, track.pages]);

  return (
    <div className="szx-crate-stage" style={{ gap: 12 }}>
      {/* Top Detail Navigation & Calligraphic "字 / 弹" Switcher */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          paddingBottom: 10,
          borderBottom: "1px solid var(--line)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <button
            type="button"
            className="szx-icon-btn szx-mono"
            onClick={onClose}
            style={{ height: 30, padding: "0 10px", flexShrink: 0 }}
            title="返回磨砂玻璃唱片箱 (Esc)"
          >
            <ArrowLeft size={13} />
            返回唱片箱
          </button>

          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                className="szx-serif"
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {track.title}
              </span>
              {track.page > 1 && (
                <span
                  className="szx-mono"
                  style={{
                    fontSize: 10,
                    padding: "1px 6px",
                    borderRadius: 999,
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                    border: "1px solid var(--accent)",
                    flexShrink: 0,
                  }}
                >
                  P{track.page}
                </span>
              )}
            </div>
            <div
              className="szx-mono"
              style={{
                fontSize: 11,
                color: "var(--ink-dim)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {track.artist} · {track.bvid} ·{" "}
              {loading
                ? "正在优先检查视频原字幕与 B 站实时弹幕池…"
                : mode === "sub"
                  ? bundle?.sourceLabel || `居中字幕 (${subtitleLines.length} 行)`
                  : mode === "danmaku"
                    ? `B站实时弹幕瀑布流 (${danmakuItems.length} 条)`
                    : bundle?.sourceLabel || "视频分P与元数据"}
            </div>
          </div>
        </div>

        {/* Calligraphic "字 / 弹" Switcher + Info Button */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div
            className="szx-zidan-pill"
            role="group"
            aria-label="字幕与弹幕视图切换"
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: 32,
              padding: 2,
              borderRadius: 999,
              background: "var(--panel)",
              border: "1px solid var(--glass-border)",
              boxShadow: "inset 0 1px 0 var(--specular)",
            }}
          >
            <button
              type="button"
              onClick={() => onChangeMode("sub")}
              title="字 · 居中滚动字幕/歌词视图"
              style={{
                border: "none",
                height: 26,
                padding: "0 12px",
                borderRadius: 999,
                cursor: "pointer",
                fontFamily: "'STKaiti', 'KaiTi', 'Songti SC', 'SimSun', var(--font-serif)",
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: "0.06em",
                background: mode === "sub" ? "var(--accent)" : "transparent",
                color: mode === "sub" ? "#faf9f5" : "var(--ink-muted)",
                transition: "all 180ms ease",
              }}
            >
              字
            </button>
            <span
              style={{
                fontSize: 11,
                color: "var(--ink-dim)",
                padding: "0 2px",
                userSelect: "none",
                fontFamily: "var(--font-serif)",
              }}
            >
              /
            </span>
            <button
              type="button"
              onClick={() => onChangeMode("danmaku")}
              title="弹 · B站时间轴弹幕瀑布流视图"
              style={{
                border: "none",
                height: 26,
                padding: "0 12px",
                borderRadius: 999,
                cursor: "pointer",
                fontFamily: "'STKaiti', 'KaiTi', 'Songti SC', 'SimSun', var(--font-serif)",
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: "0.06em",
                background: mode === "danmaku" ? "var(--accent)" : "transparent",
                color: mode === "danmaku" ? "#faf9f5" : "var(--ink-muted)",
                transition: "all 180ms ease",
              }}
            >
              弹
            </button>
          </div>

          <button
            type="button"
            className="szx-icon-btn szx-mono"
            onClick={() => onChangeMode(mode === "info" ? "sub" : "info")}
            title="查看视频详情与多 P 合集选集"
            style={{
              height: 30,
              fontSize: 11,
              borderColor: mode === "info" ? "var(--accent)" : undefined,
              background: mode === "info" ? "var(--accent-soft)" : undefined,
            }}
          >
            <FileText size={12} />
            {pagesList.length > 1 ? `分P (${pagesList.length})` : "详情"}
          </button>

          <button
            type="button"
            className="szx-icon-btn"
            onClick={onToggleLike}
            title="红心收藏 (快捷键 L)"
            style={{
              height: 30,
              minWidth: 30,
              padding: 0,
              color: isLiked ? "var(--accent)" : undefined,
            }}
          >
            <Heart size={13} fill={isLiked ? "currentColor" : "none"} />
          </button>
        </div>
      </div>

      {/* Body: "字" (Centered Subtitles) OR "弹" (Danmaku Waterfall) OR "详情/分P" */}
      <div
        ref={scrollContainerRef}
        data-liquid-scroll="detail-waterfall"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "8px 6px 28px",
        }}
      >
        {mode === "sub" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
              padding: "26px 16px 40px",
            }}
          >
            {subtitleLines.length === 0 ? (
              <div
                style={{
                  marginTop: 42,
                  padding: "22px 24px",
                  borderRadius: 12,
                  background: "var(--panel-glass)",
                  border: "1px dashed var(--glass-border)",
                  textAlign: "center",
                  maxWidth: 420,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                <div className="szx-serif" style={{ fontSize: 16, fontWeight: 600 }}>
                  {loading
                    ? "正在加载视频原字幕与对齐歌词…"
                    : bundle?.sourceLabel || "暂无视频原字幕与对齐歌词"}
                </div>
                {!loading && (
                  <div className="szx-mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>
                    已优先检索 B 站原视频 CC/AI 字幕并按歌名对齐歌词。
                    {danmakuItems.length > 0 && ` 当前视频共有 ${danmakuItems.length} 条实时弹幕。`}
                  </div>
                )}
                {!loading && (
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <button
                      type="button"
                      className="szx-icon-btn szx-mono"
                      onClick={() => onChangeMode("danmaku")}
                      style={{ fontSize: 11 }}
                    >
                      查看弹幕 ({danmakuItems.length})
                    </button>
                    <button
                      type="button"
                      className="szx-icon-btn szx-mono"
                      onClick={() => onChangeMode("info")}
                      style={{ fontSize: 11 }}
                    >
                      查看详情 / 简介
                    </button>
                  </div>
                )}
              </div>
            ) : (
              subtitleLines.map((item, idx) => {
                const isCurrent = idx === activeIndex;
                const isPast = idx < activeIndex;
                return (
                  <button
                    key={`sub-${idx}-${item.timeSec}`}
                    ref={isCurrent ? activeCardRef : null}
                    type="button"
                    onClick={() => onSeek(item.timeSec)}
                    className="szx-subtitle-line"
                    style={{
                      width: "min(580px, 100%)",
                      border: isCurrent ? "1px solid var(--accent)" : "1px solid transparent",
                      borderRadius: 12,
                      padding: isCurrent ? "13px 20px" : "8px 14px",
                      background: isCurrent ? "var(--accent-soft)" : "transparent",
                      color: isCurrent ? "var(--accent)" : "var(--ink)",
                      opacity: isCurrent ? 1 : isPast ? 0.45 : 0.8,
                      cursor: "pointer",
                      textAlign: "center",
                      transition: "all 200ms ease",
                    }}
                  >
                    <div
                      className="szx-serif"
                      style={{
                        fontSize: isCurrent ? 20 : 15,
                        fontWeight: isCurrent ? 700 : 400,
                        lineHeight: 1.55,
                      }}
                    >
                      {item.text}
                    </div>
                    <div
                      className="szx-mono"
                      style={{ fontSize: 10, color: "var(--ink-dim)", marginTop: 3 }}
                    >
                      {formatTime(item.timeSec)} {item.subText ? `· ${item.subText}` : ""}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}

        {mode === "danmaku" && (
          danmakuItems.length === 0 ? (
            <div
              style={{
                margin: "60px auto 0",
                padding: "22px 24px",
                borderRadius: 12,
                background: "var(--panel-glass)",
                border: "1px dashed var(--glass-border)",
                textAlign: "center",
                maxWidth: 400,
              }}
            >
              <div className="szx-serif" style={{ fontSize: 16, fontWeight: 600 }}>
                {loading ? "正在拉取 B 站实时弹幕池…" : "该视频暂无时间轴弹幕"}
              </div>
              {!loading && (
                <div className="szx-mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 6 }}>
                  数据直接来自 B 站实时弹幕池（CID {bundle?.cid || track.cid || 0}），当前为空。
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(215px, 1fr))",
                gap: 10,
                alignItems: "start",
              }}
            >
            {danmakuItems.map((item, idx) => {
              const isCurrent = idx === activeIndex;
              const isPast = idx < activeIndex;
              const staggerTop = (idx % 3) * 8;

              return (
                <button
                  key={`dm-${idx}-${item.timeSec}`}
                  ref={isCurrent ? activeCardRef : null}
                  type="button"
                  onClick={() => onSeek(item.timeSec)}
                  className="szx-danmaku-card"
                  style={{
                    marginTop: staggerTop,
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: 11,
                    border: isCurrent
                      ? "1.5px solid var(--accent)"
                      : "1px solid var(--glass-border)",
                    background: isCurrent ? "var(--accent-soft)" : "var(--panel-glass)",
                    boxShadow: isCurrent
                      ? "0 10px 26px var(--accent-glow)"
                      : "0 4px 14px rgba(0, 0, 0, 0.14)",
                    color: "var(--ink)",
                    opacity: isCurrent ? 1 : isPast ? 0.56 : 0.9,
                    transform: isCurrent ? "scale(1.02)" : "scale(1)",
                    transition:
                      "transform 220ms ease, border-color 220ms ease, background 220ms ease, opacity 220ms ease",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 5,
                  }}
                >
                  <div
                    className="szx-mono"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: 10,
                      color: isCurrent ? "var(--accent)" : "var(--ink-dim)",
                    }}
                  >
                    <span>{formatTime(item.timeSec)}</span>
                    <span>{isCurrent ? "● 弹幕飘过" : item.subText || "B站弹幕"}</span>
                  </div>
                  <div
                    style={{
                      fontSize: isCurrent ? 14 : 13,
                      fontWeight: isCurrent ? 600 : 400,
                      lineHeight: 1.45,
                      color: isCurrent ? "var(--accent)" : "var(--ink)",
                      wordBreak: "break-word",
                    }}
                  >
                    {item.text}
                  </div>
                </button>
              );
            })}
            </div>
          )
        )}

        {mode === "info" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 12 }}>
            <div
              style={{
                padding: 14,
                borderRadius: 12,
                background: "var(--panel-glass)",
                border: "1px solid var(--glass-border)",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div className="szx-mono" style={{ fontSize: 11, color: "var(--accent)" }}>
                <Sparkles size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                曲目解析与源视频元数据
              </div>
              <div className="szx-mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>
                BV号：{track.bvid} &nbsp;|&nbsp; CID：{bundle?.cid || track.cid || 1} &nbsp;|&nbsp;
                规则：{track.ruleId} ({Math.round(track.confidence * 100)}%)
              </div>
              <div style={{ fontSize: 12.5 }}>
                <strong>原始标题：</strong>
                {bundle?.title || track.rawTitle || track.title}
              </div>
              {bundle?.description && (
                <div
                  style={{
                    marginTop: 4,
                    paddingTop: 8,
                    borderTop: "1px solid var(--line)",
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.55,
                    color: "var(--ink-dim)",
                    fontSize: 11.5,
                  }}
                >
                  {bundle.description}
                </div>
              )}
            </div>

            {pagesList.length > 1 && (
              <div
                style={{
                  padding: 14,
                  borderRadius: 12,
                  background: "var(--panel-glass)",
                  border: "1px solid var(--glass-border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div className="szx-mono" style={{ fontSize: 11, color: "var(--accent)" }}>
                  多 P 合集顺序连播选集 ({pagesList.length} P · 播完当前分P自动按序切下一P)
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                    gap: 6,
                  }}
                >
                  {pagesList.map((pg) => {
                    const isCurrCid =
                      (track.cid && pg.cid === track.cid) || pg.page === track.page;
                    return (
                      <button
                        key={pg.cid}
                        type="button"
                        className="szx-icon-btn szx-mono"
                        onClick={() => onSelectPageCid(track.bvid, pg.cid, pg.part)}
                        style={{
                          justifyContent: "space-between",
                          height: 30,
                          fontSize: 11,
                          borderColor: isCurrCid ? "var(--accent)" : undefined,
                          background: isCurrCid ? "var(--accent-soft)" : undefined,
                        }}
                      >
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          P{pg.page}. {pg.part}
                        </span>
                        <span style={{ color: "var(--ink-dim)", fontSize: 10 }}>
                          {formatTime(pg.duration)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
