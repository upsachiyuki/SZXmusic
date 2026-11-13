import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Copy,
  ExternalLink,
  Layers,
  ListChecks,
  Minus,
  Moon,
  Radio,
  RefreshCw,
  Search,
  Settings,
  Square,
  Sun,
  User,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { GlassPanel } from "@shared/glass/GlassPanel";
import { RefractionFilterDefs } from "@shared/glass/RefractionFilter";
import { LiquidThemeStage } from "@shared/liquid-theme";
import {
  isTauriRuntime,
  invokeCore,
  listenAppEvent,
  type QrLoginStart,
  type SyncProgressEvent,
  type SyncResult,
  type ThemeMode,
  type WidgetAnchor,
  type WidgetSize,
} from "@shared/ipc/tauriBridge";
import {
  subscribeBrowserSync,
  usePlayerStore,
  type SyncStatePayload,
} from "@shared/state/playerStore";
import { VinylCrate } from "./components/VinylCrate";
import { TurntablePanel } from "./components/TurntablePanel";
import { TrackDetailView, type DetailViewMode } from "./components/TrackDetailView";
import {
  ContextMenuOverlay,
  CrateActionModal,
  type ContextMenuTarget,
  type CrateModalState,
} from "./components/CrateAndContextMenu";
import {
  AccountSyncDrawer,
  PendingParserDrawer,
  SearchResultsDrawer,
  type PendingDraft,
} from "./components/BiliDrawers";

type ActiveDrawer = null | "pending" | "settings" | "account" | "search";

const DRAWER_TITLES: Record<Exclude<ActiveDrawer, null>, string> = {
  account: "B站账号与收藏夹增量同步",
  search: "B站全站搜歌 · BV在线点播",
  pending: "待确认解析队列 & 正则调试",
  settings: "挂件与音频实验设置",
};

