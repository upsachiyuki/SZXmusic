import { create } from "zustand";
import {
  MOCK_CRATES,
  MOCK_PENDING_ITEMS,
  type CrateItem,
  type CrateKind,
  type PendingParseItem,
  type TrackItem,
} from "@shared/mock/catalog";
import {
  emitAppEvent,
  invokeCore,
  isTauriRuntime,
  type AudioQualityOption,
  type BackendLibraryCrate,
  type BackendPendingParseItem,
  type BiliPlaySummary,
  type BiliUserInfo,
  type CustomRuleDto,
  type LibrarySnapshot,
  type OnlinePlayResponse,
  type ParsedTrackPreview,
  type QrLoginStart,
  type QrPollResult,
  type SearchParsedItem,
  type SyncProgressEvent,
  type SyncResult,
  type ThemeMode,
  type TrackLyricsBundle,
  type WidgetAnchor,
  type WidgetSize,
  type WinRegistryStatus,
} from "@shared/ipc/tauriBridge";
import {
  DEFAULT_THEME_STORAGE_KEY,
  loadPersistedTheme,
  savePersistedTheme,
} from "@shared/liquid-theme";

export type LibrarySource = "demo" | "bili";

export interface SyncStatePayload {
  theme: ThemeMode;
  activeCrateId: string;
  currentTrackId: string;
  currentTrack?: TrackItem;
  nextTrack?: TrackItem;
  isPlaying: boolean;
  positionSec: number;
  likedIds: string[];
  volume: number;
  mode: "radio" | "loop:all" | "loop:one";
  widgetSize?: WidgetSize;
  widgetLocked?: boolean;
  clickThrough?: boolean;
  alwaysOnTop?: boolean;
  spectrum?: number[];
  levelL?: number;
  levelR?: number;
  liveStreamActive?: boolean;
  streamStatus?: string;
  librarySource?: LibrarySource;
  syncStatusText?: string;
}

interface PlayerStoreState {
  theme: ThemeMode;
  librarySource: LibrarySource;
  crates: CrateItem[];
  activeCrateId: string;
  currentTrack: TrackItem;
  nextTrack: TrackItem;
  isPlaying: boolean;
  positionSec: number;
  volume: number;
  muted: boolean;
  prevVolume: number;
  preferredQuality: number;
  availableQualities: AudioQualityOption[];
  crateGlassBlur: number;
  mode: "radio" | "loop:all" | "loop:one";
  likedIds: string[];
  spectrum: number[];
  levelL: number;
  levelR: number;
  widgetSize: WidgetSize;
  widgetAnchor: WidgetAnchor;
  widgetLocked: boolean;
  clickThrough: boolean;
  alwaysOnTop: boolean;
  autostart: boolean;
  registryStatus: WinRegistryStatus | null;
  liveStreamActive: boolean;
  streamLoading: boolean;
  streamStatus: string;

  // Bilibili Auth & Library Sync
  biliUser: BiliUserInfo | null;
  biliLoadedCount: number;
  lastSyncAt: number;
  syncing: boolean;
  syncProgress: SyncProgressEvent | null;
  syncStatusText: string;
  syncIntervalMin: number;
  pendingItems: PendingParseItem[];
  searchResults: SearchParsedItem[];
  searching: boolean;
  customRules: CustomRuleDto[];

  setTheme: (theme: ThemeMode, broadcast?: boolean) => void;
  toggleTheme: () => void;
  selectCrate: (crateId: string, broadcast?: boolean) => void;
  switchLibrarySource: (source: LibrarySource) => void;
  playTrack: (track: TrackItem, crateId?: string, broadcast?: boolean) => void;
  togglePlay: (broadcast?: boolean) => void;
  seek: (sec: number, broadcast?: boolean) => void;
  stepTrack: (delta: 1 | -1) => void;
  onLiveTrackEnded: () => void;
  toggleLike: (trackId: string) => void;
  cycleMode: () => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  setPreferredQuality: (qualityId: number) => void;
  setCrateGlassBlur: (blurPx: number) => void;
  fetchTrackLyrics: (
    bvid: string,
    cid?: number,
    title?: string,
    artist?: string
  ) => Promise<TrackLyricsBundle | null>;
  createCrate: (title: string, subtitle?: string) => Promise<string | null>;
  renameCrate: (crateId: string, title: string, subtitle?: string) => Promise<void>;
  deleteCrate: (crateId: string) => Promise<void>;
  addTrackToCrate: (crateId: string, track: TrackItem) => Promise<void>;
  removeTrackFromCrate: (crateId: string, trackId: string) => Promise<void>;
  transferTracksToCrate: (
    fromCrateId: string,
    toCrateId: string,
    bvidFilter?: string,
    moveTracks?: boolean
  ) => Promise<void>;
  createCrateWithTracks: (
    title: string,
    subtitle: string,
    fromCrateId: string,
    bvidFilter?: string,
    moveTracks?: boolean
  ) => Promise<string | null>;
  setWidgetSize: (size: WidgetSize) => void;
  setWidgetAnchor: (anchor: WidgetAnchor) => void;
  setWidgetLocked: (locked: boolean) => void;
  setClickThrough: (enabled: boolean) => void;
  setAlwaysOnTop: (enabled: boolean) => void;
  setAutostart: (enabled: boolean) => void;
  refreshRegistryStatus: () => Promise<WinRegistryStatus | null>;
  registerWindowsApp: () => Promise<WinRegistryStatus | null>;
  unregisterWindowsApp: () => Promise<WinRegistryStatus | null>;
  tickSimulation: (dtSec: number, advancePosition?: boolean) => void;
  applyLiveTelemetry: (payload: {
    spectrum?: number[];
    levelL?: number;
    levelR?: number;
    positionSec?: number;
    durationSec?: number;
    isPlaying?: boolean;
    liveStreamActive?: boolean;
    streamStatus?: string;
    bpm?: number;
    musicalKey?: string;
    energy?: number;
  }) => void;
  applyRemoteSync: (payload: Partial<SyncStatePayload>) => void;
  applyLibrarySnapshot: (snapshot: LibrarySnapshot, preferLive?: boolean) => void;
  playRealBiliStream: (
    bvid: string,
    cid?: number,
    title?: string,
    artist?: string,
    coverUrl?: string,
    trackId?: string
  ) => Promise<boolean>;

  // Real Bilibili & Library actions
  initBiliWorkspace: () => Promise<void>;
  startQrLogin: () => Promise<QrLoginStart | null>;
  pollQrLogin: (qrcodeKey: string) => Promise<QrPollResult | null>;
  logoutBili: () => Promise<void>;
  syncFavorites: (forceFull?: boolean) => Promise<SyncResult | null>;
  setSyncProgress: (progress: SyncProgressEvent | null) => void;
  setSyncIntervalMin: (minutes: number) => Promise<void>;
  searchBili: (keyword: string) => Promise<void>;
  playOnlineBili: (input: string, cid?: number) => Promise<void>;
  fetchRelatedCrate: (bvid: string, seedTitle: string) => Promise<void>;
  confirmPendingTrack: (
    trackId: string,
    title: string,
    artist: string,
    version?: string
  ) => Promise<void>;
  dismissPendingTrack: (trackId: string) => Promise<void>;
  dismissAllPendingTracks: () => Promise<void>;
  confirmAllPendingTracks: () => Promise<void>;
  refreshCustomRules: () => Promise<void>;
  addCustomRule: (
    uploaderMid: number,
    pattern: string,
    priority: number,
    description: string
  ) => Promise<void>;
  deleteCustomRule: (id: string) => Promise<void>;
  testTitleParser: (
    rawTitle: string,
    ownerName: string,
    ownerMid?: number,
    tname?: string,
    partName?: string,
    customPattern?: string
  ) => Promise<ParsedTrackPreview | null>;
}

