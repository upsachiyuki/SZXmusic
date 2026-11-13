import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightLeft,
  Copy,
  Disc,
  Edit3,
  FileText,
  FolderPlus,
  Heart,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { GlassPanel } from "@shared/glass/GlassPanel";
import type { CrateItem, TrackItem } from "@shared/mock/catalog";
import type { DetailViewMode } from "./TrackDetailView";

export type ContextMenuTarget =
  | { kind: "crate"; x: number; y: number; crate: CrateItem }
  | { kind: "track"; x: number; y: number; track: TrackItem; crate: CrateItem }
  | { kind: "turntable"; x: number; y: number }
  | { kind: "global"; x: number; y: number };

export type CrateModalState =
  | null
  | { mode: "create" }
  | { mode: "rename"; crate: CrateItem }
  | { mode: "add-track"; crate: CrateItem }
  | { mode: "transfer"; crate: CrateItem; bvidFilter?: string };

export interface ContextMenuOverlayProps {
  menu: ContextMenuTarget | null;
  crates: CrateItem[];
  currentTrack: TrackItem;
  isPlaying: boolean;
  likedIds: string[];
  onClose: () => void;
  onSelectCrate: (crate: CrateItem) => void;
  onPlayTrack: (track: TrackItem, crateId: string) => void;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onToggleLike: (trackId: string) => void;
  onOpenDetailMode: (mode: DetailViewMode) => void;
  onOpenCrateModal: (state: CrateModalState) => void;
  onDeleteCrate: (crateId: string) => void;
  onAddTrackToCrate: (crateId: string, track: TrackItem) => void;
  onRemoveTrackFromCrate: (crateId: string, trackId: string) => void;
  onTransferTracks?: (
    fromCrateId: string,
    toCrateId: string,
    bvidFilter?: string,
    moveTracks?: boolean
  ) => void;
  onFetchRelated: (bvid: string, title: string) => void;
  onSyncFavorites: () => void;
  onToggleWidget: () => void;
  onOpenSettings: () => void;
}

