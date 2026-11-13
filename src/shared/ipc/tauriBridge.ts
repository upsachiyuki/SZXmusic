export type ThemeMode = "dark" | "light";
export type WidgetSize = "S" | "M" | "L";
export type WidgetAnchor = "top-right" | "bottom-right" | "top-left" | "bottom-left";

export interface PlaybackSnapshot {
  trackId: string;
  bvid: string;
  page: number;
  title: string;
  artist: string;
  qualityLabel: string;
  coverUrl: string;
  bpm: number;
  musicalKey: string;
  energy: number;
  nextTitle: string;
  nextArtist: string;
  nextReason: string;
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
  volume: number;
  mode: "radio" | "loop:all" | "loop:one";
  netSpeedText: string;
  bufferPct: number;
  cacheUsedGb: number;
  cacheLimitGb: number;
  spectrum: number[];
  levelL: number;
  levelR: number;
  liveStreamActive: boolean;
  streamStatus: string;
}

export interface StreamProbeResult {
  bvid: string;
  title: string;
  owner: string;
  codec: string;
  sample_rate: number;
  channels: number;
  frames_decoded: number;
  samples_decoded: number;
  peak_rms: number;
  duration_ms: number;
  quality_id: number;
}

export interface BiliUserInfo {
  is_login: boolean;
  mid: number;
  uname: string;
  face: string;
  vip_type: number;
  vip_label: string;
}

export interface QrLoginStart {
  qrcode_key: string;
  url: string;
  svg: string;
}

export interface QrPollStatus {
  status: "waiting" | "scanned" | "expired" | "confirmed" | "error";
  code: number;
  message: string;
}

export type QrPollResult = [QrPollStatus, BiliUserInfo | null];

export interface AudioQualityOption {
  id: number;
  label: string;
}

export interface BiliPlaySummary {
  bvid: string;
  cid: number;
  page?: number;
  pages?: VideoPageDto[];
  title: string;
  owner: string;
  cover_url?: string;
  codec: string;
  sample_rate: number;
  channels: number;
  duration_sec: number;
  quality_id: number;
  quality_label: string;
  available_qualities: AudioQualityOption[];
  from_cache: boolean;
  bpm?: number;
  musical_key?: string;
  energy?: number;
}

export interface VideoPageDto {
  cid: number;
  page: number;
  part: string;
  duration: number;
  first_frame?: string;
}

export interface LyricLineItem {
  timeSec: number;
  endSec: number;
  text: string;
  subText?: string | null;
  kind: string;
}

export interface TrackLyricsBundle {
  bvid: string;
  cid: number;
  title: string;
  ownerName: string;
  durationSec: number;
  sourceLabel: string;
  description: string;
  pages: VideoPageDto[];
  lines: LyricLineItem[];
  danmaku: LyricLineItem[];
}

export interface BackendLibraryTrack {
  id: string;
  bvid: string;
  cid: number;
  page: number;
  pages?: VideoPageDto[];
  rawTitle: string;
  title: string;
  artist: string;
  version: string;
  confidence: number;
  ruleId: string;
  reason: string;
  tags: string[];
  durationSec: number;
  qualityLabel: string;
  coverUrl: string;
  bpm: number;
  musicalKey: string;
  energy: number;
  reasonTag: string;
  isInvalid: boolean;
  isNew: boolean;
}

export interface BackendLibraryCrate {
  id: string;
  title: string;
  subtitle: string;
  kind: string;
  sortKey: string;
  covers: string[];
  tracks: BackendLibraryTrack[];
  remoteMediaId: number;
  newCount: number;
}

export interface BackendPendingParseItem {
  id: string;
  rawTitle: string;
  owner: string;
  ownerMid: number;
  bvid: string;
  coverUrl: string;
  guessTitle: string;
  guessArtist: string;
  version: string;
  confidence: number;
  ruleId: string;
  reason: string;
}

export interface LibrarySnapshot {
  crates: BackendLibraryCrate[];
  pending: BackendPendingParseItem[];
  likedIds: string[];
  lastSyncAt: number;
}

export interface SyncProgressEvent {
  stage: string;
  current: number;
  total: number;
  folderTitle: string;
  addedCount: number;
}

export interface SyncResult {
  cratesCount: number;
  tracksCount: number;
  newTracksCount: number;
  folderSummaries: string[];
  snapshot: LibrarySnapshot;
}

export interface SearchVideoItem {
  bvid: string;
  aid: number;
  title: string;
  author: string;
  mid: number;
  pic: string;
  duration_sec: number;
  play: number;
  tag: string;
}

export interface ParsedTrackPreview {
  title: string;
  artists: string[];
  artist_display: string;
  version: string;
  tags: string[];
  confidence: number;
  rule_id: string;
  reason: string;
  normalized_input: string;
  stripped_input: string;
}

export interface SearchParsedItem {
  video: SearchVideoItem;
  parsed: ParsedTrackPreview;
}

export interface OnlinePlayResponse {
  track: BackendLibraryTrack;
  snapshot: LibrarySnapshot;
  summary: BiliPlaySummary;
}

export interface CustomRuleDto {
  id: string;
  uploaderMid: number;
  pattern: string;
  priority: number;
  description: string;
}

export interface WinRegistryStatus {
  autostart: boolean;
  appRegistered: boolean;
  protocolRegistered: boolean;
  appPathsRegistered: boolean;
  exePath: string;
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function invokeCore<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function emitAppEvent<T>(event: string, payload: T): Promise<void> {
  if (!isTauriRuntime()) return;
  const { emit } = await import("@tauri-apps/api/event");
  await emit(event, payload);
}

export async function listenAppEvent<T>(
  event: string,
  handler: (payload: T) => void
): Promise<() => void> {
  if (!isTauriRuntime()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<T>(event, (ev) => handler(ev.payload));
  return unlisten;
}