const DEFAULT_CRATE = MOCK_CRATES[0];
const DEFAULT_TRACK = DEFAULT_CRATE.tracks[0];
const DEFAULT_NEXT = DEFAULT_CRATE.tracks[1];

const ALL_MOCK_TRACKS: TrackItem[] = MOCK_CRATES.flatMap((c) => c.tracks);

const DEFAULT_QUALITIES: AudioQualityOption[] = [
  { id: 0, label: "自动最高音质" },
  { id: 30251, label: "Hi-Res FLAC" },
  { id: 30280, label: "192K AAC" },
  { id: 30232, label: "132K AAC" },
  { id: 30216, label: "64K AAC" },
];

function loadNumberPref(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function saveNumberPref(key: string, val: number) {
  try {
    localStorage.setItem(key, String(val));
  } catch {
    // Ignore storage quota errors
  }
}

function loadStringPref<T extends string>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return (raw as T) || fallback;
  } catch {
    return fallback;
  }
}

function saveStringPref(key: string, val: string) {
  try {
    localStorage.setItem(key, val);
  } catch {
    // Ignore
  }
}

const LOCAL_CRATES_KEY = "szx_local_crates_v1";

function loadInitialDemoCrates(): CrateItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_CRATES_KEY);
    if (!raw) return MOCK_CRATES;
    const parsed = JSON.parse(raw) as CrateItem[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // Ignore
  }
  return MOCK_CRATES;
}

function saveDemoCrates(crates: CrateItem[]) {
  try {
    localStorage.setItem(LOCAL_CRATES_KEY, JSON.stringify(crates));
  } catch {
    // Ignore
  }
}

function inferSortLetter(title: string): string {
  const ch = title.trim().charAt(0);
  if (!ch) return "M";
  if (/[a-zA-Z]/.test(ch)) return ch.toUpperCase();
  const code = ch.charCodeAt(0);
  if (code >= 0x4e00 && code <= 0x9fff) {
    const buckets = "ABCDEFGHJKLMNOPQRSTWXYZ";
    return buckets[(code - 0x4e00) % buckets.length];
  }
  return "M";
}

function mapBackendCrate(c: BackendLibraryCrate): CrateItem {
  const validKinds: CrateKind[] = [
    "favorite",
    "season",
    "artist",
    "smart",
    "similar",
    "daily",
    "custom",
  ];
  const kind = validKinds.includes(c.kind as CrateKind) ? (c.kind as CrateKind) : "favorite";
  return {
    id: c.id,
    title: c.title,
    subtitle: c.subtitle,
    kind,
    sortKey: c.sortKey,
    covers: c.covers.length > 0 ? c.covers : [DEFAULT_CRATE.covers[0]],
    tracks: c.tracks,
    remoteMediaId: c.remoteMediaId,
    newCount: c.newCount,
  };
}

function mapBackendPending(p: BackendPendingParseItem): PendingParseItem {
  return {
    id: p.id,
    bvid: p.bvid,
    uploader: p.owner,
    ownerMid: p.ownerMid,
    coverUrl: p.coverUrl,
    rawTitle: p.rawTitle,
    suggestedTitle: p.guessTitle,
    suggestedArtist: p.guessArtist,
    version: p.version,
    ruleId: p.ruleId,
    confidence: p.confidence,
    reason: p.reason,
  };
}

function findNextTrackInCrates(
  crates: CrateItem[],
  currentId: string,
  crateId: string
): TrackItem {
  const crate = crates.find((c) => c.id === crateId) ?? crates[0] ?? DEFAULT_CRATE;
  const idx = crate.tracks.findIndex((t) => t.id === currentId);
  if (idx >= 0 && idx + 1 < crate.tracks.length) {
    return crate.tracks[idx + 1];
  }
  const allTracks = crates.flatMap((c) => c.tracks);
  if (allTracks.length === 0) return DEFAULT_NEXT;
  const allIdx = allTracks.findIndex((t) => t.id === currentId);
  return allTracks[(allIdx + 1) % allTracks.length] ?? DEFAULT_NEXT;
}

function makeInitialSpectrum(bins = 28): number[] {
  return Array.from({ length: bins }, (_, i) => {
    const wave = Math.sin(i * 0.42) * 0.25 + 0.35;
    return Math.max(0.08, Math.min(0.95, wave));
  });
}

let browserChannel: BroadcastChannel | null =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("szxmusic-sync") : null;

let latestPlaySeq = 0;

function broadcastSnapshot(state: PlayerStoreState) {
  const payload: SyncStatePayload = {
    theme: state.theme,
    activeCrateId: state.activeCrateId,
    currentTrackId: state.currentTrack.id,
    currentTrack: state.currentTrack,
    nextTrack: state.nextTrack,
    isPlaying: state.isPlaying,
    positionSec: state.positionSec,
    likedIds: state.likedIds,
    volume: state.volume,
    mode: state.mode,
    widgetSize: state.widgetSize,
    widgetLocked: state.widgetLocked,
    clickThrough: state.clickThrough,
    alwaysOnTop: state.alwaysOnTop,
    liveStreamActive: state.liveStreamActive,
    streamStatus: state.streamStatus,
    librarySource: state.librarySource,
    syncStatusText: state.syncStatusText,
  };
  browserChannel?.postMessage(payload);
  void emitAppEvent("szx://state-sync", payload);
}

const INITIAL_CRATES = loadInitialDemoCrates();
const INITIAL_CRATE = INITIAL_CRATES[0] ?? DEFAULT_CRATE;
const INITIAL_TRACK = INITIAL_CRATE.tracks[0] ?? DEFAULT_TRACK;
const INITIAL_NEXT = INITIAL_CRATE.tracks[1] ?? INITIAL_TRACK;

