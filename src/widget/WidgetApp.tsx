import { useEffect, useRef, useState } from "react";
import {
  Heart,
  Home,
  Moon,
  MousePointerClick,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Sun,
} from "lucide-react";
import { GlassPanel } from "@shared/glass/GlassPanel";
import { RefractionFilterDefs } from "@shared/glass/RefractionFilter";
import { LiquidThemeStage } from "@shared/liquid-theme";
import {
  invokeCore,
  isTauriRuntime,
  listenAppEvent,
  type LyricLineItem,
  type SyncResult,
  type ThemeMode,
  type WidgetSize,
} from "@shared/ipc/tauriBridge";
import {
  subscribeBrowserSync,
  usePlayerStore,
  type SyncStatePayload,
} from "@shared/state/playerStore";
import { formatTime } from "../main/components/TurntablePanel";

const UNICODE_BARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
const BRAILLE_SPARK = ["⠀", "⣀", "⣤", "⣶", "⣿"];

export function WidgetApp() {
  const {
    theme,
    crates,
    activeCrateId,
    currentTrack,
    nextTrack,
    isPlaying,
    positionSec,
    volume,
    mode,
    likedIds,
    spectrum,
    levelL,
    levelR,
    widgetSize,
    clickThrough,
    setTheme,
    playTrack,
    togglePlay,
    seek,
    setVolume,
    toggleMute,
    stepTrack,
    toggleLike,
    setWidgetSize,
    setClickThrough,
    tickSimulation,
    applyLiveTelemetry,
    applyRemoteSync,
    applyLibrarySnapshot,
    initBiliWorkspace,
    fetchTrackLyrics,
  } = usePlayerStore();

  const [bootDone, setBootDone] = useState(false);
  const [bootStep, setBootStep] = useState(0);
  const [syncToast, setSyncToast] = useState<string | null>(null);
  const [lyricLines, setLyricLines] = useState<LyricLineItem[]>([]);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [historyEnergies, setHistoryEnergies] = useState<number[]>(() =>
    Array.from({ length: 22 }, () => 0.35)
  );
  const lastHistTick = useRef(0);

  const inTauri = isTauriRuntime();
  const isLiked = likedIds.includes(currentTrack.id);

  // Fetch synced subtitles / lyrics for the current track in L-mode
  useEffect(() => {
    let active = true;
    const rawCombined = `${currentTrack.rawTitle || ""} ${currentTrack.title || ""}`.toLowerCase();
    const isLikelyOst =
      rawCombined.includes("ost") ||
      rawCombined.includes("纯音乐") ||
      rawCombined.includes("伴奏") ||
      rawCombined.includes("特典音乐集") ||
      rawCombined.includes("原声") ||
      rawCombined.includes("吉他曲") ||
      rawCombined.includes("钢琴曲") ||
      currentTrack.version === "Instrumental";

    if (!inTauri || !currentTrack.bvid.startsWith("BV")) {
      setLyricLines([]);
      setLyricsLoading(false);
      return;
    }

    setLyricsLoading(true);
    void fetchTrackLyrics(
      currentTrack.bvid,
      currentTrack.cid,
      currentTrack.title,
      currentTrack.artist
    )
      .then((bundle) => {
        if (!active) return;
        const syncedSubs = (bundle?.lines ?? []).filter(
          (l) => l.kind === "subtitle" || (!isLikelyOst && l.kind === "lrc")
        );
        setLyricLines(syncedSubs);
      })
      .catch(() => {
        if (active) setLyricLines([]);
      })
      .finally(() => {
        if (active) setLyricsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    currentTrack.artist,
    currentTrack.bvid,
    currentTrack.cid,
    currentTrack.id,
    currentTrack.rawTitle,
    currentTrack.title,
    currentTrack.version,
    fetchTrackLyrics,
    inTauri,
  ]);

  // Quick terminal boot typewriter effect
  useEffect(() => {
    const t1 = window.setTimeout(() => setBootStep(1), 160);
    const t2 = window.setTimeout(() => setBootStep(2), 340);
    const t3 = window.setTimeout(() => setBootDone(true), 580);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, []);

  // Telemetry / simulation loop (paused when idle to eliminate background CPU/RAM churn)
  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setInterval(() => {
      tickSimulation(0.12, !inTauri);
      const now = performance.now();
      if (now - lastHistTick.current > 320) {
        lastHistTick.current = now;
        const spec = usePlayerStore.getState().spectrum;
        const avg =
          spec.length > 0
            ? spec.reduce((acc, v) => acc + v, 0) / spec.length
            : 0.2;
        setHistoryEnergies((prev) => [...prev.slice(1), avg]);
      }
    }, 120);
    return () => window.clearInterval(id);
  }, [inTauri, isPlaying, tickSimulation]);

  // Cross-window sync & Bilibili library updates
  useEffect(() => {
    void initBiliWorkspace();
    const unsubBrowser = subscribeBrowserSync();
    let unsubSync: (() => void) | undefined;
    let unsubTelemetry: (() => void) | undefined;
    let unsubSynced: (() => void) | undefined;
    let toastTimer: number | undefined;

    void listenAppEvent<SyncStatePayload>("szx://state-sync", (payload) => {
      applyRemoteSync(payload);
    }).then((fn) => {
      unsubSync = fn;
    });

    void listenAppEvent<{
      spectrum?: number[];
      levelL?: number;
      levelR?: number;
      positionSec?: number;
      isPlaying?: boolean;
      liveStreamActive?: boolean;
      streamStatus?: string;
      bpm?: number;
      musicalKey?: string;
      energy?: number;
    }>("player://telemetry", (payload) => {
      applyLiveTelemetry(payload);
    }).then((fn) => {
      unsubTelemetry = fn;
    });

    void listenAppEvent<SyncResult>("szx://library-synced", (res) => {
      applyLibrarySnapshot(res.snapshot, true);
      if (res.newTracksCount > 0) {
        setSyncToast(`+${res.newTracksCount} 首新曲目已同步`);
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => setSyncToast(null), 4500);
      }
    }).then((fn) => {
      unsubSynced = fn;
    });

    return () => {
      window.clearTimeout(toastTimer);
      unsubBrowser();
      unsubSync?.();
      unsubTelemetry?.();
      unsubSynced?.();
    };
  }, [applyLibrarySnapshot, applyLiveTelemetry, applyRemoteSync, initBiliWorkspace]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        stepTrack(-1);
      } else if (e.key === "ArrowRight" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        stepTrack(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seek(Math.max(0, positionSec - 5));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seek(Math.min(currentTrack.durationSec, positionSec + 5));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setVolume(Math.min(100, volume + 5));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setVolume(Math.max(0, volume - 5));
      } else if (e.key.toLowerCase() === "m") {
        e.preventDefault();
        toggleMute();
      } else if (e.key.toLowerCase() === "l") {
        e.preventDefault();
        toggleLike(currentTrack.id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    currentTrack.durationSec,
    currentTrack.id,
    positionSec,
    seek,
    setVolume,
    stepTrack,
    toggleLike,
    toggleMute,
    togglePlay,
    volume,
  ]);

  const openMainWindow = async () => {
    if (inTauri) {
      await invokeCore("win_show_main");
    } else {
      window.open("/", "szx-main");
    }
  };

  const progressRatio =
    currentTrack.durationSec > 0
      ? Math.min(1, Math.max(0, positionSec / currentTrack.durationSec))
      : 0;
  const pct = Math.round(progressRatio * 100);
  const totalBlocks = 18;
  const filledBlocks = Math.round(progressRatio * totalBlocks);

  const activeCrate = crates.find((c) => c.id === activeCrateId) ?? crates[0];
  const crateTracks = activeCrate?.tracks ?? [];
  const currentIdx = crateTracks.findIndex(
    (t) =>
      t.id === currentTrack.id ||
      (t.bvid === currentTrack.bvid &&
        ((currentTrack.cid && t.cid === currentTrack.cid) ||
          (currentTrack.page && t.page === currentTrack.page)))
  );
  const upcomingQueue =
    currentIdx >= 0
      ? [
          ...crateTracks.slice(currentIdx + 1),
          ...crateTracks.slice(0, currentIdx),
        ]
      : crateTracks.filter((t) => t.id !== currentTrack.id);

  // Active & next subtitle lines for L-mode HIST subtitle box
  let activeLyricIdx = -1;
  for (let i = 0; i < lyricLines.length; i++) {
    if (positionSec >= lyricLines[i].timeSec) {
      activeLyricIdx = i;
    } else {
      break;
    }
  }
  const activeLyric =
    activeLyricIdx >= 0 ? lyricLines[activeLyricIdx] : lyricLines[0] ?? null;
  const nextLyric =
    activeLyricIdx >= 0
      ? lyricLines[activeLyricIdx + 1] ?? null
      : lyricLines[1] ?? null;

  const safeEnergy = Math.max(0, Math.min(5, Math.round(currentTrack.energy || 3)));
  const showTrackArtist =
    Boolean(currentTrack.artist) &&
    currentTrack.artist !== "未知艺人" &&
    currentTrack.artist !== activeCrate?.title;

  const dbText = (lvl: number) => {
    const db = Math.max(-42, Math.round(20 * Math.log10(Math.max(0.008, lvl || 0.008))));
    return `${db}dB`;
  };

  const miniUnicodeSpec = spectrum
    .slice(0, 12)
    .map((v) => UNICODE_BARS[Math.min(7, Math.max(0, Math.floor((v || 0) * 8)))])
    .join("");

  const brailleHistory = historyEnergies
    .map((v) => BRAILLE_SPARK[Math.min(4, Math.max(0, Math.floor((v || 0) * 5)))])
    .join("");

  return (
    <>
      <RefractionFilterDefs />
      <LiquidThemeStage theme={theme} onThemeChange={setTheme} layoutMode="fixed-app">
        {(liquid) => {
          const bodyContent = (
            <div
              className="szx-widget-root"
              style={
                liquid.isRevealLayer && inTauri
                  ? { background: "var(--bg)" }
                  : undefined
              }
            >
              <GlassPanel radius={14} style={{ height: "100%" }}>
        <div className="szx-widget-term">
          {/* Header */}
          <div className="szx-term-header is-locked" style={{ flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: isPlaying ? "var(--accent)" : "var(--ink-dim)",
                  boxShadow: isPlaying ? "0 0 8px var(--accent)" : "none",
                  flexShrink: 0,
                }}
              />
              <span style={{ fontWeight: 700, letterSpacing: "0.04em" }}>SZXmusic</span>
              {clickThrough && (
                <span style={{ color: "var(--accent)", fontSize: 9.5 }}>
                  [ALT]
                </span>
              )}
            </div>

            <div className="szx-no-drag" style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
              {(["S", "M", "L"] as WidgetSize[]).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  className={`szx-size-chip ${widgetSize === sz ? "is-active" : ""}`}
                  onClick={() => setWidgetSize(sz)}
                >
                  {sz}
                </button>
              ))}
              {inTauri && (
                <button
                  type="button"
                  className="szx-widget-btn"
                  style={{
                    width: 20,
                    height: 18,
                    color: clickThrough ? "var(--accent)" : undefined,
                  }}
                  title="鼠标穿透（按 Alt 临时交互）"
                  onClick={() => setClickThrough(!clickThrough)}
                >
                  <MousePointerClick size={11} />
                </button>
              )}
              <button
                type="button"
                className="szx-widget-btn"
                style={{ width: 20, height: 18 }}
                title={liquid.theme === "dark" ? "切换到浅色（液体揭示）" : "切换到深色（液体揭示）"}
                tabIndex={liquid.isRevealLayer ? -1 : undefined}
                onClick={(e) => liquid.toggleTheme(e)}
              >
                {liquid.theme === "dark" ? <Sun size={11} /> : <Moon size={11} />}
              </button>
            </div>
          </div>

          {!bootDone ? (
            <div style={{ flex: 1, padding: "12px 2px", fontSize: 11, color: "var(--ink-dim)" }}>
              <div>&gt; init audio.wasapi_sink ........ [OK]</div>
              {bootStep >= 1 && <div>&gt; mount crate.index ............. [OK]</div>}
              {bootStep >= 2 && (
                <div style={{ color: "var(--accent)" }}>
                  &gt; attach widget.overlay ......... [READY]
                  <span className="szx-cursor" />
                </div>
              )}
            </div>
          ) : widgetSize === "S" ? (
            /* S Size: Ultra-compact single-strip terminal bar */
            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                paddingTop: 4,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {showTrackArtist
                    ? `${currentTrack.title} — ${currentTrack.artist}`
                    : currentTrack.title}
                </div>
                <div style={{ fontSize: 10, color: "var(--accent)", whiteSpace: "nowrap" }}>
                  {miniUnicodeSpec}{" "}
                  <span style={{ color: "var(--ink-dim)" }}>
                    {formatTime(positionSec)}/{formatTime(currentTrack.durationSec)}
                  </span>
                </div>
              </div>

              <div className="szx-no-drag" style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                <button type="button" className="szx-widget-btn" onClick={() => togglePlay()}>
                  {isPlaying ? <Pause size={13} /> : <Play size={13} />}
                </button>
                <button type="button" className="szx-widget-btn" onClick={() => stepTrack(1)}>
                  <SkipForward size={13} />
                </button>
                <button type="button" className="szx-widget-btn" onClick={openMainWindow}>
                  <Home size={13} />
                </button>
              </div>
            </div>
          ) : (
            /* M and L Size Monitor Body */
            <>
              {/* Now Playing Block */}
              <div style={{ paddingTop: 4, paddingBottom: 2, flexShrink: 0, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    fontFamily: "var(--font-sans)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={`${currentTrack.title} — ${currentTrack.artist}`}
                >
                  {showTrackArtist
                    ? `${currentTrack.title} — ${currentTrack.artist}`
                    : currentTrack.title}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--ink-dim)",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    marginTop: 2,
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                    {currentTrack.bvid} · P{currentTrack.page || 1}
                  </span>
                  <span style={{ flexShrink: 0 }}>{currentTrack.qualityLabel}</span>
                </div>
              </div>

              {/* Block Progress Bar (clickable to seek) */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  paddingBottom: 4,
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: 10, minWidth: 26 }}>{pct}%</span>
                <div
                  style={{
                    flex: 1,
                    display: "grid",
                    gridTemplateColumns: `repeat(${totalBlocks}, 1fr)`,
                    gap: 2,
                    cursor: "pointer",
                  }}
                  title="点击跳转播放进度"
                >
                  {Array.from({ length: totalBlocks }, (_, idx) => {
                    const active = idx < filledBlocks;
                    const tip = idx === filledBlocks - 1;
                    return (
                      <span
                        key={idx}
                        onClick={() => {
                          if (currentTrack.durationSec > 0) {
                            seek(((idx + 0.5) / totalBlocks) * currentTrack.durationSec);
                          }
                        }}
                        style={{
                          height: 8,
                          borderRadius: 1.5,
                          background: tip
                            ? "var(--accent)"
                            : active
                              ? theme === "dark"
                                ? "var(--ink)"
                                : "var(--accent)"
                              : "var(--line)",
                        }}
                      />
                    );
                  })}
                </div>
                <span style={{ fontSize: 10, color: "var(--ink-dim)", flexShrink: 0 }}>
                  {formatTime(positionSec)}/{formatTime(currentTrack.durationSec)}
                </span>
              </div>

              {/* SPEC + L/R Meter Grid */}
              <div className="szx-spec-grid" style={{ flexShrink: 0 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 9.5, color: "var(--ink-dim)", marginBottom: 3 }}>
                    SPEC
                  </div>
                  <div className="szx-spec-bars">
                    {spectrum.slice(0, 22).map((val, idx) => {
                      const heightPct = Math.round((val || 0) * 100);
                      const isPeak = val > 0.68;
                      return (
                        <div
                          key={idx}
                          className="szx-spec-bar"
                          style={{
                            height: `${heightPct}%`,
                            background: isPeak
                              ? "linear-gradient(180deg, var(--accent) 0%, var(--accent) 42%, var(--ink) 44%)"
                              : "var(--ink)",
                            opacity: isPlaying ? 0.92 : 0.4,
                          }}
                        />
                      );
                    })}
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, minWidth: 0 }}>
                  <div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 9.5,
                        color: "var(--ink-dim)",
                        marginBottom: 2,
                      }}
                    >
                      <span>L</span>
                      <span>{dbText(levelL)}</span>
                    </div>
                    <div className="szx-meter-track">
                      <div
                        className="szx-meter-fill"
                        style={{
                          width: `${Math.round(Math.min(1, Math.max(0, levelL || 0)) * 100)}%`,
                          background: levelL > 0.78 ? "var(--accent)" : "var(--ink)",
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 9.5,
                        color: "var(--ink-dim)",
                        marginBottom: 2,
                      }}
                    >
                      <span>R</span>
                      <span>{dbText(levelR)}</span>
                    </div>
                    <div className="szx-meter-track">
                      <div
                        className="szx-meter-fill"
                        style={{
                          width: `${Math.round(Math.min(1, Math.max(0, levelR || 0)) * 100)}%`,
                          background: levelR > 0.78 ? "var(--accent)" : "var(--ink)",
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Acoustic Telemetry Line */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "4px 0",
                  borderBottom: "1px solid var(--line)",
                  fontSize: 10,
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
              >
                <span>
                  BPM {currentTrack.bpm || 100} &nbsp;KEY {currentTrack.musicalKey || "C"} &nbsp;NRG{" "}
                  <span style={{ color: "var(--accent)" }}>
                    {"▮".repeat(safeEnergy)}
                  </span>
                  <span style={{ color: "var(--line)" }}>
                    {"▯".repeat(5 - safeEnergy)}
                  </span>
                </span>
                <span style={{ color: "var(--ink-dim)" }}>
                  {mode === "loop:all" ? "顺序" : mode === "loop:one" ? "单曲" : "漫游"}
                </span>
              </div>

              {/* Extra L-size telemetry: Braille history + real-time subtitle box + scrollable queue */}
              {widgetSize === "L" && (
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    padding: "5px 0",
                    borderBottom: "1px solid var(--line)",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: 5,
                    fontSize: 10,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                      minWidth: 0,
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ color: "var(--ink-dim)", flexShrink: 0 }}>HIST</span>
                    <span
                      style={{
                        color: "var(--accent)",
                        letterSpacing: "0.02em",
                        overflow: "hidden",
                        textOverflow: "clip",
                      }}
                    >
                      {brailleHistory}
                    </span>
                  </div>

                  {/* HIST Subtitle / Pure Music Box */}
                  <div
                    style={{
                      padding: "6px 8px",
                      borderRadius: 6,
                      background: "var(--panel)",
                      border: "1px solid var(--line)",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                      minHeight: 40,
                      flexShrink: 0,
                      gap: 2,
                    }}
                  >
                    {lyricsLoading ? (
                      <div style={{ color: "var(--ink-dim)", fontSize: 10.5, textAlign: "center" }}>
                        正在同步字幕轴…
                      </div>
                    ) : activeLyric ? (
                      <>
                        <div
                          style={{
                            color: "var(--ink)",
                            fontSize: 11.5,
                            fontWeight: 600,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={activeLyric.text}
                        >
                          {activeLyric.text}
                        </div>
                        {nextLyric && (
                          <div
                            style={{
                              color: "var(--ink-dim)",
                              fontSize: 10,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={nextLyric.text}
                          >
                            {nextLyric.text}
                          </div>
                        )}
                      </>
                    ) : (
                      <div
                        style={{
                          color: "var(--ink-muted)",
                          fontSize: 11,
                          textAlign: "center",
                          letterSpacing: "0.06em",
                        }}
                      >
                        ♪ 纯音乐
                      </div>
                    )}
                  </div>

                  {/* Scrollable Upcoming Queue starting from current playing track */}
                  <div
                    className="szx-no-drag"
                    onWheel={(e) => e.stopPropagation()}
                    style={{
                      flex: 1,
                      minHeight: 48,
                      maxHeight: 68,
                      overflowY: "auto",
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                      minWidth: 0,
                      paddingRight: 2,
                    }}
                  >
                    {upcomingQueue.length === 0 ? (
                      <div style={{ color: "var(--ink-dim)", fontSize: 10 }}>
                        当前黑胶队列暂无更多曲目
                      </div>
                    ) : (
                      upcomingQueue.map((q, idx) => {
                        const showQArtist =
                          Boolean(q.artist) &&
                          q.artist !== "未知艺人" &&
                          q.artist !== activeCrate?.title;
                        return (
                          <div
                            key={q.id}
                            onClick={() => activeCrate && playTrack(q, activeCrate.id)}
                            title={`${q.title}${showQArtist ? ` — ${q.artist}` : ""}（点击播放）`}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 6,
                              color: "var(--ink-dim)",
                              fontSize: 10,
                              minWidth: 0,
                              cursor: "pointer",
                              flexShrink: 0,
                            }}
                          >
                            <span
                              style={{
                                minWidth: 0,
                                flex: 1,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              +{idx + 1} {showQArtist ? `${q.title} — ${q.artist}` : q.title}
                            </span>
                            <span style={{ flexShrink: 0, color: "var(--accent)" }}>
                              {formatTime(q.durationSec)}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Next Track Recommendation */}
              <div style={{ paddingTop: 3, paddingBottom: 3, flexShrink: 0, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 10.5,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: syncToast ? "var(--accent)" : "var(--ink)",
                  }}
                >
                  {syncToast ? (
                    `SYNC ${syncToast}`
                  ) : (
                    <>
                      <span style={{ color: "var(--ink-dim)" }}>NEXT </span>
                      {nextTrack.title}
                    </>
                  )}
                </div>
              </div>

              {/* Footer Transport */}
              <div
                className="szx-no-drag"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-around",
                  paddingTop: 3,
                  borderTop: "1px solid var(--line)",
                  flexShrink: 0,
                }}
              >
                <button
                  type="button"
                  className="szx-widget-btn"
                  title="上一首"
                  onClick={() => stepTrack(-1)}
                >
                  <SkipBack size={14} />
                </button>
                <button
                  type="button"
                  className="szx-widget-btn"
                  title={isPlaying ? "暂停" : "播放"}
                  onClick={() => togglePlay()}
                  style={{ color: "var(--accent)" }}
                >
                  {isPlaying ? <Pause size={15} /> : <Play size={15} />}
                </button>
                <button
                  type="button"
                  className="szx-widget-btn"
                  title="下一首"
                  onClick={() => stepTrack(1)}
                >
                  <SkipForward size={14} />
                </button>
                <button
                  type="button"
                  className="szx-widget-btn"
                  title="喜欢"
                  onClick={() => toggleLike(currentTrack.id)}
                  style={{ color: isLiked ? "var(--accent)" : undefined }}
                >
                  <Heart size={14} fill={isLiked ? "currentColor" : "none"} />
                </button>
                <button
                  type="button"
                  className="szx-widget-btn"
                  title="打开 SZXmusic 主界面"
                  onClick={openMainWindow}
                >
                  <Home size={14} />
                </button>
              </div>
            </>
          )}
        </div>
      </GlassPanel>
    </div>
          );

          if (!inTauri) {
            return (
              <div
                className="szx-browser-stage"
                data-theme={liquid.theme as ThemeMode}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 20,
                }}
              >
                <div
                  style={{
                    width: widgetSize === "S" ? 340 : widgetSize === "L" ? 368 : 356,
                    height: widgetSize === "S" ? 92 : widgetSize === "L" ? 468 : 336,
                  }}
                >
                  {bodyContent}
                </div>
              </div>
            );
          }

          return bodyContent;
        }}
      </LiquidThemeStage>
    </>
  );
}