export function ContextMenuOverlay({
  menu,
  crates,
  currentTrack,
  isPlaying,
  likedIds,
  onClose,
  onSelectCrate,
  onPlayTrack,
  onTogglePlay,
  onToggleMute,
  onToggleLike,
  onOpenDetailMode,
  onOpenCrateModal,
  onDeleteCrate,
  onAddTrackToCrate,
  onRemoveTrackFromCrate,
  onTransferTracks,
  onFetchRelated,
  onSyncFavorites,
  onToggleWidget,
  onOpenSettings,
}: ContextMenuOverlayProps) {
  useEffect(() => {
    if (!menu) return;
    const onGlobalClick = () => onClose();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("click", onGlobalClick);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", onGlobalClick);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  // Keep menu inside viewport bounds even when track menu has multiple crate targets
  const left = Math.max(12, Math.min(menu.x, window.innerWidth - 236));
  const top = Math.max(12, Math.min(menu.y, window.innerHeight - 395));

  const copyText = (text: string) => {
    void navigator.clipboard?.writeText(text);
    onClose();
  };

  return (
    <div
      className="szx-no-drag"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
      style={{
        position: "fixed",
        left,
        top,
        width: 224,
        maxHeight: "calc(100vh - 24px)",
        overflowY: "auto",
        zIndex: 200,
      }}
    >
      <GlassPanel dense radius={12} style={{ width: "100%" }}>
        <div
          style={{
            padding: 6,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            fontSize: 12,
          }}
        >
          {menu.kind === "crate" && (
            <>
              <div
                className="szx-mono"
                style={{
                  padding: "4px 8px",
                  fontSize: 10,
                  color: "var(--accent)",
                  borderBottom: "1px solid var(--line)",
                  marginBottom: 2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                黑胶 · {menu.crate.title}
              </div>
              <MenuBtn
                icon={<Play size={12} />}
                label="打开并播放此黑胶"
                onClick={() => {
                  onSelectCrate(menu.crate);
                  if (menu.crate.tracks[0]) {
                    onPlayTrack(menu.crate.tracks[0], menu.crate.id);
                  }
                  onClose();
                }}
              />
              <MenuBtn
                icon={<Edit3 size={12} />}
                label="自定义黑胶名称…"
                onClick={() => {
                  onOpenCrateModal({ mode: "rename", crate: menu.crate });
                  onClose();
                }}
              />
              <MenuBtn
                icon={<Plus size={12} />}
                label="管理 / 添加播放列表曲目…"
                onClick={() => {
                  onOpenCrateModal({ mode: "add-track", crate: menu.crate });
                  onClose();
                }}
              />
              {menu.crate.tracks.length > 0 && (
                <MenuBtn
                  icon={<ArrowRightLeft size={12} />}
                  label={`批量转移箱内曲目 (${menu.crate.tracks.length} 首)…`}
                  onClick={() => {
                    onOpenCrateModal({ mode: "transfer", crate: menu.crate });
                    onClose();
                  }}
                />
              )}
              <MenuBtn
                icon={<FolderPlus size={12} />}
                label="新建自定义黑胶…"
                onClick={() => {
                  onOpenCrateModal({ mode: "create" });
                  onClose();
                }}
              />
              {crates.length > 1 && (
                <MenuBtn
                  icon={<Trash2 size={12} />}
                  label="删除此黑胶唱片箱"
                  danger
                  onClick={() => {
                    onDeleteCrate(menu.crate.id);
                    onClose();
                  }}
                />
              )}
            </>
          )}

          {menu.kind === "track" && (() => {
            const sameBvidCount = menu.crate.tracks.filter(
              (t) => t.bvid === menu.track.bvid
            ).length;
            const otherCrates = crates.filter((c) => c.id !== menu.crate.id);
            return (
              <>
                <div
                  className="szx-mono"
                  style={{
                    padding: "4px 8px",
                    fontSize: 10,
                    color: "var(--accent)",
                    borderBottom: "1px solid var(--line)",
                    marginBottom: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  ♪ {menu.track.title}
                </div>
                <MenuBtn
                  icon={<Play size={12} />}
                  label="立即播放此曲目"
                  onClick={() => {
                    onPlayTrack(menu.track, menu.crate.id);
                    onClose();
                  }}
                />
                <MenuBtn
                  icon={<FileText size={12} />}
                  label="字 · 查看居中字幕轴"
                  onClick={() => {
                    onPlayTrack(menu.track, menu.crate.id);
                    onOpenDetailMode("sub");
                    onClose();
                  }}
                />
                <MenuBtn
                  icon={<Sparkles size={12} />}
                  label="弹 · 查看弹幕瀑布流"
                  onClick={() => {
                    onPlayTrack(menu.track, menu.crate.id);
                    onOpenDetailMode("danmaku");
                    onClose();
                  }}
                />
                <MenuBtn
                  icon={<Heart size={12} />}
                  label={likedIds.includes(menu.track.id) ? "取消红心收藏" : "加入红心收藏"}
                  onClick={() => {
                    onToggleLike(menu.track.id);
                    onClose();
                  }}
                />

                {sameBvidCount > 1 && (
                  <div
                    style={{
                      borderTop: "1px solid var(--line)",
                      borderBottom: "1px solid var(--line)",
                      padding: "4px 0",
                      margin: "2px 0",
                    }}
                  >
                    <div
                      className="szx-mono"
                      style={{ padding: "2px 8px", fontSize: 9.5, color: "var(--accent)" }}
                    >
                      一键转移同 BV 全部 {sameBvidCount} 首：
                    </div>
                    {otherCrates.slice(0, 3).map((targetCrate) => (
                      <MenuBtn
                        key={`bulk-${targetCrate.id}`}
                        icon={<ArrowRightLeft size={11} />}
                        label={`移动全部 ${sameBvidCount} 首 →「${targetCrate.title}」`}
                        onClick={() => {
                          onTransferTracks?.(
                            menu.crate.id,
                            targetCrate.id,
                            menu.track.bvid,
                            true
                          );
                          onClose();
                        }}
                      />
                    ))}
                    <MenuBtn
                      icon={<FolderPlus size={11} />}
                      label={`新建/选择黑胶转移全部 ${sameBvidCount} 首…`}
                      onClick={() => {
                        onOpenCrateModal({
                          mode: "transfer",
                          crate: menu.crate,
                          bvidFilter: menu.track.bvid,
                        });
                        onClose();
                      }}
                    />
                  </div>
                )}

                {otherCrates.length > 0 && (
                  <div
                    style={{
                      borderTop: sameBvidCount > 1 ? "none" : "1px solid var(--line)",
                      borderBottom: "1px solid var(--line)",
                      padding: "4px 0",
                      margin: "2px 0",
                    }}
                  >
                    <div
                      className="szx-mono"
                      style={{ padding: "2px 8px", fontSize: 9.5, color: "var(--ink-dim)" }}
                    >
                      单曲加入其他黑胶：
                    </div>
                    {otherCrates.slice(0, 3).map((targetCrate) => (
                      <MenuBtn
                        key={targetCrate.id}
                        icon={<Plus size={11} />}
                        label={`加入「${targetCrate.title}」`}
                        onClick={() => {
                          onAddTrackToCrate(targetCrate.id, menu.track);
                          onClose();
                        }}
                      />
                    ))}
                  </div>
                )}
                {menu.track.bvid.startsWith("BV") && (
                  <>
                    <MenuBtn
                      icon={<Sparkles size={12} />}
                      label="生成相似推荐黑胶"
                      onClick={() => {
                        onFetchRelated(menu.track.bvid, menu.track.title);
                        onClose();
                      }}
                    />
                    <MenuBtn
                      icon={<Copy size={12} />}
                      label={`复制 ${menu.track.bvid}`}
                      onClick={() => copyText(menu.track.bvid)}
                    />
                  </>
                )}
                <MenuBtn
                  icon={<Trash2 size={12} />}
                  label="从当前播放列表移除"
                  danger
                  onClick={() => {
                    onRemoveTrackFromCrate(menu.crate.id, menu.track.id);
                    onClose();
                  }}
                />
              </>
            );
          })()}

          {menu.kind === "turntable" && (
            <>
              <div
                className="szx-mono"
                style={{
                  padding: "4px 8px",
                  fontSize: 10,
                  color: "var(--accent)",
                  borderBottom: "1px solid var(--line)",
                  marginBottom: 2,
                }}
              >
                黑胶唱盘控制
              </div>
              <MenuBtn
                icon={<Play size={12} />}
                label={isPlaying ? "暂停播放 (Space)" : "继续播放 (Space)"}
                onClick={() => {
                  onTogglePlay();
                  onClose();
                }}
              />
              <MenuBtn
                icon={<FileText size={12} />}
                label="字 · 切换至居中字幕视图"
                onClick={() => {
                  onOpenDetailMode("sub");
                  onClose();
                }}
              />
              <MenuBtn
                icon={<Sparkles size={12} />}
                label="弹 · 切换至弹幕瀑布流视图"
                onClick={() => {
                  onOpenDetailMode("danmaku");
                  onClose();
                }}
              />
              <MenuBtn
                icon={<Disc size={12} />}
                label="查看分 P 选集与详情"
                onClick={() => {
                  onOpenDetailMode("info");
                  onClose();
                }}
              />
              <MenuBtn
                icon={<Volume2 size={12} />}
                label="静音 / 恢复音量 (M)"
                onClick={() => {
                  onToggleMute();
                  onClose();
                }}
              />
              <MenuBtn
                icon={<Copy size={12} />}
                label={`复制当前 ${currentTrack.bvid}`}
                onClick={() => copyText(currentTrack.bvid)}
              />
            </>
          )}

          {menu.kind === "global" && (
            <>
              <div
                className="szx-mono"
                style={{
                  padding: "4px 8px",
                  fontSize: 10,
                  color: "var(--accent)",
                  borderBottom: "1px solid var(--line)",
                  marginBottom: 2,
                }}
              >
                SZXmusic 快捷菜单
              </div>
              <MenuBtn
                icon={<FolderPlus size={12} />}
                label="新建自定义黑胶…"
                onClick={() => {
                  onOpenCrateModal({ mode: "create" });
                  onClose();
                }}
              />
              <MenuBtn
                icon={<FileText size={12} />}
                label="打开「字 / 弹」详情视图"
                onClick={() => {
                  onOpenDetailMode("sub");
                  onClose();
                }}
              />
              <MenuBtn
                icon={<RefreshCw size={12} />}
                label="同步 B 站收藏夹"
                onClick={() => {
                  onSyncFavorites();
                  onClose();
                }}
              />
              <MenuBtn
                icon={<Disc size={12} />}
                label="显示 / 隐藏桌面壁纸小部件"
                onClick={() => {
                  onToggleWidget();
                  onClose();
                }}
              />
              <MenuBtn
                icon={<Settings size={12} />}
                label="打开设置抽屉"
                onClick={() => {
                  onOpenSettings();
                  onClose();
                }}
              />
            </>
          )}
        </div>
      </GlassPanel>
    </div>
  );
}

function MenuBtn({
  icon,
  label,
  danger = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        border: "none",
        background: "transparent",
        color: danger ? "var(--warn)" : "var(--ink)",
        padding: "6px 8px",
        borderRadius: 7,
        fontSize: 11.5,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 8,
        textAlign: "left",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--accent-soft)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ color: danger ? "var(--warn)" : "var(--accent)", display: "inline-flex" }}>
        {icon}
      </span>
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
        }}
      >
        {label}
      </span>
    </button>
  );
}

export interface CrateActionModalProps {
  modal: CrateModalState;
  crates: CrateItem[];
  isRevealLayer?: boolean;
  onClose: () => void;
  onCreateCrate: (title: string, subtitle: string) => void;
  onRenameCrate: (crateId: string, title: string, subtitle: string) => void;
  onAddTrackToCrate: (crateId: string, track: TrackItem) => void;
  onRemoveTrackFromCrate: (crateId: string, trackId: string) => void;
  onTransferTracks?: (
    fromCrateId: string,
    toCrateId: string,
    bvidFilter?: string,
    moveTracks?: boolean
  ) => void;
  onCreateCrateWithTracks?: (
    title: string,
    subtitle: string,
    fromCrateId: string,
    bvidFilter?: string,
    moveTracks?: boolean
  ) => void;
  onPlayOnlineBvid?: (input: string) => void;
}

export function CrateActionModal({
  modal,
  crates,
  isRevealLayer = false,
  onClose,
  onCreateCrate,
  onRenameCrate,
  onAddTrackToCrate,
  onRemoveTrackFromCrate,
  onTransferTracks,
  onCreateCrateWithTracks,
  onPlayOnlineBvid,
}: CrateActionModalProps) {
  const [titleInput, setTitleInput] = useState("");
  const [subInput, setSubInput] = useState("");
  const [filterKw, setFilterKw] = useState("");
  const [customBvid, setCustomBvid] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [customArtist, setCustomArtist] = useState("");
  const [transferBvid, setTransferBvid] = useState<string>("");
  const [transferTargetId, setTransferTargetId] = useState<string>("__new__");
  const [transferMove, setTransferMove] = useState<boolean>(true);
  const cratesRef = useRef(crates);
  cratesRef.current = crates;

  useEffect(() => {
    if (!modal) return;
    if (modal.mode === "create") {
      setTitleInput("");
      setSubInput("自定义精选黑胶");
    } else if (modal.mode === "rename") {
      setTitleInput(modal.crate.title);
      setSubInput(modal.crate.subtitle);
    } else if (modal.mode === "add-track") {
      setFilterKw("");
      setCustomBvid("");
      setCustomTitle("");
      setCustomArtist("");
    } else if (modal.mode === "transfer") {
      const bvidFilter = modal.bvidFilter ?? "";
      setTransferBvid(bvidFilter);
      const otherCrates = cratesRef.current.filter((c) => c.id !== modal.crate.id);
      setTransferTargetId(otherCrates[0]?.id ?? "__new__");
      setTransferMove(true);
      const sampleTrack = bvidFilter
        ? modal.crate.tracks.find((t) => t.bvid === bvidFilter)
        : modal.crate.tracks[0];
      setTitleInput(
        sampleTrack?.artist && sampleTrack.artist !== "未知艺人"
          ? `${sampleTrack.artist} 精选`
          : `${modal.crate.title} · 精选`
      );
      setSubInput(
        bvidFilter ? `${bvidFilter} 合集收录` : "自定义精选黑胶"
      );
    }
  }, [modal]);

  const activeTargetCrate =
    modal &&
    (modal.mode === "add-track" || modal.mode === "rename" || modal.mode === "transfer")
      ? crates.find((c) => c.id === modal.crate.id) ?? modal.crate
      : null;

  const allPoolTracks = useMemo(() => {
    const seen = new Set<string>();
    const out: TrackItem[] = [];
    for (const c of crates) {
      for (const t of c.tracks) {
        if (!seen.has(t.id)) {
          seen.add(t.id);
          out.push(t);
        }
      }
    }
    return out;
  }, [crates]);

  // Group multi-P BV collections from other crates for one-click import in "add-track" mode
  const multiPageGroups = useMemo(() => {
    if (!modal || modal.mode !== "add-track") return [];
    const out: {
      sourceCrateId: string;
      sourceCrateTitle: string;
      bvid: string;
      count: number;
      sampleTitle: string;
      artist: string;
    }[] = [];
    for (const c of crates) {
      if (c.id === modal.crate.id) continue;
      const byBv = new Map<string, TrackItem[]>();
      for (const t of c.tracks) {
        const list = byBv.get(t.bvid) ?? [];
        list.push(t);
        byBv.set(t.bvid, list);
      }
      for (const [bvid, list] of byBv.entries()) {
        if (list.length > 1) {
          out.push({
            sourceCrateId: c.id,
            sourceCrateTitle: c.title,
            bvid,
            count: list.length,
            sampleTitle: list[0]?.title ?? bvid,
            artist: list[0]?.artist ?? "",
          });
        }
      }
    }
    return out;
  }, [crates, modal]);

  // Group BV counts inside activeTargetCrate for transfer mode
  const sourceCrateBvidGroups = useMemo(() => {
    if (!activeTargetCrate) return [];
    const map = new Map<string, { count: number; artist: string; firstTitle: string }>();
    for (const t of activeTargetCrate.tracks) {
      const prev = map.get(t.bvid);
      if (prev) {
        prev.count += 1;
      } else {
        map.set(t.bvid, { count: 1, artist: t.artist, firstTitle: t.title });
      }
    }
    return Array.from(map.entries()).map(([bvid, info]) => ({ bvid, ...info }));
  }, [activeTargetCrate]);

  if (!modal) return null;

  const filteredPool = allPoolTracks.filter((t) => {
    const kw = filterKw.trim().toLowerCase();
    if (!kw) return true;
    return (
      t.title.toLowerCase().includes(kw) ||
      t.artist.toLowerCase().includes(kw) ||
      t.bvid.toLowerCase().includes(kw)
    );
  });

  const transferMatchingCount = activeTargetCrate
    ? transferBvid
      ? activeTargetCrate.tracks.filter((t) => t.bvid === transferBvid).length
      : activeTargetCrate.tracks.length
    : 0;

  return (
    <div
      className="szx-no-drag"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 180,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: modal.mode === "add-track" || modal.mode === "transfer" ? 470 : 360,
          maxHeight: "84vh",
        }}
      >
        <GlassPanel dense radius={14} style={{ width: "100%" }}>
          <div
            style={{
              padding: 16,
              maxHeight: "82vh",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              fontSize: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottom: "1px solid var(--line)",
                paddingBottom: 8,
              }}
            >
              <strong className="szx-serif" style={{ fontSize: 15 }}>
                {modal.mode === "create"
                  ? "新建自定义黑胶唱片"
                  : modal.mode === "rename"
                    ? `自定义黑胶名称 · ${activeTargetCrate?.title ?? ""}`
                    : modal.mode === "transfer"
                      ? `一键批量转移曲目 · ${activeTargetCrate?.title ?? ""}`
                      : `增减播放列表 · ${activeTargetCrate?.title ?? ""}`}
              </strong>
              <button
                type="button"
                className="szx-icon-btn"
                onClick={onClose}
                style={{ height: 24, minWidth: 24, padding: 0 }}
              >
                <X size={13} />
              </button>
            </div>

            {modal.mode === "transfer" && activeTargetCrate && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <span className="szx-mono" style={{ fontSize: 10.5, color: "var(--ink-dim)" }}>
                    1. 选择要转移的曲目范围
                  </span>
                  <select
                    value={transferBvid}
                    disabled={isRevealLayer}
                    tabIndex={isRevealLayer ? -1 : undefined}
                    onChange={(e) => setTransferBvid(e.target.value)}
                    className="szx-mono"
                    style={{
                      height: 30,
                      padding: "0 8px",
                      borderRadius: 8,
                      border: "1px solid var(--glass-border)",
                      background: "var(--panel)",
                      color: "var(--ink)",
                      fontSize: 11.5,
                    }}
                  >
                    <option value="">
                      当前黑胶全部曲目（共 {activeTargetCrate.tracks.length} 首）
                    </option>
                    {sourceCrateBvidGroups
                      .filter((g) => g.count > 1)
                      .map((g) => (
                        <option key={g.bvid} value={g.bvid}>
                          仅 {g.bvid} 分P合集（共 {g.count} 首 · {g.artist || g.firstTitle}）
                        </option>
                      ))}
                  </select>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <span className="szx-mono" style={{ fontSize: 10.5, color: "var(--ink-dim)" }}>
                    2. 选择目标黑胶唱片箱
                  </span>
                  <select
                    value={transferTargetId}
                    disabled={isRevealLayer}
                    tabIndex={isRevealLayer ? -1 : undefined}
                    onChange={(e) => setTransferTargetId(e.target.value)}
                    style={{
                      height: 30,
                      padding: "0 8px",
                      borderRadius: 8,
                      border: "1px solid var(--glass-border)",
                      background: "var(--panel)",
                      color: "var(--ink)",
                      fontSize: 12,
                    }}
                  >
                    {crates
                      .filter((c) => c.id !== activeTargetCrate.id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          转入已有黑胶：「{c.title}」（现有 {c.tracks.length} 首）
                        </option>
                      ))}
                    <option value="__new__">+ 新建自定义黑胶并转入…</option>
                  </select>
                </div>

                {transferTargetId === "__new__" && (
                  <div
                    style={{
                      padding: 10,
                      borderRadius: 8,
                      background: "var(--panel)",
                      border: "1px solid var(--line)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <span className="szx-mono" style={{ fontSize: 10, color: "var(--accent)" }}>
                      新黑胶名称与副标题
                    </span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        type="text"
                        value={titleInput}
                        readOnly={isRevealLayer}
                        tabIndex={isRevealLayer ? -1 : undefined}
                        onChange={(e) => setTitleInput(e.target.value)}
                        placeholder="新黑胶标题（如：影之刃零 OST）"
                        style={{
                          flex: 1,
                          height: 28,
                          padding: "0 8px",
                          borderRadius: 6,
                          border: "1px solid var(--glass-border)",
                          background: "var(--panel-glass)",
                          color: "var(--ink)",
                          fontSize: 12,
                        }}
                      />
                      <input
                        type="text"
                        value={subInput}
                        readOnly={isRevealLayer}
                        tabIndex={isRevealLayer ? -1 : undefined}
                        onChange={(e) => setSubInput(e.target.value)}
                        placeholder="副标题"
                        style={{
                          width: 145,
                          height: 28,
                          padding: "0 8px",
                          borderRadius: 6,
                          border: "1px solid var(--glass-border)",
                          background: "var(--panel-glass)",
                          color: "var(--ink)",
                          fontSize: 11.5,
                        }}
                      />
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="szx-icon-btn szx-mono"
                    onClick={() => setTransferMove(true)}
                    style={{
                      flex: 1,
                      height: 28,
                      fontSize: 11,
                      borderColor: transferMove ? "var(--accent)" : "var(--glass-border)",
                      background: transferMove ? "var(--accent-soft)" : "var(--panel)",
                    }}
                  >
                    移动（从原黑胶移出）
                  </button>
                  <button
                    type="button"
                    className="szx-icon-btn szx-mono"
                    onClick={() => setTransferMove(false)}
                    style={{
                      flex: 1,
                      height: 28,
                      fontSize: 11,
                      borderColor: !transferMove ? "var(--accent)" : "var(--glass-border)",
                      background: !transferMove ? "var(--accent-soft)" : "var(--panel)",
                    }}
                  >
                    复制（保留原黑胶曲目）
                  </button>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                  <button type="button" className="szx-icon-btn szx-mono" onClick={onClose}>
                    取消
                  </button>
                  <button
                    type="button"
                    className="szx-icon-btn szx-mono"
                    disabled={
                      transferMatchingCount === 0 ||
                      (transferTargetId === "__new__" && !titleInput.trim())
                    }
                    onClick={() => {
                      const bvidOpt = transferBvid || undefined;
                      if (transferTargetId === "__new__") {
                        onCreateCrateWithTracks?.(
                          titleInput.trim(),
                          subInput.trim() || "自定义精选黑胶",
                          activeTargetCrate.id,
                          bvidOpt,
                          transferMove
                        );
                      } else {
                        onTransferTracks?.(
                          activeTargetCrate.id,
                          transferTargetId,
                          bvidOpt,
                          transferMove
                        );
                      }
                      onClose();
                    }}
                    style={{
                      borderColor: "var(--accent)",
                      background: "var(--accent)",
                      color: "#faf9f5",
                    }}
                  >
                    <ArrowRightLeft size={12} />
                    确认{transferMove ? "移动" : "复制"} {transferMatchingCount} 首
                  </button>
                </div>
              </div>
            )}

            {(modal.mode === "create" || modal.mode === "rename") && (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span className="szx-mono" style={{ fontSize: 10.5, color: "var(--ink-dim)" }}>
                    黑胶标题（将以前挡玻璃签名字体呈现）
                  </span>
                  <input
                    type="text"
                    value={titleInput}
                    readOnly={isRevealLayer}
                    tabIndex={isRevealLayer ? -1 : undefined}
                    onChange={(e) => setTitleInput(e.target.value)}
                    placeholder="例如：深夜后摇、周杰伦现场珍藏…"
                    style={{
                      height: 32,
                      padding: "0 10px",
                      borderRadius: 8,
                      border: "1px solid var(--glass-border)",
                      background: "var(--panel)",
                      color: "var(--ink)",
                      fontSize: 12.5,
                    }}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span className="szx-mono" style={{ fontSize: 10.5, color: "var(--ink-dim)" }}>
                    副标题 / 描述标签
                  </span>
                  <input
                    type="text"
                    value={subInput}
                    readOnly={isRevealLayer}
                    tabIndex={isRevealLayer ? -1 : undefined}
                    onChange={(e) => setSubInput(e.target.value)}
                    placeholder="例如：自定义黑胶 · 私享歌单"
                    style={{
                      height: 30,
                      padding: "0 10px",
                      borderRadius: 8,
                      border: "1px solid var(--glass-border)",
                      background: "var(--panel)",
                      color: "var(--ink)",
                      fontSize: 12,
                    }}
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                  <button
                    type="button"
                    className="szx-icon-btn szx-mono"
                    onClick={onClose}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="szx-icon-btn szx-mono"
                    disabled={!titleInput.trim()}
                    onClick={() => {
                      if (!titleInput.trim()) return;
                      if (modal.mode === "create") {
                        onCreateCrate(titleInput.trim(), subInput.trim());
                      } else {
                        onRenameCrate(modal.crate.id, titleInput.trim(), subInput.trim());
                      }
                      onClose();
                    }}
                    style={{
                      borderColor: "var(--accent)",
                      background: "var(--accent)",
                      color: "#faf9f5",
                    }}
                  >
                    保存黑胶
                  </button>
                </div>
              </>
            )}

            {modal.mode === "add-track" && activeTargetCrate && (
              <>
                {/* Manual BV / Custom Track Quick Add */}
                <div
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    background: "var(--panel)",
                    border: "1px solid var(--line)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div className="szx-mono" style={{ fontSize: 10.5, color: "var(--accent)" }}>
                    方式一：手动录入或粘贴 BV 号加入「{activeTargetCrate.title}」
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type="text"
                      value={customBvid}
                      readOnly={isRevealLayer}
                      tabIndex={isRevealLayer ? -1 : undefined}
                      onChange={(e) => setCustomBvid(e.target.value)}
                      placeholder="BV号 (如 BV1GJ411x7h7)"
                      className="szx-mono"
                      style={{
                        width: 138,
                        height: 28,
                        padding: "0 8px",
                        borderRadius: 6,
                        border: "1px solid var(--glass-border)",
                        background: "var(--panel-glass)",
                        color: "var(--ink)",
                        fontSize: 11,
                      }}
                    />
                    <input
                      type="text"
                      value={customTitle}
                      readOnly={isRevealLayer}
                      tabIndex={isRevealLayer ? -1 : undefined}
                      onChange={(e) => setCustomTitle(e.target.value)}
                      placeholder="曲目歌名"
                      style={{
                        flex: 1,
                        height: 28,
                        padding: "0 8px",
                        borderRadius: 6,
                        border: "1px solid var(--glass-border)",
                        background: "var(--panel-glass)",
                        color: "var(--ink)",
                        fontSize: 11.5,
                      }}
                    />
                    <input
                      type="text"
                      value={customArtist}
                      readOnly={isRevealLayer}
                      tabIndex={isRevealLayer ? -1 : undefined}
                      onChange={(e) => setCustomArtist(e.target.value)}
                      placeholder="歌手 / UP主"
                      style={{
                        width: 100,
                        height: 28,
                        padding: "0 8px",
                        borderRadius: 6,
                        border: "1px solid var(--glass-border)",
                        background: "var(--panel-glass)",
                        color: "var(--ink)",
                        fontSize: 11.5,
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                    {onPlayOnlineBvid && customBvid.trim().startsWith("BV") && (
                      <button
                        type="button"
                        className="szx-icon-btn szx-mono"
                        onClick={() => {
                          onPlayOnlineBvid(customBvid.trim());
                          onClose();
                        }}
                        style={{ height: 26, fontSize: 10.5 }}
                      >
                        在线解析并播放
                      </button>
                    )}
                    <button
                      type="button"
                      className="szx-icon-btn szx-mono"
                      disabled={!customTitle.trim() && !customBvid.trim()}
                      onClick={() => {
                        const bvid = customBvid.trim() || `BV1custom${Date.now().toString().slice(-4)}`;
                        const title = customTitle.trim() || bvid;
                        const artist = customArtist.trim() || "B站音乐人";
                        const newTrack: TrackItem = {
                          id: `custom-trk-${Date.now()}`,
                          bvid,
                          page: 1,
                          rawTitle: `${artist} - ${title}`,
                          title,
                          artist,
                          version: "Original",
                          confidence: 1,
                          ruleId: "manual",
                          durationSec: 210,
                          qualityLabel: "192K AAC",
                          coverUrl: activeTargetCrate.covers[0] ?? "",
                          bpm: 105,
                          musicalKey: "C",
                          energy: 4,
                          reasonTag: "手动添加",
                        };
                        onAddTrackToCrate(activeTargetCrate.id, newTrack);
                        setCustomBvid("");
                        setCustomTitle("");
                        setCustomArtist("");
                      }}
                      style={{
                        height: 26,
                        fontSize: 10.5,
                        borderColor: "var(--accent)",
                        color: "var(--accent)",
                      }}
                    >
                      <Plus size={11} />
                      加入当前黑胶
                    </button>
                  </div>
                </div>

                {multiPageGroups.length > 0 && (
                  <div
                    style={{
                      padding: 10,
                      borderRadius: 10,
                      background: "var(--accent-soft)",
                      border: "1px solid var(--accent)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div className="szx-mono" style={{ fontSize: 10.5, color: "var(--accent)" }}>
                      一键批量转入分 P 合集到「{activeTargetCrate.title}」
                    </div>
                    {multiPageGroups.map((g) => (
                      <div
                        key={`${g.sourceCrateId}:${g.bvid}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          fontSize: 11,
                        }}
                      >
                        <span
                          style={{
                            flex: 1,
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <strong>{g.artist || g.sampleTitle}</strong> · {g.bvid}（来自「{g.sourceCrateTitle}」共 {g.count} 首）
                        </span>
                        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                          <button
                            type="button"
                            className="szx-icon-btn szx-mono"
                            onClick={() => {
                              onTransferTracks?.(
                                g.sourceCrateId,
                                activeTargetCrate.id,
                                g.bvid,
                                true
                              );
                            }}
                            style={{
                              height: 22,
                              fontSize: 10,
                              padding: "0 7px",
                              borderColor: "var(--accent)",
                              background: "var(--accent)",
                              color: "#faf9f5",
                            }}
                          >
                            一键移入 {g.count} 首
                          </button>
                          <button
                            type="button"
                            className="szx-icon-btn szx-mono"
                            onClick={() => {
                              onTransferTracks?.(
                                g.sourceCrateId,
                                activeTargetCrate.id,
                                g.bvid,
                                false
                              );
                            }}
                            style={{
                              height: 22,
                              fontSize: 10,
                              padding: "0 7px",
                            }}
                          >
                            复制
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Pick or Remove from Pool */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span className="szx-mono" style={{ fontSize: 10.5, color: "var(--ink-dim)" }}>
                      方式二：从本地黑胶曲库勾选增减（当前共 {activeTargetCrate.tracks.length} 首）
                    </span>
                    <input
                      type="text"
                      value={filterKw}
                      readOnly={isRevealLayer}
                      tabIndex={isRevealLayer ? -1 : undefined}
                      onChange={(e) => setFilterKw(e.target.value)}
                      placeholder="搜索曲库歌名/歌手…"
                      style={{
                        width: 150,
                        height: 24,
                        padding: "0 8px",
                        borderRadius: 6,
                        border: "1px solid var(--glass-border)",
                        background: "var(--panel)",
                        color: "var(--ink)",
                        fontSize: 11,
                      }}
                    />
                  </div>

                  <div
                    style={{
                      maxHeight: 210,
                      overflowY: "auto",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      paddingRight: 2,
                    }}
                  >
                    {filteredPool.slice(0, 120).map((trk) => {
                      const inCrate = activeTargetCrate.tracks.some((t) => t.id === trk.id);
                      return (
                        <div
                          key={trk.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "5px 8px",
                            borderRadius: 7,
                            background: inCrate ? "var(--accent-soft)" : "var(--panel)",
                            border: "1px solid var(--line)",
                            gap: 8,
                          }}
                        >
                          <div
                            style={{
                              minWidth: 0,
                              flex: 1,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <strong>{trk.title}</strong>
                            <span style={{ color: "var(--ink-dim)", marginLeft: 6 }}>
                              — {trk.artist} ({trk.bvid})
                            </span>
                          </div>
                          {inCrate ? (
                            <button
                              type="button"
                              className="szx-icon-btn szx-mono"
                              onClick={() => onRemoveTrackFromCrate(activeTargetCrate.id, trk.id)}
                              style={{
                                height: 22,
                                fontSize: 10,
                                padding: "0 7px",
                                color: "var(--warn)",
                              }}
                            >
                              移除
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="szx-icon-btn szx-mono"
                              onClick={() => onAddTrackToCrate(activeTargetCrate.id, trk)}
                              style={{
                                height: 22,
                                fontSize: 10,
                                padding: "0 7px",
                                borderColor: "var(--accent)",
                                color: "var(--accent)",
                              }}
                            >
                              + 加入
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </GlassPanel>
      </div>
    </div>
  );
}