export function App() {
  const {
    theme,
    librarySource,
    crates,
    activeCrateId,
    currentTrack,
    isPlaying,
    positionSec,
    volume,
    muted,
    mode,
    preferredQuality,
    availableQualities,
    crateGlassBlur,
    likedIds,
    widgetSize,
    widgetAnchor,
    clickThrough,
    alwaysOnTop,
    autostart,
    registryStatus,
    streamStatus,
    biliUser,
    biliLoadedCount,
    lastSyncAt,
    syncing,
    syncProgress,
    syncStatusText,
    syncIntervalMin,
    pendingItems,
    searchResults,
    searching,
    customRules,
    setTheme,
    selectCrate,
    switchLibrarySource,
    playTrack,
    togglePlay,
    seek,
    setVolume,
    toggleMute,
    setPreferredQuality,
    setCrateGlassBlur,
    stepTrack,
    onLiveTrackEnded,
    cycleMode,
    toggleLike,
    setWidgetSize,
    setWidgetAnchor,
    setClickThrough,
    setAlwaysOnTop,
    setAutostart,
    registerWindowsApp,
    unregisterWindowsApp,
    tickSimulation,
    applyLiveTelemetry,
    applyRemoteSync,
    applyLibrarySnapshot,
    playRealBiliStream,
    initBiliWorkspace,
    startQrLogin,
    pollQrLogin,
    logoutBili,
    syncFavorites,
    setSyncProgress,
    setSyncIntervalMin,
    searchBili,
    playOnlineBili,
    fetchRelatedCrate,
    fetchTrackLyrics,
    confirmPendingTrack,
    dismissPendingTrack,
    dismissAllPendingTracks,
    confirmAllPendingTracks,
    addCustomRule,
    deleteCustomRule,
    testTitleParser,
    createCrate,
    renameCrate,
    deleteCrate,
    addTrackToCrate,
    removeTrackFromCrate,
    transferTracksToCrate,
    createCrateWithTracks,
  } = usePlayerStore();

  const [query, setQuery] = useState("");
  const [searchDrawerInput, setSearchDrawerInput] = useState("");
  const [drawer, setDrawer] = useState<ActiveDrawer>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailMode, setDetailMode] = useState<DetailViewMode>("sub");
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null);
  const [crateModal, setCrateModal] = useState<CrateModalState>(null);
  const [pendingDrafts, setPendingDrafts] = useState<Record<string, PendingDraft>>({});
  const [probeBvid, setProbeBvid] = useState("BV1GJ411x7h7");
  const [crateRowOffset, setCrateRowOffset] = useState(0);
  const [isDraggingWindow, setIsDraggingWindow] = useState(false);

  const [qrData, setQrData] = useState<QrLoginStart | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrStatusText, setQrStatusText] = useState("");
  const [isMaximized, setIsMaximized] = useState(false);
  const [registryMsg, setRegistryMsg] = useState("");

  const inTauri = isTauriRuntime();

  const refreshQrCode = useCallback(async () => {
    if (!inTauri) return;
    setQrLoading(true);
    setQrStatusText("正在向 B 站申请登录二维码…");
    try {
      const data = await startQrLogin();
      setQrData(data);
      setQrStatusText(data ? "请使用哔哩哔哩手机端扫描下方二维码" : "");
    } catch (err) {
      setQrStatusText(`二维码获取失败: ${String(err)}`);
    } finally {
      setQrLoading(false);
    }
  }, [inTauri, startQrLogin]);

  // Auto-generate QR code when opening account drawer while signed out
  useEffect(() => {
    if (drawer === "account" && inTauri && !biliUser?.is_login && !qrData && !qrLoading) {
      void refreshQrCode();
    }
  }, [biliUser?.is_login, drawer, inTauri, qrData, qrLoading, refreshQrCode]);

  // Poll Passport QR code at top level so dual-layer LiquidThemeStage never duplicates timers
  useEffect(() => {
    if (drawer !== "account" || !inTauri || !qrData || biliUser?.is_login) return;
    let active = true;
    const timer = window.setInterval(async () => {
      if (!active) return;
      try {
        const res = await pollQrLogin(qrData.qrcode_key);
        if (!res || !active) return;
        const [poll] = res;
        if (poll.status === "waiting") {
          setQrStatusText("等待扫码（约 3 分钟内有效）…");
        } else if (poll.status === "scanned") {
          setQrStatusText("已扫码！请在手机端点击「确认登录」");
        } else if (poll.status === "expired") {
          setQrStatusText("二维码已过期，请点击右上角「刷新二维码」");
          setQrData(null);
        } else if (poll.status === "confirmed") {
          setQrStatusText("登录成功，凭据已使用 Windows DPAPI 加密保存");
          setQrData(null);
        } else {
          setQrStatusText(poll.message);
        }
      } catch (err) {
        if (active) setQrStatusText(`轮询异常: ${String(err)}`);
      }
    }, 1500);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [biliUser?.is_login, drawer, inTauri, pollQrLogin, qrData]);

  // Simulation heartbeat when playing and not streaming live audio from Rust
  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setInterval(() => tickSimulation(0.15), 150);
    return () => window.clearInterval(id);
  }, [isPlaying, tickSimulation]);

  // Initialize Bilibili workspace + Cross-window sync & Rust events
  useEffect(() => {
    void initBiliWorkspace();

    const unsubBrowser = subscribeBrowserSync();
    let unsubSync: (() => void) | undefined;
    let unsubTelemetry: (() => void) | undefined;
    let unsubImportProgress: (() => void) | undefined;
    let unsubLibSynced: (() => void) | undefined;
    let unsubTrackEnded: (() => void) | undefined;
    let unsubMaximized: (() => void) | undefined;

    if (isTauriRuntime()) {
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().isMaximized())
        .then((max) => setIsMaximized(Boolean(max)))
        .catch(() => {});
    }

    void listenAppEvent<boolean>("szx://window-maximized", (max) => {
      setIsMaximized(Boolean(max));
    }).then((fn) => {
      unsubMaximized = fn;
    });

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
    }>("player://telemetry", (payload) => {
      applyLiveTelemetry(payload);
    }).then((fn) => {
      unsubTelemetry = fn;
    });

    void listenAppEvent<SyncProgressEvent>("import://progress", (ev) => {
      setSyncProgress(ev);
    }).then((fn) => {
      unsubImportProgress = fn;
    });

    void listenAppEvent<SyncResult>("szx://library-synced", (res) => {
      applyLibrarySnapshot(res.snapshot, true);
      setSyncProgress(null);
    }).then((fn) => {
      unsubLibSynced = fn;
    });

    void listenAppEvent("player://track-ended", () => {
      onLiveTrackEnded();
    }).then((fn) => {
      unsubTrackEnded = fn;
    });

    return () => {
      unsubBrowser();
      unsubSync?.();
      unsubTelemetry?.();
      unsubImportProgress?.();
      unsubLibSynced?.();
      unsubTrackEnded?.();
      unsubMaximized?.();
    };
  }, [
    applyLibrarySnapshot,
    applyLiveTelemetry,
    applyRemoteSync,
    initBiliWorkspace,
    onLiveTrackEnded,
    setSyncProgress,
  ]);

  const filteredCrates = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return crates;
    return crates.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.tracks.some(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.artist.toLowerCase().includes(q) ||
            t.bvid.toLowerCase().includes(q)
        )
    );
  }, [crates, query]);

  const activeCrate =
    crates.find((c) => c.id === activeCrateId) ??
    filteredCrates[0] ??
    crates[0] ?? {
      id: "fallback-crate",
      title: "默认黑胶",
      subtitle: "",
      kind: "custom" as const,
      sortKey: "A",
      covers: [""],
      tracks: [currentTrack],
    };

  const handleToggleWidgetWindow = async () => {
    if (inTauri) {
      await invokeCore("win_toggle_widget");
    } else {
      window.open("/widget.html", "szx-widget", "width=380,height=390");
    }
  };

  const handleWindowMouseDown = async (e: React.MouseEvent<HTMLElement>) => {
    if (!inTauri || e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".szx-no-drag, button, input, select, a, label")) return;
    setIsDraggingWindow(true);
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().startDragging();
    } finally {
      setIsDraggingWindow(false);
    }
  };

  // Global keyboard shortcuts (Space, Left/Right, Ctrl+Left/Right, Up/Down, M, L, Esc)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

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
      } else if (e.key.toLowerCase() === "m" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggleMute();
      } else if (e.key.toLowerCase() === "l" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggleLike(currentTrack.id);
      } else if (e.key === "Escape") {
        if (drawer) {
          setDrawer(null);
        } else if (detailOpen) {
          setDetailOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    currentTrack.durationSec,
    currentTrack.id,
    detailOpen,
    drawer,
    positionSec,
    seek,
    setVolume,
    stepTrack,
    toggleLike,
    toggleMute,
    togglePlay,
    volume,
  ]);

  const handleMinimizeMain = async () => {
    if (!inTauri) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch {
      await invokeCore("win_minimize_main");
    }
  };

  const handleToggleMaximizeMain = async () => {
    if (!inTauri) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      await win.toggleMaximize();
      const max = await win.isMaximized();
      setIsMaximized(Boolean(max));
    } catch {
      const max = await invokeCore<boolean>("win_toggle_maximize_main");
      if (typeof max === "boolean") setIsMaximized(max);
    }
  };

  const handleCloseMain = async () => {
    if (inTauri) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().hide();
    }
  };

  return (
    <>
      {/* Keep shared SVG filter defs mounted once at root to guarantee zero duplicate IDs */}
      <RefractionFilterDefs />

      <LiquidThemeStage
        theme={theme as ThemeMode}
        onThemeChange={(next) => setTheme(next, true)}
        durationMs={1150}
        layoutMode="fixed-app"
      >
        {(liquid) => {
          const shellContent = (
            <div
              className="szx-main-shell"
              style={
                inTauri && liquid.isRevealLayer
                  ? { background: "var(--bg)", borderRadius: isMaximized ? 0 : 16 }
                  : undefined
              }
            >
              <GlassPanel
                radius={isMaximized ? 0 : 16}
                isDragging={isDraggingWindow}
                style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}
              >
                {/* Top Bar */}
                <header
                  className="szx-topbar"
                  onMouseDown={handleWindowMouseDown}
                  onDoubleClick={(e) => {
                    if (!(e.target as HTMLElement).closest(".szx-no-drag, button, input, select, a, label")) {
                      void handleToggleMaximizeMain();
                    }
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span
                      className="szx-serif"
                      style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.02em" }}
                    >
                      SZXmusic
                    </span>
                  </div>

                  <label className="szx-search-pill szx-no-drag">
                    <Search size={14} />
                    <input
                      type="text"
                      value={query}
                      readOnly={liquid.isRevealLayer}
                      tabIndex={liquid.isRevealLayer ? -1 : undefined}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setCrateRowOffset(0);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && query.trim()) {
                          setSearchDrawerInput(query.trim());
                          setDrawer("search");
                          void searchBili(query.trim());
                        }
                      }}
                      placeholder="搜索曲库或粘贴 BV 号…"
                    />
                    {query && (
                      <button
                        type="button"
                        onClick={() => {
                          setQuery("");
                          setCrateRowOffset(0);
                        }}
                        style={{
                          border: "none",
                          background: "transparent",
                          color: "var(--ink-dim)",
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        <X size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="szx-mono"
                      onClick={() => {
                        const kw = (query || searchDrawerInput).trim();
                        setSearchDrawerInput(kw);
                        setDrawer("search");
                        if (kw) void searchBili(kw);
                      }}
                      style={{
                        border: "none",
                        borderLeft: "1px solid var(--line)",
                        paddingLeft: 8,
                        background: "transparent",
                        color: "var(--accent)",
                        fontSize: 10.5,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      搜B站
                    </button>
                  </label>

                  <div className="szx-no-drag" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      type="button"
                      className="szx-icon-btn"
                      onClick={() => setDrawer((d) => (d === "account" ? null : "account"))}
                      title={
                        biliUser?.is_login
                          ? `B站账号：${biliUser.uname} (UID ${biliUser.mid})`
                          : "扫码登录 B 站并同步收藏夹"
                      }
                      style={{
                        borderColor: biliUser?.is_login ? "var(--accent)" : undefined,
                        gap: 6,
                      }}
                    >
                      {biliUser?.is_login && biliUser.face ? (
                        <img
                          src={biliUser.face}
                          alt={biliUser.uname}
                          referrerPolicy="no-referrer"
                          style={{
                            width: 17,
                            height: 17,
                            borderRadius: "50%",
                            objectFit: "cover",
                          }}
                        />
                      ) : (
                        <User size={13} />
                      )}
                      <span
                        style={{
                          maxWidth: 70,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {biliUser?.is_login ? biliUser.uname : "登录B站"}
                      </span>
                    </button>

                    <button
                      type="button"
                      className="szx-icon-btn"
                      onClick={() => {
                        if (biliUser?.is_login) {
                          void syncFavorites(false);
                        } else {
                          setDrawer("account");
                        }
                      }}
                      disabled={syncing}
                      title={syncStatusText || "增量同步 B 站收藏夹"}
                    >
                      <RefreshCw size={13} />
                    </button>

                    <button
                      type="button"
                      className="szx-icon-btn"
                      onClick={() => setDrawer((d) => (d === "pending" ? null : "pending"))}
                    >
                      <ListChecks size={14} />
                      <span>待确认</span>
                      {pendingItems.length > 0 && (
                        <span className="szx-badge-dot">{pendingItems.length}</span>
                      )}
                    </button>

                    <button
                      type="button"
                      className="szx-icon-btn"
                      onClick={handleToggleWidgetWindow}
                      title="打开/切换桌面终端挂件"
                    >
                      <Layers size={14} />
                      <span>挂件</span>
                    </button>

                    <button
                      type="button"
                      className="szx-icon-btn"
                      onClick={() => setDrawer((d) => (d === "settings" ? null : "settings"))}
                      title="设置"
                    >
                      <Settings size={14} />
                    </button>

                    <button
                      type="button"
                      className="szx-icon-btn"
                      onClick={(e) => liquid.toggleTheme(e)}
                      aria-label={`切换至${liquid.theme === "dark" ? "浅色米白" : "深色黑橙"}`}
                      title={`切换至${liquid.theme === "dark" ? "浅色米白" : "深色黑橙"}`}
                    >
                      {liquid.theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
                    </button>

                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 2,
                        marginLeft: 2,
                        paddingLeft: 6,
                        borderLeft: "1px solid var(--line)",
                      }}
                    >
                      <button
                        type="button"
                        className="szx-icon-btn"
                        onClick={handleMinimizeMain}
                        title="最小化窗口"
                        aria-label="最小化窗口"
                        style={{ minWidth: 30, padding: 0 }}
                      >
                        <Minus size={14} strokeWidth={2.2} />
                      </button>
                      <button
                        type="button"
                        className="szx-icon-btn"
                        onClick={handleToggleMaximizeMain}
                        title={isMaximized ? "还原窗口" : "最大化窗口"}
                        aria-label={isMaximized ? "还原窗口" : "最大化窗口"}
                        style={{ minWidth: 30, padding: 0 }}
                      >
                        {isMaximized ? (
                          <Copy size={11} strokeWidth={2.2} style={{ transform: "scaleX(-1)" }} />
                        ) : (
                          <Square size={12} strokeWidth={2.2} />
                        )}
                      </button>
                      <button
                        type="button"
                        className="szx-icon-btn"
                        onClick={handleCloseMain}
                        title="关闭主界面（收起到桌面挂件）"
                        aria-label="关闭窗口"
                        style={{ minWidth: 30, padding: 0 }}
                      >
                        <X size={15} strokeWidth={2.2} />
                      </button>
                    </div>
                  </div>
                </header>

                {/* Main Split Content */}
                <main
                  style={{ flex: 1, minHeight: 0, display: "flex", position: "relative" }}
                  onContextMenu={(e) => {
                    if (e.defaultPrevented) return;
                    e.preventDefault();
                    setContextMenu({ kind: "global", x: e.clientX, y: e.clientY });
                  }}
                >
                  {detailOpen ? (
                    <TrackDetailView
                      track={currentTrack}
                      positionSec={positionSec}
                      isLiked={likedIds.includes(currentTrack.id)}
                      inTauri={inTauri}
                      mode={detailMode}
                      onChangeMode={setDetailMode}
                      onClose={() => setDetailOpen(false)}
                      onSeek={(s) => seek(s)}
                      onToggleLike={() => toggleLike(currentTrack.id)}
                      onSelectPageCid={(bvid, cid, partTitle) => {
                        const existingRow = activeCrate.tracks.find(
                          (t) => t.bvid === bvid && t.cid === cid
                        );
                        if (existingRow) {
                          playTrack(existingRow, activeCrate.id);
                          return;
                        }
                        const matchedPage = currentTrack.pages?.find((p) => p.cid === cid);
                        const pageCover = matchedPage?.first_frame || currentTrack.coverUrl;
                        void playRealBiliStream(
                          bvid,
                          cid,
                          partTitle || currentTrack.title,
                          currentTrack.artist,
                          pageCover,
                          currentTrack.id
                        );
                      }}
                      fetchTrackLyrics={fetchTrackLyrics}
                    />
                  ) : (
                    <VinylCrate
                      crates={filteredCrates}
                      activeCrateId={activeCrate.id}
                      rowOffset={crateRowOffset}
                      glassBlurPx={crateGlassBlur}
                      onRowOffsetChange={setCrateRowOffset}
                      onSelectCrate={(crate) => {
                        selectCrate(crate.id);
                        if (crate.tracks[0]) {
                          playTrack(crate.tracks[0], crate.id);
                        }
                      }}
                      onRequestCreateCrate={() => setCrateModal({ mode: "create" })}
                      onRequestRenameCrate={(crate) =>
                        setCrateModal({ mode: "rename", crate })
                      }
                      onRequestDeleteCrate={(crate) => {
                        if (crates.length > 1) {
                          void deleteCrate(crate.id);
                        }
                      }}
                      onCrateContextMenu={(e, crate) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setContextMenu({
                          kind: "crate",
                          x: e.clientX,
                          y: e.clientY,
                          crate,
                        });
                      }}
                    />
                  )}

                  <TurntablePanel
                    crate={activeCrate}
                    cratesCount={crates.length}
                    currentTrack={currentTrack}
                    isPlaying={isPlaying}
                    positionSec={positionSec}
                    volume={volume}
                    muted={muted}
                    mode={mode}
                    preferredQuality={preferredQuality}
                    availableQualities={availableQualities}
                    streamStatus={streamStatus}
                    detailOpen={detailOpen}
                    detailMode={detailMode}
                    isRevealLayer={liquid.isRevealLayer}
                    onTogglePlay={() => togglePlay()}
                    onPrev={() => stepTrack(-1)}
                    onNext={() => stepTrack(1)}
                    onCycleMode={cycleMode}
                    onSelectTrack={(trk) => playTrack(trk, activeCrate.id)}
                    onSeek={(s) => seek(s)}
                    onSetVolume={setVolume}
                    onToggleMute={toggleMute}
                    onChangeQuality={setPreferredQuality}
                    onToggleDetail={() => setDetailOpen((v) => !v)}
                    onOpenDetailMode={(m) => {
                      setDetailMode(m);
                      setDetailOpen(true);
                    }}
                    onRequestRenameCrate={(crate) =>
                      setCrateModal({ mode: "rename", crate })
                    }
                    onRequestDeleteCrate={(crate) => {
                      if (crates.length > 1) {
                        void deleteCrate(crate.id);
                      }
                    }}
                    onRequestAddTrack={(crate) =>
                      setCrateModal({ mode: "add-track", crate })
                    }
                    onRequestTransferTracks={(crate) =>
                      setCrateModal({ mode: "transfer", crate })
                    }
                    onRemoveTrackFromCrate={(crateId, trackId) =>
                      void removeTrackFromCrate(crateId, trackId)
                    }
                    onTrackContextMenu={(e, track, crate) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({
                        kind: "track",
                        x: e.clientX,
                        y: e.clientY,
                        track,
                        crate,
                      });
                    }}
                    onTurntableContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({
                        kind: "turntable",
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                    onVerifyLiveStream={(trk) =>
                      void playRealBiliStream(
                        trk.bvid,
                        trk.cid,
                        trk.title,
                        trk.artist,
                        trk.coverUrl,
                        trk.id
                      )
                    }
                    onFetchRelated={(bvid, seedTitle) => void fetchRelatedCrate(bvid, seedTitle)}
                  />

                  {/* Slide-over Glass Drawer: Account / Search / Pending+Rules / Settings */}
                  {drawer && (
                    <div
                      style={{
                        position: "absolute",
                        top: 12,
                        right: 12,
                        bottom: 12,
                        width: 400,
                        zIndex: 50,
                      }}
                    >
                      <GlassPanel dense radius={14} style={{ width: "100%", height: "100%" }}>
                        <div
                          style={{
                            height: "100%",
                            display: "flex",
                            flexDirection: "column",
                            padding: 16,
                            gap: 12,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              borderBottom: "1px solid var(--line)",
                              paddingBottom: 10,
                            }}
                          >
                            <strong className="szx-serif" style={{ fontSize: 15 }}>
                              {DRAWER_TITLES[drawer]}
                            </strong>
                            <button
                              type="button"
                              className="szx-icon-btn"
                              onClick={() => setDrawer(null)}
                              style={{ height: 26, minWidth: 26, padding: 0 }}
                            >
                              <X size={13} />
                            </button>
                          </div>

                          <div
                            data-liquid-scroll="drawer"
                            style={{
                              flex: 1,
                              overflowY: "auto",
                              display: "flex",
                              flexDirection: "column",
                              gap: 10,
                            }}
                          >
                            {drawer === "account" ? (
                              <AccountSyncDrawer
                                user={biliUser}
                                qrData={qrData}
                                qrStatusText={qrStatusText}
                                qrLoading={qrLoading}
                                syncing={syncing}
                                syncProgress={syncProgress}
                                syncStatusText={syncStatusText}
                                lastSyncAt={lastSyncAt}
                                librarySource={librarySource}
                                biliLoadedCount={biliLoadedCount}
                                syncIntervalMin={syncIntervalMin}
                                inTauri={inTauri}
                                isRevealLayer={liquid.isRevealLayer}
                                onRefreshQr={() => void refreshQrCode()}
                                onLogout={() => void logoutBili()}
                                onSync={(force) => void syncFavorites(force)}
                                onSwitchSource={switchLibrarySource}
                                onChangeSyncInterval={(min) => void setSyncIntervalMin(min)}
                              />
                            ) : drawer === "search" ? (
                              <SearchResultsDrawer
                                searchInput={searchDrawerInput}
                                results={searchResults}
                                searching={searching}
                                inTauri={inTauri}
                                isRevealLayer={liquid.isRevealLayer}
                                onChangeInput={setSearchDrawerInput}
                                onSearch={(kw) => void searchBili(kw)}
                                onPlayOnline={(input) => void playOnlineBili(input)}
                                onFetchRelated={(bvid, title) => void fetchRelatedCrate(bvid, title)}
                              />
                            ) : drawer === "pending" ? (
                              <PendingParserDrawer
                                items={pendingItems}
                                drafts={pendingDrafts}
                                customRules={customRules}
                                inTauri={inTauri}
                                isRevealLayer={liquid.isRevealLayer}
                                onDraftChange={(id, patch) =>
                                  setPendingDrafts((prev) => {
                                    const target = pendingItems.find((p) => p.id === id);
                                    const base: PendingDraft = prev[id] ?? {
                                      title: target?.suggestedTitle ?? "",
                                      artist: target?.suggestedArtist ?? "",
                                      version: target?.version ?? "",
                                    };
                                    return { ...prev, [id]: { ...base, ...patch } };
                                  })
                                }
                                onConfirm={(item, draft) =>
                                  void confirmPendingTrack(
                                    item.id,
                                    draft.title || item.suggestedTitle,
                                    draft.artist || item.suggestedArtist,
                                    draft.version
                                  )
                                }
                                onDismiss={(id) => void dismissPendingTrack(id)}
                                onDismissAll={() => void dismissAllPendingTracks()}
                                onConfirmAll={() => void confirmAllPendingTracks()}
                                onTestParser={(raw, owner, mid, pat) =>
                                  testTitleParser(raw, owner, mid, "音乐综合", "", pat)
                                }
                                onAddRule={(mid, pat, pri, desc) =>
                                  addCustomRule(mid, pat, pri, desc)
                                }
                                onDeleteRule={(id) => void deleteCustomRule(id)}
                              />
                            ) : (
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 14,
                                  fontSize: 12,
                                }}
                              >
                              <div>
                                <div
                                  className="szx-mono"
                                  style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 6 }}
                                >
                                  挂件尺寸
                                </div>
                                <div style={{ display: "flex", gap: 8 }}>
                                  {(["S", "M", "L"] as WidgetSize[]).map((sz) => (
                                    <button
                                      key={sz}
                                      type="button"
                                      className="szx-icon-btn szx-mono"
                                      onClick={() => setWidgetSize(sz)}
                                      style={{
                                        flex: 1,
                                        borderColor:
                                          widgetSize === sz
                                            ? "var(--accent)"
                                            : "var(--glass-border)",
                                        background:
                                          widgetSize === sz ? "var(--accent-soft)" : "var(--panel)",
                                      }}
                                    >
                                      {sz}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div>
                                <div
                                  className="szx-mono"
                                  style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 6 }}
                                >
                                  桌面壁纸挂件方位
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                                  {(
                                    [
                                      { key: "top-right", label: "右上角" },
                                      { key: "bottom-right", label: "右下角" },
                                      { key: "top-left", label: "左上角" },
                                      { key: "bottom-left", label: "左下角" },
                                    ] as { key: WidgetAnchor; label: string }[]
                                  ).map((item) => (
                                    <button
                                      key={item.key}
                                      type="button"
                                      className="szx-icon-btn szx-mono"
                                      onClick={() => setWidgetAnchor(item.key)}
                                      style={{
                                        fontSize: 10.5,
                                        borderColor:
                                          widgetAnchor === item.key
                                            ? "var(--accent)"
                                            : "var(--glass-border)",
                                        background:
                                          widgetAnchor === item.key
                                            ? "var(--accent-soft)"
                                            : "var(--panel)",
                                      }}
                                    >
                                      {item.label}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <ToggleRow
                                label="脱离壁纸层置顶悬浮"
                                checked={alwaysOnTop}
                                onChange={setAlwaysOnTop}
                              />
                              <ToggleRow
                                label="鼠标穿透（按住 Alt 键恢复点击）"
                                checked={clickThrough}
                                onChange={setClickThrough}
                              />
                              <ToggleRow
                                label="开机自启动"
                                checked={autostart}
                                onChange={setAutostart}
                              />

                              {/* Windows Registry App Paths & Custom URL Protocol Integration */}
                              <div
                                style={{
                                  padding: "9px 10px",
                                  borderRadius: 9,
                                  background: "var(--panel)",
                                  border: "1px solid var(--line)",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 7,
                                }}
                              >
                                <div
                                  className="szx-mono"
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    fontSize: 11,
                                    color: "var(--accent)",
                                  }}
                                >
                                  <span>Windows 注册表集成</span>
                                  <span style={{ fontSize: 10, color: "var(--ink-dim)" }}>
                                    {registryStatus?.appRegistered && registryStatus?.protocolRegistered
                                      ? "已注册 (HKCU)"
                                      : inTauri
                                        ? "未完整注册"
                                        : "浏览器预览"}
                                  </span>
                                </div>
                                <div
                                  className="szx-mono"
                                  style={{ fontSize: 10, color: "var(--ink-dim)", lineHeight: 1.5 }}
                                >
                                  App Paths: {registryStatus?.appPathsRegistered ? "✓" : "×"} ·
                                  {" "}szxmusic:// 协议: {registryStatus?.protocolRegistered ? "✓" : "×"} ·
                                  {" "}应用项: {registryStatus?.appRegistered ? "✓" : "×"}
                                </div>
                                <div style={{ display: "flex", gap: 6 }}>
                                  <button
                                    type="button"
                                    className="szx-icon-btn szx-mono"
                                    disabled={!inTauri}
                                    onClick={() => {
                                      void registerWindowsApp()
                                        .then((st) => {
                                          if (st) setRegistryMsg("✓ 已写入 Windows 用户注册表（App Paths / szxmusic://）");
                                        })
                                        .catch((err) => setRegistryMsg(`注册失败: ${String(err)}`));
                                    }}
                                    style={{ flex: 1, height: 26, fontSize: 10.5, borderColor: "var(--accent)" }}
                                  >
                                    写入 / 修复注册表
                                  </button>
                                  <button
                                    type="button"
                                    className="szx-icon-btn szx-mono"
                                    disabled={!inTauri}
                                    onClick={() => {
                                      void unregisterWindowsApp()
                                        .then(() => setRegistryMsg("已清理用户注册表项与自启配置"))
                                        .catch((err) => setRegistryMsg(`清理失败: ${String(err)}`));
                                    }}
                                    style={{ height: 26, fontSize: 10.5, padding: "0 9px" }}
                                  >
                                    清理注销
                                  </button>
                                </div>
                                {registryMsg && (
                                  <div className="szx-mono" style={{ fontSize: 10, color: "var(--accent)" }}>
                                    {registryMsg}
                                  </div>
                                )}
                              </div>

                              {/* Front Glass Blur & Stream Quality Settings */}
                              <div
                                style={{
                                  paddingTop: 10,
                                  borderTop: "1px solid var(--line)",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 10,
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 10,
                                  }}
                                >
                                  <span style={{ color: "var(--ink-muted)", fontSize: 11.5 }}>
                                    唱片箱前挡玻璃模糊度
                                  </span>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <input
                                      type="range"
                                      min={0}
                                      max={24}
                                      step={1}
                                      value={crateGlassBlur}
                                      readOnly={liquid.isRevealLayer}
                                      tabIndex={liquid.isRevealLayer ? -1 : undefined}
                                      onChange={(e) => setCrateGlassBlur(Number(e.target.value))}
                                      style={{
                                        width: 115,
                                        accentColor: "var(--accent)",
                                        cursor: "pointer",
                                      }}
                                    />
                                    <span
                                      className="szx-mono"
                                      style={{ width: 34, fontSize: 10, textAlign: "right" }}
                                    >
                                      {crateGlassBlur}px
                                    </span>
                                  </div>
                                </div>

                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 10,
                                  }}
                                >
                                  <span style={{ color: "var(--ink-muted)", fontSize: 11.5 }}>
                                    默认流媒体音质
                                  </span>
                                  <select
                                    className="szx-mono"
                                    value={preferredQuality}
                                    disabled={liquid.isRevealLayer}
                                    tabIndex={liquid.isRevealLayer ? -1 : undefined}
                                    onChange={(e) => setPreferredQuality(Number(e.target.value))}
                                    style={{
                                      height: 26,
                                      borderRadius: 6,
                                      border: "1px solid var(--glass-border)",
                                      background: "var(--panel)",
                                      color: "var(--ink)",
                                      padding: "0 8px",
                                      fontSize: 10.5,
                                    }}
                                  >
                                    <option value={0}>自动最高音质</option>
                                    <option value={30251}>Hi-Res 无损 FLAC</option>
                                    <option value={30250}>杜比全景声 Dolby</option>
                                    <option value={30280}>192K 高码率 AAC</option>
                                    <option value={30232}>132K 标准 AAC</option>
                                    <option value={30216}>64K 流畅省流 AAC</option>
                                  </select>
                                </div>

                                <div
                                  style={{
                                    padding: "8px 10px",
                                    borderRadius: 8,
                                    background: "var(--panel)",
                                    border: "1px solid var(--line)",
                                    fontSize: 10.5,
                                    color: "var(--ink-dim)",
                                    lineHeight: 1.55,
                                  }}
                                >
                                  <strong style={{ color: "var(--ink)" }}>快捷键：</strong>
                                  <div className="szx-mono" style={{ marginTop: 3 }}>
                                    Space 播放/暂停 · ←/→ 快退/快进5秒 · Ctrl+←/→ 切歌 · ↑/↓ 音量±5% · M 静音 · L 红心 · Esc 关闭面板
                                  </div>
                                </div>
                              </div>

                              {/* Liquid Theme Reveal Sound Settings */}
                              <div
                                style={{
                                  paddingTop: 10,
                                  borderTop: "1px solid var(--line)",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 8,
                                }}
                              >
                                <div
                                  className="szx-mono"
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    fontSize: 11,
                                    color: "var(--accent)",
                                  }}
                                >
                                  <span>液体主题切换音效</span>
                                  {liquid.soundEnabled ? (
                                    <Volume2 size={13} />
                                  ) : (
                                    <VolumeX size={13} color="var(--ink-dim)" />
                                  )}
                                </div>

                                <ToggleRow
                                  label="开启液体切换同步音效（默认关闭）"
                                  checked={liquid.soundEnabled}
                                  onChange={liquid.setSoundEnabled}
                                />

                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 10,
                                    padding: "6px 10px",
                                    borderRadius: 8,
                                    background: "var(--panel)",
                                    border: "1px solid var(--line)",
                                  }}
                                >
                                  <span className="szx-mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>
                                    音量
                                  </span>
                                  <input
                                    type="range"
                                    min={0}
                                    max={100}
                                    value={Math.round(liquid.soundVolume * 100)}
                                    onChange={(e) =>
                                      liquid.setSoundVolume(Number(e.target.value) / 100)
                                    }
                                    style={{ flex: 1, accentColor: "var(--accent)" }}
                                  />
                                  <span className="szx-mono" style={{ fontSize: 11, minWidth: 34, textAlign: "right" }}>
                                    {Math.round(liquid.soundVolume * 100)}%
                                  </span>
                                </div>

                                <div style={{ display: "flex", gap: 6 }}>
                                  <button
                                    type="button"
                                    className="szx-icon-btn szx-mono"
                                    onClick={() => liquid.previewSound("to-dark")}
                                    style={{ flex: 1, fontSize: 11 }}
                                  >
                                    试听 浅→深
                                  </button>
                                  <button
                                    type="button"
                                    className="szx-icon-btn szx-mono"
                                    onClick={() => liquid.previewSound("to-light")}
                                    style={{ flex: 1, fontSize: 11 }}
                                  >
                                    试听 深→浅
                                  </button>
                                </div>

                                {!inTauri && (
                                  <a
                                    href="/demo.html"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="szx-icon-btn szx-mono"
                                    style={{ textDecoration: "none", fontSize: 11 }}
                                  >
                                    <ExternalLink size={12} />
                                    打开 Liquid Reveal 独立组件演示页
                                  </a>
                                )}
                              </div>

                              <div
                                style={{
                                  paddingTop: 10,
                                  borderTop: "1px solid var(--line)",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 8,
                                }}
                              >
                                <div
                                  className="szx-mono"
                                  style={{ fontSize: 11, color: "var(--accent)" }}
                                >
                                  M0 实流验证：B站 DASH 音频 + symphonia 解码
                                </div>
                                <div style={{ display: "flex", gap: 6 }}>
                                  <input
                                    type="text"
                                    value={probeBvid}
                                    readOnly={liquid.isRevealLayer}
                                    tabIndex={liquid.isRevealLayer ? -1 : undefined}
                                    onChange={(e) => setProbeBvid(e.target.value)}
                                    placeholder="输入公开 BV 号"
                                    className="szx-mono"
                                    style={{
                                      flex: 1,
                                      padding: "6px 10px",
                                      borderRadius: 8,
                                      border: "1px solid var(--line)",
                                      background: "var(--panel)",
                                      color: "var(--ink)",
                                      fontSize: 12,
                                    }}
                                  />
                                  <button
                                    type="button"
                                    className="szx-icon-btn"
                                    onClick={() => void playRealBiliStream(probeBvid)}
                                    style={{ borderColor: "var(--accent)" }}
                                  >
                                    <Radio size={13} />
                                    拉流播放
                                  </button>
                                </div>
                                <div
                                  className="szx-mono"
                                  style={{ fontSize: 10, color: "var(--ink-dim)" }}
                                >
                                  状态：{streamStatus}
                                </div>
                              </div>
                            </div>
                            )}
                          </div>
                        </div>
                      </GlassPanel>
                    </div>
                  )}

                  {!liquid.isRevealLayer && (
                    <>
                      <ContextMenuOverlay
                        menu={contextMenu}
                        crates={crates}
                        currentTrack={currentTrack}
                        isPlaying={isPlaying}
                        likedIds={likedIds}
                        onClose={() => setContextMenu(null)}
                        onSelectCrate={(crate) => {
                          selectCrate(crate.id);
                          if (crate.tracks[0]) {
                            playTrack(crate.tracks[0], crate.id);
                          }
                        }}
                        onPlayTrack={(track, crateId) => playTrack(track, crateId)}
                        onTogglePlay={() => togglePlay()}
                        onToggleMute={() => toggleMute()}
                        onToggleLike={(trackId) => toggleLike(trackId)}
                        onOpenDetailMode={(m) => {
                          setDetailMode(m);
                          setDetailOpen(true);
                        }}
                        onOpenCrateModal={(state) => setCrateModal(state)}
                        onDeleteCrate={(crateId) => void deleteCrate(crateId)}
                        onAddTrackToCrate={(crateId, track) =>
                          void addTrackToCrate(crateId, track)
                        }
                        onRemoveTrackFromCrate={(crateId, trackId) =>
                          void removeTrackFromCrate(crateId, trackId)
                        }
                        onTransferTracks={(fromCrateId, toCrateId, bvidFilter, moveTracks) =>
                          void transferTracksToCrate(
                            fromCrateId,
                            toCrateId,
                            bvidFilter,
                            moveTracks
                          )
                        }
                        onFetchRelated={(bvid, title) =>
                          void fetchRelatedCrate(bvid, title)
                        }
                        onSyncFavorites={() => void syncFavorites(false)}
                        onToggleWidget={() => void handleToggleWidgetWindow()}
                        onOpenSettings={() => setDrawer("settings")}
                      />

                      <CrateActionModal
                        modal={crateModal}
                        crates={crates}
                        onClose={() => setCrateModal(null)}
                        onCreateCrate={(title, subtitle) =>
                          void createCrate(title, subtitle)
                        }
                        onRenameCrate={(crateId, title, subtitle) =>
                          void renameCrate(crateId, title, subtitle)
                        }
                        onAddTrackToCrate={(crateId, track) =>
                          void addTrackToCrate(crateId, track)
                        }
                        onRemoveTrackFromCrate={(crateId, trackId) =>
                          void removeTrackFromCrate(crateId, trackId)
                        }
                        onTransferTracks={(fromCrateId, toCrateId, bvidFilter, moveTracks) =>
                          void transferTracksToCrate(
                            fromCrateId,
                            toCrateId,
                            bvidFilter,
                            moveTracks
                          )
                        }
                        onCreateCrateWithTracks={(
                          title,
                          subtitle,
                          fromCrateId,
                          bvidFilter,
                          moveTracks
                        ) =>
                          void createCrateWithTracks(
                            title,
                            subtitle,
                            fromCrateId,
                            bvidFilter,
                            moveTracks
                          )
                        }
                        onPlayOnlineBvid={(input) => {
                          void playOnlineBili(input);
                        }}
                      />
                    </>
                  )}
                </main>
              </GlassPanel>
            </div>
          );

          if (!inTauri) {
            return (
              <div className="szx-browser-stage" data-theme={liquid.theme}>
                {shellContent}
              </div>
            );
          }

          return shellContent;
        }}
      </LiquidThemeStage>
    </>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 8,
        background: "var(--panel)",
        border: "1px solid var(--line)",
        cursor: "pointer",
      }}
    >
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: "var(--accent)", width: 15, height: 15 }}
      />
    </label>
  );
}