export const usePlayerStore = create<PlayerStoreState>((set, get) => ({
  theme: loadPersistedTheme(DEFAULT_THEME_STORAGE_KEY, "dark"),
  librarySource: "demo",
  crates: INITIAL_CRATES,
  activeCrateId: INITIAL_CRATE.id,
  currentTrack: INITIAL_TRACK,
  nextTrack: INITIAL_NEXT,
  isPlaying: true,
  positionSec: 133,
  volume: loadNumberPref("szx_volume", 80),
  muted: false,
  prevVolume: 80,
  preferredQuality: loadNumberPref("szx_preferred_quality", 0),
  availableQualities: DEFAULT_QUALITIES,
  crateGlassBlur: loadNumberPref("szx_crate_glass_blur", 8),
  mode: "loop:all",
  likedIds: ["trk-1", "trk-6"],
  spectrum: makeInitialSpectrum(28),
  levelL: 0.72,
  levelR: 0.65,
  widgetSize: loadStringPref<WidgetSize>("szx_widget_size", "M"),
  widgetAnchor: loadStringPref<WidgetAnchor>("szx_widget_anchor", "top-right"),
  widgetLocked: true,
  clickThrough: false,
  alwaysOnTop: false,
  autostart: false,
  registryStatus: null,
  liveStreamActive: false,
  streamLoading: false,
  streamStatus: "M0 模拟音频 / 可测 B 站实流解码",

  biliUser: null,
  biliLoadedCount: 0,
  lastSyncAt: 0,
  syncing: false,
  syncProgress: null,
  syncStatusText: "",
  syncIntervalMin: 15,
  pendingItems: isTauriRuntime() ? [] : MOCK_PENDING_ITEMS,
  searchResults: [],
  searching: false,
  customRules: [],

  setTheme: (theme, broadcast = true) => {
    document.documentElement.setAttribute("data-theme", theme);
    savePersistedTheme(theme, DEFAULT_THEME_STORAGE_KEY);
    set({ theme });
    if (isTauriRuntime()) {
      void invokeCore("win_set_theme", { dark: theme === "dark" });
    }
    if (broadcast) broadcastSnapshot(get());
  },

  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    get().setTheme(next, true);
  },

  selectCrate: (crateId, broadcast = true) => {
    const state = get();
    const target = state.crates.find((c) => c.id === crateId);
    if (!target) return;
    set({ activeCrateId: crateId });
    if (broadcast) broadcastSnapshot(get());
  },

  switchLibrarySource: (source) => {
    if (source === "demo") {
      const demoCrates = loadInitialDemoCrates();
      const firstCrate = demoCrates[0] ?? DEFAULT_CRATE;
      const firstTrack = firstCrate.tracks[0] ?? DEFAULT_TRACK;
      set({
        librarySource: "demo",
        crates: demoCrates,
        activeCrateId: firstCrate.id,
        currentTrack: firstTrack,
        nextTrack: firstCrate.tracks[1] ?? firstTrack,
        isPlaying: true,
        positionSec: 0,
        liveStreamActive: false,
        pendingItems: MOCK_PENDING_ITEMS,
        streamStatus: "演示黑胶库（离线样本）",
      });
      if (isTauriRuntime()) {
        void invokeCore("player_stop_stream");
      }
      broadcastSnapshot(get());
      return;
    }

    if (isTauriRuntime()) {
      void invokeCore<LibrarySnapshot>("lib_get_snapshot").then((snap) => {
        if (!snap) return;
        get().applyLibrarySnapshot(snap, true);
      });
    }
  },

  playTrack: (track, crateId, broadcast = true) => {
    const state = get();
    const cid = crateId ?? state.activeCrateId;
    const nextTrack = findNextTrackInCrates(state.crates, track.id, cid);
    const shouldStreamBili = isTauriRuntime() && track.bvid.startsWith("BV");
    set({
      activeCrateId: cid,
      currentTrack: track,
      nextTrack,
      isPlaying: true,
      positionSec: 0,
      liveStreamActive: false,
      streamStatus: shouldStreamBili
        ? `准备拉取 ${track.bvid} 音频流…`
        : "演示模式（浏览器预览）",
    });
    if (isTauriRuntime() && !shouldStreamBili) {
      void invokeCore("player_stop_stream");
    }
    if (broadcast) broadcastSnapshot(get());

    if (shouldStreamBili) {
      void get().playRealBiliStream(
        track.bvid,
        track.cid,
        track.title,
        track.artist,
        track.coverUrl,
        track.id
      );
    }
  },

  togglePlay: (broadcast = true) => {
    const nextPlaying = !get().isPlaying;
    set({ isPlaying: nextPlaying });
    if (isTauriRuntime()) {
      void invokeCore("player_set_paused", { paused: !nextPlaying });
    }
    if (broadcast) broadcastSnapshot(get());
  },

  seek: (sec, broadcast = true) => {
    const state = get();
    const clamped = Math.max(0, Math.min(state.currentTrack.durationSec, sec));
    set({ positionSec: clamped });
    if (isTauriRuntime() && state.liveStreamActive) {
      void invokeCore("player_seek", { positionSec: clamped });
    }
    if (broadcast) broadcastSnapshot(get());
  },

  stepTrack: (delta) => {
    const { crates, activeCrateId, currentTrack } = get();
    const crate = crates.find((c) => c.id === activeCrateId) ?? crates[0] ?? DEFAULT_CRATE;

    // 1. Multi-P / Anthology Video Sequential Playback:
    // If the current video has multiple pages (pages.length > 1), step through P1 -> P2 -> P3 in order
    // before jumping to the next video in the crate!
    if (currentTrack.pages && currentTrack.pages.length > 1) {
      const currPageIdx = currentTrack.pages.findIndex(
        (p) => (currentTrack.cid && p.cid === currentTrack.cid) || p.page === currentTrack.page
      );
      const nextPageIdx = (currPageIdx >= 0 ? currPageIdx : 0) + delta;
      if (nextPageIdx >= 0 && nextPageIdx < currentTrack.pages.length) {
        const targetPage = currentTrack.pages[nextPageIdx];
        // Check if the crate already has a dedicated track row for this page
        const existingPageRow = crate.tracks.find(
          (t) =>
            t.bvid === currentTrack.bvid &&
            (t.page === targetPage.page || (targetPage.cid > 0 && t.cid === targetPage.cid))
        );
        if (existingPageRow && existingPageRow.id !== currentTrack.id) {
          get().playTrack(existingPageRow, crate.id, true);
          return;
        }
        // Otherwise advance page within currentTrack in-place
        const baseTitle = currentTrack.rawTitle
          ? currentTrack.title.replace(/\s*(?:·\s*P\d+.*|\(P\d+\))$/i, "")
          : currentTrack.title;
        const partSuffix = targetPage.part
          ? ` · P${targetPage.page} ${targetPage.part}`
          : ` (P${targetPage.page})`;
        const updatedTrack: TrackItem = {
          ...currentTrack,
          cid: targetPage.cid,
          page: targetPage.page,
          title: `${baseTitle}${partSuffix}`,
          coverUrl: targetPage.first_frame || currentTrack.coverUrl,
          durationSec: targetPage.duration > 0 ? targetPage.duration : currentTrack.durationSec,
        };
        get().playTrack(updatedTrack, crate.id, true);
        return;
      }
    }

    // 2. Otherwise step in the current crate's playlist (respecting "radio" shuffle vs sequential)
    const { mode } = get();
    const allTracks = crates.flatMap((c) => c.tracks);
    const list =
      crate.tracks.length > 0
        ? crate.tracks
        : allTracks.length > 0
          ? allTracks
          : ALL_MOCK_TRACKS;
    if (list.length === 0) return;
    const idx = list.findIndex(
      (t) => t.id === currentTrack.id || (t.bvid === currentTrack.bvid && t.page === currentTrack.page)
    );
    let targetIdx: number;
    if (mode === "radio" && list.length > 2) {
      const offset = 1 + Math.floor(Math.random() * (list.length - 1));
      targetIdx = ((idx < 0 ? 0 : idx) + offset) % list.length;
    } else {
      targetIdx = idx < 0 ? 0 : (idx + delta + list.length) % list.length;
    }
    get().playTrack(list[targetIdx], crate.id, true);
  },

  onLiveTrackEnded: () => {
    const state = get();
    if (state.mode === "loop:one") {
      state.playTrack(state.currentTrack, state.activeCrateId, true);
      return;
    }
    state.stepTrack(1);
  },

  toggleLike: (trackId) => {
    const curr = get().likedIds;
    const optimistic = curr.includes(trackId)
      ? curr.filter((id) => id !== trackId)
      : [...curr, trackId];
    set({ likedIds: optimistic });
    broadcastSnapshot(get());
    if (isTauriRuntime() && (get().librarySource === "bili" || !trackId.startsWith("trk-"))) {
      void invokeCore<string[]>("lib_toggle_like", { trackId }).then((serverLiked) => {
        if (serverLiked) {
          set({ likedIds: serverLiked });
          broadcastSnapshot(get());
        }
      });
    }
  },

  cycleMode: () => {
    const order: Array<"radio" | "loop:all" | "loop:one"> = ["radio", "loop:all", "loop:one"];
    const idx = order.indexOf(get().mode);
    set({ mode: order[(idx + 1) % order.length] });
    broadcastSnapshot(get());
  },

  setVolume: (vol) => {
    const clamped = Math.max(0, Math.min(100, Math.round(vol)));
    const prevVol = clamped > 0 ? clamped : get().prevVolume;
    saveNumberPref("szx_volume", clamped);
    set({ volume: clamped, muted: clamped === 0, prevVolume: prevVol });
    if (isTauriRuntime()) {
      void invokeCore("player_set_volume", { volume: clamped / 100 });
    }
    broadcastSnapshot(get());
  },

  toggleMute: () => {
    const { muted, volume, prevVolume } = get();
    if (muted || volume === 0) {
      const restore = prevVolume > 0 ? prevVolume : 75;
      get().setVolume(restore);
    } else {
      set({ prevVolume: volume, volume: 0, muted: true });
      if (isTauriRuntime()) {
        void invokeCore("player_set_volume", { volume: 0 });
      }
      broadcastSnapshot(get());
    }
  },

  setPreferredQuality: (qualityId) => {
    saveNumberPref("szx_preferred_quality", qualityId);
    set({ preferredQuality: qualityId });
    const state = get();
    if (isTauriRuntime() && state.currentTrack.bvid.startsWith("BV")) {
      void state.playRealBiliStream(
        state.currentTrack.bvid,
        state.currentTrack.cid,
        state.currentTrack.title,
        state.currentTrack.artist,
        state.currentTrack.coverUrl,
        state.currentTrack.id
      );
    }
  },

  setCrateGlassBlur: (blurPx) => {
    const clamped = Math.max(0, Math.min(24, Math.round(blurPx)));
    saveNumberPref("szx_crate_glass_blur", clamped);
    set({ crateGlassBlur: clamped });
  },

  fetchTrackLyrics: async (bvid, cid, title, artist) => {
    if (!isTauriRuntime()) return null;
    return invokeCore<TrackLyricsBundle>("bili_get_track_lyrics", {
      bvid,
      cid: cid ?? null,
      title: title ?? "",
      artist: artist ?? "",
    });
  },

  createCrate: async (title, subtitle = "自定义黑胶") => {
    const cleanTitle = title.trim();
    if (!cleanTitle) return null;
    const cleanSub = subtitle.trim() || "自定义黑胶";

    if (isTauriRuntime() && get().librarySource === "bili") {
      const snap = await invokeCore<LibrarySnapshot>("lib_create_crate", {
        title: cleanTitle,
        subtitle: cleanSub,
      });
      if (snap) {
        get().applyLibrarySnapshot(snap, true);
        const created = get().crates.find((c) => c.title === cleanTitle);
        if (created) {
          set({ activeCrateId: created.id });
          broadcastSnapshot(get());
          return created.id;
        }
      }
      return null;
    }

    const newId = `custom-${Date.now()}`;
    const newCrate: CrateItem = {
      id: newId,
      title: cleanTitle,
      subtitle: cleanSub,
      kind: "custom",
      sortKey: inferSortLetter(cleanTitle),
      covers: [DEFAULT_CRATE.covers[0]],
      tracks: [],
    };
    const nextCrates = [newCrate, ...get().crates];
    saveDemoCrates(nextCrates);
    set({ crates: nextCrates, activeCrateId: newId });
    broadcastSnapshot(get());
    return newId;
  },

  renameCrate: async (crateId, title, subtitle) => {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;

    if (isTauriRuntime() && get().librarySource === "bili") {
      const snap = await invokeCore<LibrarySnapshot>("lib_rename_crate", {
        crateId,
        title: cleanTitle,
        subtitle: subtitle ?? null,
      });
      if (snap) {
        get().applyLibrarySnapshot(snap, true);
        return;
      }
    }

    const nextCrates = get().crates.map((c) =>
      c.id === crateId
        ? {
            ...c,
            title: cleanTitle,
            subtitle: subtitle?.trim() ? subtitle.trim() : c.subtitle,
            sortKey: inferSortLetter(cleanTitle),
          }
        : c
    );
    saveDemoCrates(nextCrates);
    set({ crates: nextCrates });
    broadcastSnapshot(get());
  },

  deleteCrate: async (crateId) => {
    if (isTauriRuntime() && get().librarySource === "bili") {
      const snap = await invokeCore<LibrarySnapshot>("lib_delete_crate", { crateId });
      if (snap) {
        get().applyLibrarySnapshot(snap, true);
        return;
      }
    }

    const currentCrates = get().crates;
    if (currentCrates.length <= 1) return;
    const nextCrates = currentCrates.filter((c) => c.id !== crateId);
    const nextActive =
      get().activeCrateId === crateId
        ? (nextCrates[0]?.id ?? DEFAULT_CRATE.id)
        : get().activeCrateId;
    saveDemoCrates(nextCrates);
    set({ crates: nextCrates, activeCrateId: nextActive });
    broadcastSnapshot(get());
  },

  addTrackToCrate: async (crateId, track) => {
    if (isTauriRuntime() && get().librarySource === "bili") {
      const backendTrack = {
        id: track.id,
        bvid: track.bvid,
        cid: track.cid ?? 0,
        page: track.page || 1,
        pages: track.pages ?? [],
        rawTitle: track.rawTitle || track.title,
        title: track.title,
        artist: track.artist,
        version: track.version || "Original",
        confidence: track.confidence || 0.9,
        ruleId: track.ruleId || "manual",
        reason: track.reason ?? "",
        tags: track.tags ?? [],
        durationSec: track.durationSec || 180,
        qualityLabel: track.qualityLabel || "DASH 音频",
        coverUrl: track.coverUrl || DEFAULT_CRATE.covers[0],
        bpm: track.bpm || 100,
        musicalKey: track.musicalKey || "C",
        energy: track.energy || 3,
        reasonTag: track.reasonTag || "手动加入",
        isInvalid: Boolean(track.isInvalid),
        isNew: false,
      };
      const snap = await invokeCore<LibrarySnapshot>("lib_add_track_to_crate", {
        crateId,
        track: backendTrack,
      });
      if (snap) {
        get().applyLibrarySnapshot(snap, true);
        return;
      }
    }

    const nextCrates = get().crates.map((c) => {
      if (c.id !== crateId) return c;
      if (c.tracks.some((t) => t.id === track.id)) return c;
      const nextTracks = [...c.tracks, track];
      const nextCovers = Array.from(
        new Set([track.coverUrl, ...c.covers].filter(Boolean))
      ).slice(0, 4);
      return {
        ...c,
        tracks: nextTracks,
        covers: nextCovers.length > 0 ? nextCovers : c.covers,
      };
    });
    saveDemoCrates(nextCrates);
    set({ crates: nextCrates });
    broadcastSnapshot(get());
  },

  removeTrackFromCrate: async (crateId, trackId) => {
    if (isTauriRuntime() && get().librarySource === "bili") {
      const snap = await invokeCore<LibrarySnapshot>("lib_remove_track_from_crate", {
        crateId,
        trackId,
      });
      if (snap) {
        get().applyLibrarySnapshot(snap, true);
        return;
      }
    }

    const nextCrates = get().crates.map((c) => {
      if (c.id !== crateId) return c;
      return {
        ...c,
        tracks: c.tracks.filter((t) => t.id !== trackId),
      };
    });
    saveDemoCrates(nextCrates);
    set({ crates: nextCrates });
    broadcastSnapshot(get());
  },

  transferTracksToCrate: async (fromCrateId, toCrateId, bvidFilter, moveTracks = true) => {
    if (!fromCrateId || !toCrateId) return;
    if (isTauriRuntime() && get().librarySource === "bili") {
      const snap = await invokeCore<LibrarySnapshot>("lib_transfer_tracks", {
        fromCrateId,
        toCrateId,
        bvidFilter: bvidFilter?.trim() ? bvidFilter.trim() : null,
        moveTracks,
      });
      if (snap) {
        get().applyLibrarySnapshot(snap, true);
        set({ activeCrateId: toCrateId });
        broadcastSnapshot(get());
        return;
      }
    }

    const state = get();
    const srcCrate = state.crates.find((c) => c.id === fromCrateId);
    if (!srcCrate) return;
    const toTransfer = bvidFilter?.trim()
      ? srcCrate.tracks.filter((t) => t.bvid === bvidFilter.trim())
      : srcCrate.tracks;
    if (toTransfer.length === 0) return;
    const transferIds = new Set(toTransfer.map((t) => t.id));

    const nextCrates = state.crates.map((c) => {
      if (c.id === toCrateId) {
        const existingIds = new Set(c.tracks.map((t) => t.id));
        const merged = [...c.tracks, ...toTransfer.filter((t) => !existingIds.has(t.id))];
        const nextCovers = Array.from(
          new Set([...merged.map((t) => t.coverUrl), ...c.covers].filter(Boolean))
        ).slice(0, 4);
        return { ...c, tracks: merged, covers: nextCovers.length > 0 ? nextCovers : c.covers };
      }
      if (moveTracks && c.id === fromCrateId && fromCrateId !== toCrateId) {
        return { ...c, tracks: c.tracks.filter((t) => !transferIds.has(t.id)) };
      }
      return c;
    });
    saveDemoCrates(nextCrates);
    set({ crates: nextCrates, activeCrateId: toCrateId });
    broadcastSnapshot(get());
  },

  createCrateWithTracks: async (title, subtitle, fromCrateId, bvidFilter, moveTracks = true) => {
    const cleanTitle = title.trim();
    if (!cleanTitle) return null;
    const cleanSub = subtitle.trim() || "自定义黑胶";

    if (isTauriRuntime() && get().librarySource === "bili") {
      const res = await invokeCore<[string, LibrarySnapshot]>("lib_create_crate_and_transfer", {
        title: cleanTitle,
        subtitle: cleanSub,
        fromCrateId,
        bvidFilter: bvidFilter?.trim() ? bvidFilter.trim() : null,
        moveTracks,
      });
      if (res) {
        const [newId, snap] = res;
        get().applyLibrarySnapshot(snap, true);
        set({ activeCrateId: newId });
        broadcastSnapshot(get());
        return newId;
      }
    }

    const newId = await get().createCrate(cleanTitle, cleanSub);
    if (newId) {
      await get().transferTracksToCrate(fromCrateId, newId, bvidFilter, moveTracks);
    }
    return newId;
  },

  setWidgetSize: (widgetSize) => {
    saveStringPref("szx_widget_size", widgetSize);
    set({ widgetSize });
    if (isTauriRuntime()) {
      void invokeCore("win_resize_widget", { size: widgetSize });
    }
    broadcastSnapshot(get());
  },

  setWidgetAnchor: (widgetAnchor) => {
    saveStringPref("szx_widget_anchor", widgetAnchor);
    set({ widgetAnchor });
    if (isTauriRuntime()) {
      void invokeCore("win_set_widget_anchor", { anchor: widgetAnchor });
    }
    broadcastSnapshot(get());
  },

  setWidgetLocked: (widgetLocked) => {
    set({ widgetLocked });
    broadcastSnapshot(get());
  },

  setClickThrough: (clickThrough) => {
    set({ clickThrough });
    if (isTauriRuntime()) {
      void invokeCore("win_set_click_through", { enabled: clickThrough });
    }
    broadcastSnapshot(get());
  },

  setAlwaysOnTop: (alwaysOnTop) => {
    set({ alwaysOnTop });
    if (isTauriRuntime()) {
      void invokeCore("win_set_always_on_top", { enabled: alwaysOnTop });
    }
    broadcastSnapshot(get());
  },

  setAutostart: (autostart) => {
    set({ autostart });
    if (isTauriRuntime()) {
      void invokeCore<WinRegistryStatus>("win_set_autostart", { enabled: autostart }).then((st) => {
        if (st) set({ autostart: st.autostart, registryStatus: st });
      });
    }
  },

  refreshRegistryStatus: async () => {
    if (!isTauriRuntime()) return null;
    const st = await invokeCore<WinRegistryStatus>("win_get_registry_status");
    if (st) {
      set({ autostart: st.autostart, registryStatus: st });
    }
    return st;
  },

  registerWindowsApp: async () => {
    if (!isTauriRuntime()) return null;
    const st = await invokeCore<WinRegistryStatus>("win_register_app");
    if (st) {
      set({ autostart: st.autostart, registryStatus: st });
    }
    return st;
  },

  unregisterWindowsApp: async () => {
    if (!isTauriRuntime()) return null;
    const st = await invokeCore<WinRegistryStatus>("win_unregister_app");
    if (st) {
      set({ autostart: st.autostart, registryStatus: st });
    }
    return st;
  },

  tickSimulation: (dtSec, advancePosition = true) => {
    const state = get();
    if (state.liveStreamActive || state.streamLoading) return;

    if (!state.isPlaying) {
      const decayed = state.spectrum.map((v) => Math.max(0.05, v * 0.84));
      set({
        spectrum: decayed,
        levelL: Math.max(0.03, state.levelL * 0.8),
        levelR: Math.max(0.03, state.levelR * 0.8),
      });
      return;
    }

    const now = performance.now() / 1000;
    const dur = Math.max(1, state.currentTrack.durationSec || 180);
    const nextPos = advancePosition ? state.positionSec + dtSec : state.positionSec;
    if (advancePosition && nextPos >= dur) {
      get().onLiveTrackEnded();
      return;
    }

    const energyScale = 0.55 + (state.currentTrack.energy || 3) * 0.09;
    const spectrum = state.spectrum.map((_, i) => {
      const bandCenter = 1 - Math.abs(i - 10) / 18;
      const beat =
        0.5 +
        0.32 * Math.sin(now * ((state.currentTrack.bpm || 100) / 15) + i * 0.55) +
        0.18 * Math.cos(now * 9.3 - i * 0.82);
      return Math.max(0.08, Math.min(0.98, beat * energyScale * (0.68 + bandCenter * 0.42)));
    });

    const avg = spectrum.reduce((a, b) => a + b, 0) / spectrum.length;
    set({
      positionSec: nextPos,
      spectrum,
      levelL: Math.min(0.96, avg * 1.15 + 0.08 * Math.sin(now * 7)),
      levelR: Math.min(0.96, avg * 1.08 + 0.08 * Math.cos(now * 6.5)),
    });
  },

  applyLiveTelemetry: (payload) => {
    set((prev) => {
      const nextBpm =
        payload.bpm && payload.bpm > 0 ? payload.bpm : prev.currentTrack.bpm;
      const nextKey =
        payload.musicalKey && payload.musicalKey.trim()
          ? payload.musicalKey
          : prev.currentTrack.musicalKey;
      const nextEnergy =
        payload.energy && payload.energy >= 1 && payload.energy <= 5
          ? (payload.energy as 1 | 2 | 3 | 4 | 5)
          : prev.currentTrack.energy;
      const metaChanged =
        nextBpm !== prev.currentTrack.bpm ||
        nextKey !== prev.currentTrack.musicalKey ||
        nextEnergy !== prev.currentTrack.energy;

      return {
        spectrum: payload.spectrum ?? prev.spectrum,
        levelL: payload.levelL ?? prev.levelL,
        levelR: payload.levelR ?? prev.levelR,
        positionSec: payload.positionSec ?? prev.positionSec,
        isPlaying: payload.isPlaying ?? prev.isPlaying,
        liveStreamActive: payload.liveStreamActive ?? prev.liveStreamActive,
        streamStatus: payload.streamStatus ?? prev.streamStatus,
        currentTrack: metaChanged
          ? {
              ...prev.currentTrack,
              bpm: nextBpm,
              musicalKey: nextKey,
              energy: nextEnergy,
            }
          : prev.currentTrack,
      };
    });
  },

  applyRemoteSync: (payload) => {
    if (payload.theme) {
      document.documentElement.setAttribute("data-theme", payload.theme);
      savePersistedTheme(payload.theme, DEFAULT_THEME_STORAGE_KEY);
    }
    set((prev) => {
      const allTracks = prev.crates.flatMap((c) => c.tracks);
      const nextCrateId = payload.activeCrateId ?? prev.activeCrateId;
      const resolvedTrack =
        payload.currentTrack ??
        (payload.currentTrackId && payload.currentTrackId !== prev.currentTrack.id
          ? allTracks.find((t) => t.id === payload.currentTrackId) ??
            ALL_MOCK_TRACKS.find((t) => t.id === payload.currentTrackId) ??
            prev.currentTrack
          : prev.currentTrack);
      const nextTrack =
        payload.nextTrack ?? findNextTrackInCrates(prev.crates, resolvedTrack.id, nextCrateId);

      return {
        theme: payload.theme ?? prev.theme,
        activeCrateId: nextCrateId,
        currentTrack: resolvedTrack,
        nextTrack,
        isPlaying: payload.isPlaying ?? prev.isPlaying,
        positionSec: payload.positionSec ?? prev.positionSec,
        likedIds: payload.likedIds ?? prev.likedIds,
        volume: payload.volume ?? prev.volume,
        mode: payload.mode ?? prev.mode,
        widgetSize: payload.widgetSize ?? prev.widgetSize,
        widgetLocked: payload.widgetLocked ?? prev.widgetLocked,
        clickThrough: payload.clickThrough ?? prev.clickThrough,
        alwaysOnTop: payload.alwaysOnTop ?? prev.alwaysOnTop,
        liveStreamActive: payload.liveStreamActive ?? prev.liveStreamActive,
        streamStatus: payload.streamStatus ?? prev.streamStatus,
        librarySource: payload.librarySource ?? prev.librarySource,
        syncStatusText: payload.syncStatusText ?? prev.syncStatusText,
      };
    });
  },

  applyLibrarySnapshot: (snapshot, preferLive = false) => {
    const mappedCrates = snapshot.crates.map(mapBackendCrate);
    const mappedPending = snapshot.pending.map(mapBackendPending);
    const totalTracks = mappedCrates.reduce((acc, c) => acc + c.tracks.length, 0);

    set((prev) => {
      const useLive =
        mappedCrates.length > 0 && (preferLive || prev.librarySource === "bili" || prev.biliLoadedCount === 0);
      if (!useLive) {
        return {
          biliLoadedCount: totalTracks,
          lastSyncAt: snapshot.lastSyncAt,
          pendingItems: mappedPending,
        };
      }

      const activeCrate =
        mappedCrates.find((c) => c.id === prev.activeCrateId) ?? mappedCrates[0];
      const allTracks = mappedCrates.flatMap((c) => c.tracks);
      const matchingTrack =
        allTracks.find((t) => t.id === prev.currentTrack.id) ??
        activeCrate.tracks[0] ??
        allTracks[0] ??
        prev.currentTrack;

      return {
        librarySource: "bili",
        biliLoadedCount: totalTracks,
        lastSyncAt: snapshot.lastSyncAt,
        crates: mappedCrates,
        activeCrateId: activeCrate.id,
        currentTrack: matchingTrack,
        nextTrack: findNextTrackInCrates(mappedCrates, matchingTrack.id, activeCrate.id),
        likedIds: snapshot.likedIds,
        pendingItems: mappedPending,
      };
    });
    broadcastSnapshot(get());
  },

  playRealBiliStream: async (bvid, cid, title, artist, coverUrl, trackId) => {
    if (!isTauriRuntime()) {
      set({ streamStatus: "仅 Tauri 桌面端可拉取 B 站真实音频流" });
      return false;
    }
    const seq = ++latestPlaySeq;
    const prefQ = get().preferredQuality;
    set({
      streamLoading: true,
      streamStatus: `正在拉取 ${bvid} 音频流并由 symphonia 解码…`,
    });
    try {
      const res = await invokeCore<BiliPlaySummary>("player_play_bili_stream", {
        bvid,
        cid: cid ?? null,
        preferredQuality: prefQ > 0 ? prefQ : null,
      });
      if (!res || seq !== latestPlaySeq) return false;

      const stateNow = get();
      const matchedInCrates = stateNow.crates
        .flatMap((c) => c.tracks)
        .find((t) => (trackId ? t.id === trackId : t.bvid === res.bvid));
      const baseTrack = matchedInCrates ?? stateNow.currentTrack;
      const cleanQ = res.quality_label.includes(res.codec)
        ? res.quality_label
        : `${res.quality_label} · ${res.codec}`;
      const liveTrack: TrackItem = {
        ...baseTrack,
        id: trackId ?? baseTrack.id,
        bvid: res.bvid,
        cid: res.cid,
        page: res.page ?? baseTrack.page ?? 1,
        pages:
          res.pages && res.pages.length > 0
            ? res.pages
            : baseTrack.pages,
        rawTitle: res.title,
        title: title ?? res.title,
        artist: artist ?? res.owner,
        coverUrl: res.cover_url || coverUrl || baseTrack.coverUrl,
        durationSec: Math.max(1, Math.round(res.duration_sec)),
        qualityLabel: cleanQ,
        bpm: res.bpm && res.bpm > 0 ? res.bpm : baseTrack.bpm,
        musicalKey: res.musical_key || baseTrack.musicalKey,
        energy:
          res.energy && res.energy >= 1 && res.energy <= 5
            ? (res.energy as 1 | 2 | 3 | 4 | 5)
            : baseTrack.energy,
      };
      const updatedCrates = stateNow.crates.map((c) => ({
        ...c,
        tracks: c.tracks.map((t) =>
          t.id === liveTrack.id
            ? {
                ...t,
                cid: liveTrack.cid,
                pages: liveTrack.pages ?? t.pages,
                coverUrl: liveTrack.coverUrl || t.coverUrl,
                durationSec: liveTrack.durationSec,
                qualityLabel: liveTrack.qualityLabel,
                bpm: liveTrack.bpm,
                musicalKey: liveTrack.musicalKey,
                energy: liveTrack.energy,
              }
            : t
        ),
      }));
      set({
        crates: updatedCrates,
        currentTrack: liveTrack,
        availableQualities:
          res.available_qualities && res.available_qualities.length > 0
            ? [{ id: 0, label: "自动最高音质" }, ...res.available_qualities]
            : DEFAULT_QUALITIES,
        isPlaying: true,
        positionSec: 0,
        liveStreamActive: true,
        streamLoading: false,
        streamStatus: `LIVE ${res.quality_label}: ${res.codec} ${res.sample_rate}Hz ${res.channels}ch${res.from_cache ? " [CACHE]" : ""}`,
      });
      broadcastSnapshot(get());
      return true;
    } catch (err) {
      if (seq !== latestPlaySeq) return false;
      const isMockDemo = trackId?.startsWith("trk-") ?? false;
      set({
        liveStreamActive: false,
        streamLoading: false,
        streamStatus: isMockDemo
          ? `示例 BV 不可用，已回退本地模拟 (${String(err).slice(0, 48)})`
          : `拉流失败: ${String(err)}`,
      });
      return false;
    }
  },

  initBiliWorkspace: async () => {
    if (!isTauriRuntime()) return;
    const st = get();
    void invokeCore("player_set_volume", {
      volume: st.muted ? 0 : Math.max(0, Math.min(1, st.volume / 100)),
    });
    void invokeCore("win_resize_widget", { size: st.widgetSize });
    void invokeCore("win_set_widget_anchor", { anchor: st.widgetAnchor });
    try {
      const [user, snap, interval, rules, reg] = await Promise.all([
        invokeCore<BiliUserInfo>("bili_get_account_status"),
        invokeCore<LibrarySnapshot>("lib_get_snapshot"),
        invokeCore<number>("lib_get_sync_interval"),
        invokeCore<CustomRuleDto[]>("lib_list_rules"),
        invokeCore<WinRegistryStatus>("win_get_registry_status"),
      ]);
      set((prev) => ({
        biliUser: user ?? prev.biliUser,
        syncIntervalMin: typeof interval === "number" ? interval : prev.syncIntervalMin,
        customRules: rules ?? prev.customRules,
        registryStatus: reg ?? prev.registryStatus,
        autostart: reg ? reg.autostart : prev.autostart,
      }));
      if (snap) {
        get().applyLibrarySnapshot(snap, snap.crates.length > 0);
      }
    } catch (err) {
      set({ syncStatusText: `初始化失败: ${String(err)}` });
    }
  },

  startQrLogin: async () => {
    if (!isTauriRuntime()) return null;
    return invokeCore<QrLoginStart>("bili_auth_qr_start");
  },

  pollQrLogin: async (qrcodeKey) => {
    if (!isTauriRuntime()) return null;
    const res = await invokeCore<QrPollResult>("bili_auth_qr_poll", { qrcodeKey });
    if (res && res[0].status === "confirmed" && res[1]) {
      set({
        biliUser: res[1],
        syncStatusText: `已登录 ${res[1].uname}，正在同步收藏夹…`,
      });
      void get().syncFavorites(false);
    }
    return res;
  },

  logoutBili: async () => {
    if (!isTauriRuntime()) return;
    const guest = await invokeCore<BiliUserInfo>("bili_auth_logout");
    set({
      biliUser: guest ?? {
        is_login: false,
        mid: 0,
        uname: "未登录（访客试听）",
        face: "",
        vip_type: 0,
        vip_label: "访客",
      },
      syncStatusText: "已退出 B 站账号",
    });
  },

  syncFavorites: async (forceFull = false) => {
    if (!isTauriRuntime()) {
      set({ syncStatusText: "仅桌面端支持登录并同步 B 站收藏夹" });
      return null;
    }
    set({
      syncing: true,
      syncProgress: {
        stage: "folders",
        current: 0,
        total: 1,
        folderTitle: "正在拉取收藏夹目录…",
        addedCount: 0,
      },
      syncStatusText: "正在同步 B 站收藏夹与合集…",
    });
    try {
      const res = await invokeCore<SyncResult>("bili_sync_favorites", { forceFull });
      if (!res) {
        set({ syncing: false, syncProgress: null });
        return null;
      }
      const statusText =
        res.newTracksCount > 0
          ? `同步完成：共 ${res.cratesCount} 个黑胶箱 / +${res.newTracksCount} 首新入库`
          : `增量校验完成：${res.cratesCount} 个黑胶箱 · ${res.tracksCount} 首曲目已最新`;
      set({
        syncing: false,
        syncProgress: null,
        syncStatusText: statusText,
      });
      get().applyLibrarySnapshot(res.snapshot, true);
      return res;
    } catch (err) {
      set({
        syncing: false,
        syncProgress: null,
        syncStatusText: `同步失败: ${String(err)}`,
      });
      return null;
    }
  },

  setSyncProgress: (syncProgress) => set({ syncProgress }),

  setSyncIntervalMin: async (minutes) => {
    const clean = Math.max(0, Math.min(240, Math.round(minutes)));
    set({ syncIntervalMin: clean });
    if (isTauriRuntime()) {
      await invokeCore("lib_set_sync_interval", { minutes: clean });
    }
  },

  searchBili: async (keyword) => {
    const clean = keyword.trim();
    if (!clean) {
      set({ searchResults: [] });
      return;
    }
    if (!isTauriRuntime()) {
      set({ streamStatus: "仅 Tauri 桌面端可执行实时 B 站全站搜索" });
      return;
    }
    set({ searching: true });
    try {
      const items = await invokeCore<SearchParsedItem[]>("bili_search_and_parse", {
        keyword: clean,
        page: 1,
      });
      set({ searchResults: items ?? [], searching: false });
    } catch (err) {
      set({ searching: false, streamStatus: `搜索失败: ${String(err)}` });
    }
  },

  playOnlineBili: async (input, cid) => {
    if (!isTauriRuntime()) {
      set({ streamStatus: "仅 Tauri 桌面端可拉取 B 站真实音频流" });
      return;
    }
    const seq = ++latestPlaySeq;
    const prefQ = get().preferredQuality;
    set({ streamLoading: true, streamStatus: `正在解析并拉取 ${input}…` });
    try {
      const res = await invokeCore<OnlinePlayResponse>("bili_play_online", {
        input,
        cid: cid ?? null,
        preferredQuality: prefQ > 0 ? prefQ : null,
      });
      if (!res || seq !== latestPlaySeq) return;
      get().applyLibrarySnapshot(res.snapshot, true);
      const state = get();
      const onlineCrate =
        state.crates.find((c) => c.tracks.some((t) => t.id === res.track.id)) ??
        state.crates[0];
      const cleanQ = res.summary.quality_label.includes(res.summary.codec)
        ? res.summary.quality_label
        : `${res.summary.quality_label} · ${res.summary.codec}`;
      set({
        activeCrateId: onlineCrate?.id ?? state.activeCrateId,
        currentTrack: {
          ...res.track,
          qualityLabel: cleanQ,
          bpm: res.summary.bpm && res.summary.bpm > 0 ? res.summary.bpm : res.track.bpm,
          musicalKey: res.summary.musical_key || res.track.musicalKey,
          energy:
            res.summary.energy && res.summary.energy >= 1 && res.summary.energy <= 5
              ? (res.summary.energy as 1 | 2 | 3 | 4 | 5)
              : (res.track.energy as 1 | 2 | 3 | 4 | 5),
        },
        availableQualities:
          res.summary.available_qualities && res.summary.available_qualities.length > 0
            ? [{ id: 0, label: "自动最高音质" }, ...res.summary.available_qualities]
            : DEFAULT_QUALITIES,
        nextTrack: findNextTrackInCrates(
          state.crates,
          res.track.id,
          onlineCrate?.id ?? state.activeCrateId
        ),
        isPlaying: true,
        positionSec: 0,
        liveStreamActive: true,
        streamLoading: false,
        streamStatus: `LIVE ${res.summary.quality_label}: ${res.summary.codec} ${res.summary.sample_rate}Hz${res.summary.from_cache ? " [CACHE]" : ""}`,
      });
      broadcastSnapshot(get());
    } catch (err) {
      if (seq !== latestPlaySeq) return;
      set({ streamLoading: false, streamStatus: `在线点播失败: ${String(err)}` });
    }
  },

  fetchRelatedCrate: async (bvid, seedTitle) => {
    if (!isTauriRuntime()) {
      set({ streamStatus: "仅 Tauri 桌面端可拉取 B 站相似推荐" });
      return;
    }
    set({ streamStatus: `正在提取《${seedTitle}》B 站相似推荐曲库…` });
    try {
      const snap = await invokeCore<LibrarySnapshot>("bili_fetch_related_crate", {
        bvid,
        seedTitle,
      });
      if (!snap) return;
      get().applyLibrarySnapshot(snap, true);
      const relatedId = `similar-${bvid}`;
      const found = get().crates.find((c) => c.id === relatedId);
      if (found) {
        set({
          activeCrateId: found.id,
          streamStatus: `已生成相似推荐箱：${found.title}（${found.tracks.length} 首）`,
        });
        broadcastSnapshot(get());
      }
    } catch (err) {
      set({ streamStatus: `拉取相似推荐失败: ${String(err)}` });
    }
  },

  confirmPendingTrack: async (trackId, title, artist, version = "") => {
    if (!isTauriRuntime()) {
      set((prev) => ({
        pendingItems: prev.pendingItems.filter((p) => p.id !== trackId),
      }));
      return;
    }
    const snap = await invokeCore<LibrarySnapshot>("lib_confirm_pending", {
      trackId,
      title,
      artist,
      version,
    });
    if (snap) {
      get().applyLibrarySnapshot(snap, snap.crates.length > 0);
    }
  },

  dismissPendingTrack: async (trackId) => {
    if (!isTauriRuntime()) {
      set((prev) => ({
        pendingItems: prev.pendingItems.filter((p) => p.id !== trackId),
      }));
      return;
    }
    const snap = await invokeCore<LibrarySnapshot>("lib_dismiss_pending", {
      trackId,
    });
    if (snap) {
      get().applyLibrarySnapshot(snap, snap.crates.length > 0);
    }
  },

  dismissAllPendingTracks: async () => {
    if (!isTauriRuntime()) {
      set({ pendingItems: [] });
      return;
    }
    const snap = await invokeCore<LibrarySnapshot>("lib_dismiss_all_pending");
    if (snap) {
      get().applyLibrarySnapshot(snap, snap.crates.length > 0);
    }
  },

  confirmAllPendingTracks: async () => {
    if (!isTauriRuntime()) {
      set({ pendingItems: [] });
      return;
    }
    const snap = await invokeCore<LibrarySnapshot>("lib_confirm_all_pending");
    if (snap) {
      get().applyLibrarySnapshot(snap, snap.crates.length > 0);
    }
  },

  refreshCustomRules: async () => {
    if (!isTauriRuntime()) return;
    const rules = await invokeCore<CustomRuleDto[]>("lib_list_rules");
    if (rules) set({ customRules: rules });
  },

  addCustomRule: async (uploaderMid, pattern, priority, description) => {
    if (!isTauriRuntime()) return;
    const rules = await invokeCore<CustomRuleDto[]>("lib_add_rule", {
      uploaderMid,
      pattern,
      priority,
      description,
    });
    if (rules) set({ customRules: rules });
    const snap = await invokeCore<LibrarySnapshot>("lib_get_snapshot");
    if (snap) get().applyLibrarySnapshot(snap, snap.crates.length > 0);
  },

  deleteCustomRule: async (id) => {
    if (!isTauriRuntime()) return;
    const rules = await invokeCore<CustomRuleDto[]>("lib_delete_rule", { id });
    if (rules) set({ customRules: rules });
    const snap = await invokeCore<LibrarySnapshot>("lib_get_snapshot");
    if (snap) get().applyLibrarySnapshot(snap, snap.crates.length > 0);
  },

  testTitleParser: async (
    rawTitle,
    ownerName,
    ownerMid = 0,
    tname = "音乐综合",
    partName = "",
    customPattern = ""
  ) => {
    if (!isTauriRuntime()) return null;
    return invokeCore<ParsedTrackPreview>("lib_test_parser", {
      rawTitle,
      ownerName,
      ownerMid,
      tname,
      partName,
      customPattern: customPattern.trim() ? customPattern.trim() : null,
    });
  },
}));

export function subscribeBrowserSync() {
  if (!browserChannel) return () => {};
  const onMsg = (ev: MessageEvent<SyncStatePayload>) => {
    usePlayerStore.getState().applyRemoteSync(ev.data);
  };
  browserChannel.addEventListener("message", onMsg);
  return () => browserChannel?.removeEventListener("message", onMsg);
}
