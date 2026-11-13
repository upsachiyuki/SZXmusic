import { useEffect, useState, type CSSProperties } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  LogOut,
  Play,
  Plus,
  QrCode,
  Radio,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  User,
  X,
} from "lucide-react";
import type {
  BiliUserInfo,
  CustomRuleDto,
  ParsedTrackPreview,
  QrLoginStart,
  SearchParsedItem,
  SyncProgressEvent,
} from "@shared/ipc/tauriBridge";
import type { PendingParseItem } from "@shared/mock/catalog";
import type { LibrarySource } from "@shared/state/playerStore";
import { toBiliThumb } from "./VinylDisc";
import { formatTime } from "./TurntablePanel";

const CARD_STYLE: CSSProperties = {
  padding: 10,
  borderRadius: 10,
  background: "var(--panel)",
  border: "1px solid var(--line)",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const INPUT_STYLE: CSSProperties = {
  padding: "6px 9px",
  borderRadius: 7,
  border: "1px solid var(--line)",
  background: "var(--bg-soft, var(--panel))",
  color: "var(--ink)",
  fontSize: 12,
  minWidth: 0,
};

export interface PendingDraft {
  title: string;
  artist: string;
  version: string;
}

export interface AccountSyncDrawerProps {
  user: BiliUserInfo | null;
  qrData: QrLoginStart | null;
  qrStatusText: string;
  qrLoading: boolean;
  syncing: boolean;
  syncProgress: SyncProgressEvent | null;
  syncStatusText: string;
  lastSyncAt: number;
  librarySource: LibrarySource;
  biliLoadedCount: number;
  syncIntervalMin: number;
  inTauri: boolean;
  isRevealLayer: boolean;
  onRefreshQr: () => void;
  onLogout: () => void;
  onSync: (forceFull: boolean) => void;
  onSwitchSource: (src: LibrarySource) => void;
  onChangeSyncInterval: (min: number) => void;
}

export function AccountSyncDrawer({
  user,
  qrData,
  qrStatusText,
  qrLoading,
  syncing,
  syncProgress,
  syncStatusText,
  lastSyncAt,
  librarySource,
  biliLoadedCount,
  syncIntervalMin,
  inTauri,
  isRevealLayer,
  onRefreshQr,
  onLogout,
  onSync,
  onSwitchSource,
  onChangeSyncInterval,
}: AccountSyncDrawerProps) {
  const qrDataUrl = qrData
    ? `data:image/svg+xml;utf8,${encodeURIComponent(qrData.svg)}`
    : null;
  const pct =
    syncProgress && syncProgress.total > 0
      ? Math.min(100, Math.round((syncProgress.current / syncProgress.total) * 100))
      : 0;
  const tab = isRevealLayer ? -1 : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 12 }}>
      {/* Account card */}
      <div style={CARD_STYLE}>
        {user?.is_login ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              {user.face ? (
                <img
                  src={user.face}
                  alt={user.uname}
                  referrerPolicy="no-referrer"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    objectFit: "cover",
                    border: "1px solid var(--accent)",
                  }}
                />
              ) : (
                <User size={24} />
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{user.uname}</div>
                <div className="szx-mono" style={{ fontSize: 10, color: "var(--accent)" }}>
                  UID {user.mid} · {user.vip_label || "正式会员"}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="szx-icon-btn szx-mono"
              tabIndex={tab}
              onClick={onLogout}
              style={{ fontSize: 11 }}
              title="清除本地 DPAPI 登录凭据"
            >
              <LogOut size={12} />
              退出
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <div
              className="szx-mono"
              style={{
                width: "100%",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 11,
                color: "var(--accent)",
              }}
            >
              <span>哔哩哔哩手机 App 扫码登录</span>
              <button
                type="button"
                className="szx-icon-btn"
                tabIndex={tab}
                onClick={onRefreshQr}
                style={{ height: 24, fontSize: 10 }}
              >
                <QrCode size={11} />
                {qrData ? "刷新二维码" : "获取二维码"}
              </button>
            </div>

            {qrDataUrl ? (
              <div
                style={{
                  padding: 10,
                  borderRadius: 10,
                  background: "#faf9f5",
                  border: "1px solid var(--line)",
                }}
              >
                <img
                  src={qrDataUrl}
                  alt="Bilibili QR Login"
                  style={{ width: 164, height: 164, display: "block" }}
                />
              </div>
            ) : (
              <div
                className="szx-mono"
                style={{ padding: "22px 10px", fontSize: 11, color: "var(--ink-dim)", textAlign: "center" }}
              >
                {inTauri
                  ? qrLoading
                    ? "正在申请 B 站登录二维码…"
                    : "点击上方获取二维码，使用本地 DPAPI 加密保存"
                  : "当前为浏览器 UI 预览；请在 Tauri 桌面端扫码登录 B 站"}
              </div>
            )}

            {qrStatusText && (
              <div className="szx-mono" style={{ fontSize: 11, color: "var(--ink-dim)", textAlign: "center" }}>
                {qrStatusText}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sync Controls */}
      <div style={CARD_STYLE}>
        <div className="szx-mono" style={{ fontSize: 11, color: "var(--accent)" }}>
          收藏夹与合集增量同步（仅单向拉取，不上报播放历史）
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="szx-icon-btn"
            tabIndex={tab}
            disabled={!inTauri || syncing || !user?.is_login}
            onClick={() => onSync(false)}
            style={{ flex: 1, borderColor: "var(--accent)" }}
          >
            <RefreshCw size={12} />
            {syncing ? "同步中…" : "增量同步收藏夹"}
          </button>
          <button
            type="button"
            className="szx-icon-btn szx-mono"
            tabIndex={tab}
            disabled={!inTauri || syncing || !user?.is_login}
            onClick={() => onSync(true)}
            style={{ fontSize: 11 }}
            title="忽略计数缓存强制重扫全部收藏夹"
          >
            全量重扫
          </button>
        </div>

        {syncProgress && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div className="szx-mono" style={{ fontSize: 10, color: "var(--ink-dim)" }}>
              [{syncProgress.current}/{syncProgress.total}] {syncProgress.folderTitle} (+{syncProgress.addedCount})
            </div>
            <div style={{ height: 4, borderRadius: 99, background: "var(--line)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)" }} />
            </div>
          </div>
        )}

        <div className="szx-mono" style={{ fontSize: 10.5, color: "var(--ink-dim)" }}>
          {syncStatusText ||
            (lastSyncAt > 0
              ? `上次同步：${new Date(lastSyncAt * 1000).toLocaleString()}`
              : "尚未执行过收藏夹同步")}
        </div>

        {/* Source Switcher */}
        <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
          <button
            type="button"
            className="szx-icon-btn szx-mono"
            tabIndex={tab}
            disabled={biliLoadedCount === 0}
            onClick={() => onSwitchSource("bili")}
            style={{
              flex: 1,
              fontSize: 10.5,
              borderColor: librarySource === "bili" ? "var(--accent)" : "var(--glass-border)",
              background: librarySource === "bili" ? "var(--accent-soft)" : undefined,
            }}
          >
            B站个人库 ({biliLoadedCount})
          </button>
          <button
            type="button"
            className="szx-icon-btn szx-mono"
            tabIndex={tab}
            onClick={() => onSwitchSource("demo")}
            style={{
              flex: 1,
              fontSize: 10.5,
              borderColor: librarySource === "demo" ? "var(--accent)" : "var(--glass-border)",
              background: librarySource === "demo" ? "var(--accent-soft)" : undefined,
            }}
          >
            演示黑胶箱
          </button>
        </div>

        {/* Auto-sync interval */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 2 }}>
          <span className="szx-mono" style={{ fontSize: 10.5, color: "var(--ink-dim)" }}>
            后台自动增量轮询间隔
          </span>
          <div style={{ display: "flex", gap: 5 }}>
            {[
              { label: "关闭", min: 0 },
              { label: "5m", min: 5 },
              { label: "15m", min: 15 },
              { label: "30m", min: 30 },
              { label: "60m", min: 60 },
            ].map((opt) => (
              <button
                key={opt.min}
                type="button"
                className="szx-icon-btn szx-mono"
                tabIndex={tab}
                onClick={() => onChangeSyncInterval(opt.min)}
                style={{
                  flex: 1,
                  height: 25,
                  fontSize: 10.5,
                  padding: "0 4px",
                  borderColor: syncIntervalMin === opt.min ? "var(--accent)" : "var(--glass-border)",
                  background: syncIntervalMin === opt.min ? "var(--accent-soft)" : undefined,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export interface SearchResultsDrawerProps {
  searchInput: string;
  results: SearchParsedItem[];
  searching: boolean;
  inTauri: boolean;
  isRevealLayer: boolean;
  onChangeInput: (val: string) => void;
  onSearch: (kw: string) => void;
  onPlayOnline: (input: string) => void;
  onFetchRelated: (bvid: string, title: string) => void;
}

export function SearchResultsDrawer({
  searchInput,
  results,
  searching,
  inTauri,
  isRevealLayer,
  onChangeInput,
  onSearch,
  onPlayOnline,
  onFetchRelated,
}: SearchResultsDrawerProps) {
  const tab = isRevealLayer ? -1 : undefined;
  const hasBv = /BV[0-9A-Za-z]{10}/.test(searchInput);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12 }}>
      <div style={CARD_STYLE}>
        <div className="szx-mono" style={{ fontSize: 10.5, color: "var(--accent)" }}>
          B站全站搜歌 · 实时标题清洗 · BV直链点播
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="text"
            value={searchInput}
            readOnly={isRevealLayer}
            tabIndex={tab}
            onChange={(e) => onChangeInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSearch(searchInput);
            }}
            placeholder="歌名 / 艺人 / BV号 / 视频链接"
            className="szx-mono"
            style={{ ...INPUT_STYLE, flex: 1 }}
          />
          <button
            type="button"
            className="szx-icon-btn"
            tabIndex={tab}
            disabled={!inTauri || searching}
            onClick={() => onSearch(searchInput)}
          >
            <Search size={12} />
            搜B站
          </button>
        </div>

        {hasBv && (
          <button
            type="button"
            className="szx-icon-btn szx-mono"
            tabIndex={tab}
            disabled={!inTauri}
            onClick={() => onPlayOnline(searchInput)}
            style={{ borderColor: "var(--accent)", fontSize: 11 }}
          >
            <Radio size={12} />
            立即在线解析并播放该 BV 视频
          </button>
        )}
      </div>

      {!inTauri && (
        <div className="szx-mono" style={{ fontSize: 11, color: "var(--ink-dim)", padding: "4px 6px" }}>
          请在 Tauri 桌面客户端中运行以发起真实 B 站 WBI 搜索与音频拉流。
        </div>
      )}

      {searching && (
        <div className="szx-mono" style={{ fontSize: 11, color: "var(--accent)", padding: 12 }}>
          &gt; querying api.bilibili.com/wbi/search …
        </div>
      )}

      {results.map((item) => (
        <div key={item.video.bvid} style={{ ...CARD_STYLE, gap: 6 }}>
          <div style={{ display: "flex", gap: 9 }}>
            {item.video.pic && (
              <img
                src={toBiliThumb(item.video.pic, 144, 96)}
                alt={item.parsed.title}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                style={{
                  width: 68,
                  height: 44,
                  borderRadius: 6,
                  objectFit: "cover",
                  flexShrink: 0,
                  border: "1px solid var(--line)",
                }}
              />
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.parsed.title}
              </div>
              <div
                className="szx-mono"
                style={{
                  fontSize: 10.5,
                  color: "var(--ink-dim)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.parsed.artist_display}
                {item.parsed.version ? ` · [${item.parsed.version}]` : ""} · {formatTime(item.video.duration_sec)}
              </div>
              <div
                className="szx-mono"
                style={{
                  fontSize: 9.5,
                  color: "var(--ink-dim)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  marginTop: 2,
                }}
                title={item.video.title}
              >
                原题: {item.video.title}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
            <span className="szx-mono" style={{ fontSize: 9.5, color: "var(--accent)" }}>
              {item.video.bvid} · {item.parsed.rule_id} ({Math.round(item.parsed.confidence * 100)}%)
            </span>
            <div style={{ display: "flex", gap: 5 }}>
              <button
                type="button"
                className="szx-icon-btn szx-mono"
                tabIndex={tab}
                onClick={() => onFetchRelated(item.video.bvid, item.parsed.title)}
                style={{ height: 24, fontSize: 10, padding: "0 7px" }}
              >
                <Sparkles size={10} />
                相似箱
              </button>
              <button
                type="button"
                className="szx-icon-btn szx-mono"
                tabIndex={tab}
                onClick={() => onPlayOnline(item.video.bvid)}
                style={{ height: 24, fontSize: 10, padding: "0 8px", borderColor: "var(--accent)" }}
              >
                <Play size={10} />
                播放
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export interface PendingParserDrawerProps {
  items: PendingParseItem[];
  drafts: Record<string, PendingDraft>;
  customRules: CustomRuleDto[];
  inTauri: boolean;
  isRevealLayer: boolean;
  onDraftChange: (id: string, patch: Partial<PendingDraft>) => void;
  onConfirm: (item: PendingParseItem, draft: PendingDraft) => void;
  onDismiss?: (id: string) => void;
  onDismissAll?: () => void;
  onConfirmAll?: () => void;
  onTestParser: (
    rawTitle: string,
    ownerName: string,
    ownerMid: number,
    customPattern?: string
  ) => Promise<ParsedTrackPreview | null>;
  onAddRule: (mid: number, pattern: string, priority: number, desc: string) => Promise<void>;
  onDeleteRule: (id: string) => void;
}

const REGEX_PRESETS = [
  {
    label: "书名号《歌名》",
    pattern: "(?P<artist>[^《]*)《(?P<title>[^》]+)》",
    desc: "书名号歌名提取",
  },
  {
    label: "【歌手】歌名",
    pattern: "^【(?P<artist>[^】]{1,24})】\\s*(?P<title>.+)$",
    desc: "前缀方括号歌手提取",
  },
  {
    label: "歌手 - 歌名",
    pattern: "^(?P<artist>[^\\d|-][^|-]{0,24}?)\\s*[-–—]\\s*(?P<title>.+)$",
    desc: "连字符歌手歌名分离",
  },
  {
    label: "系列丨歌名",
    pattern: "^.{2,18}?[丨|｜]\\s*(?P<title>.+?)\\s*$",
    desc: "竖线前缀系列剥离",
  },
];

export function PendingParserDrawer({
  items,
  drafts,
  customRules,
  inTauri,
  isRevealLayer,
  onDraftChange,
  onConfirm,
  onDismiss,
  onDismissAll,
  onConfirmAll,
  onTestParser,
  onAddRule,
  onDeleteRule,
}: PendingParserDrawerProps) {
  const [testRaw, setTestRaw] = useState("【4K修复】周杰伦《晴天》2003 现场版");
  const [testOwner, setTestOwner] = useState("音乐搬运工");
  const [testMid, setTestMid] = useState("0");
  const [testPattern, setTestPattern] = useState(
    "(?P<artist>[^《]+)《(?P<title>[^》]+)》"
  );
  const [testDesc, setTestDesc] = useState("自定义书名号规则");
  const [preview, setPreview] = useState<ParsedTrackPreview | null>(null);
  const [ruleError, setRuleError] = useState("");
  const [ruleSavedMsg, setRuleSavedMsg] = useState("");
  const [debuggerExpanded, setDebuggerExpanded] = useState(true);
  const tab = isRevealLayer ? -1 : undefined;

  useEffect(() => {
    if (!ruleSavedMsg) return;
    const timer = window.setTimeout(() => {
      setRuleSavedMsg("");
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [ruleSavedMsg]);

  const clearDebugFeedback = () => {
    if (preview) setPreview(null);
    if (ruleError) setRuleError("");
    if (ruleSavedMsg) setRuleSavedMsg("");
  };

  const runTest = async (overrideRaw?: string, overrideOwner?: string, overrideMid?: number, overridePat?: string) => {
    setRuleError("");
    setRuleSavedMsg("");
    try {
      const res = await onTestParser(
        overrideRaw ?? testRaw,
        overrideOwner ?? testOwner,
        overrideMid ?? (Number(testMid) || 0),
        overridePat ?? testPattern
      );
      setPreview(res);
    } catch (e) {
      setPreview(null);
      setRuleError(String(e));
    }
  };

  const handleSaveRule = async () => {
    setRuleError("");
    setRuleSavedMsg("");
    try {
      await onAddRule(Number(testMid) || 0, testPattern, 110, testDesc);
      // Clear temporary debug preview once debugging is finished & saved
      setPreview(null);
      setRuleSavedMsg("✓ 规则已保存并自动重刷匹配曲目");
    } catch (e) {
      setRuleError(String(e));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12 }}>
      {items.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "8px 10px",
            borderRadius: 10,
            background: "var(--panel)",
            border: "1px solid var(--line)",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            待确认 {items.length} 首
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            {onConfirmAll && (
              <button
                type="button"
                className="szx-icon-btn"
                tabIndex={tab}
                onClick={onConfirmAll}
                style={{ height: 26, fontSize: 11, padding: "0 9px" }}
              >
                <Check size={12} />
                全部确认
              </button>
            )}
            {onDismissAll && (
              <button
                type="button"
                className="szx-icon-btn"
                tabIndex={tab}
                onClick={onDismissAll}
                style={{
                  height: 26,
                  fontSize: 11,
                  padding: "0 9px",
                  borderColor: "var(--accent)",
                  color: "var(--accent)",
                }}
              >
                <Trash2 size={12} />
                一键删除未确认
              </button>
            )}
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--ink-dim)", padding: "8px 4px" }}>
          待确认队列已清空。
        </div>
      ) : (
        items.map((item) => {
          const draft = drafts[item.id] ?? {
            title: item.suggestedTitle,
            artist: item.suggestedArtist,
            version: item.version ?? "",
          };
          return (
            <div key={item.id} style={CARD_STYLE}>
              <div style={{ fontSize: 11.5, lineHeight: 1.4, fontWeight: 500 }}>
                {item.rawTitle}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <input
                  type="text"
                  value={draft.title}
                  readOnly={isRevealLayer}
                  tabIndex={tab}
                  onChange={(e) => onDraftChange(item.id, { title: e.target.value })}
                  placeholder="歌名"
                  style={INPUT_STYLE}
                />
                <input
                  type="text"
                  value={draft.artist}
                  readOnly={isRevealLayer}
                  tabIndex={tab}
                  onChange={(e) => onDraftChange(item.id, { artist: e.target.value })}
                  placeholder="艺人"
                  style={INPUT_STYLE}
                />
              </div>

              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="text"
                  value={draft.version}
                  readOnly={isRevealLayer}
                  tabIndex={tab}
                  onChange={(e) => onDraftChange(item.id, { version: e.target.value })}
                  placeholder="版本（可选）"
                  style={{ ...INPUT_STYLE, flex: 1, fontSize: 11 }}
                />
                <button
                  type="button"
                  className="szx-icon-btn"
                  tabIndex={tab}
                  onClick={() => onConfirm(item, draft)}
                  style={{ height: 28, fontSize: 11, borderColor: "var(--accent)" }}
                >
                  <Check size={12} />
                  确认入库
                </button>
                {onDismiss && (
                  <button
                    type="button"
                    className="szx-icon-btn"
                    tabIndex={tab}
                    onClick={() => onDismiss(item.id)}
                    title="删除此条未确认项"
                    style={{ height: 28, fontSize: 11, padding: "0 8px", color: "var(--ink-muted)" }}
                  >
                    <Trash2 size={12} />
                    删除
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}

      {/* Regex Debugger & Custom Uploader Rule Editor */}
      <div style={{ ...CARD_STYLE, marginTop: 4 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div className="szx-mono" style={{ fontSize: 11, color: "var(--accent)" }}>
            正则清洗调试器 & UP主专属规则
          </div>
          <button
            type="button"
            className="szx-icon-btn szx-mono"
            tabIndex={tab}
            onClick={() => {
              const next = !debuggerExpanded;
              setDebuggerExpanded(next);
              if (!next) clearDebugFeedback();
            }}
            style={{ height: 22, fontSize: 10, padding: "0 6px" }}
          >
            {debuggerExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            {debuggerExpanded ? "收起" : "展开"}
          </button>
        </div>

        {debuggerExpanded && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {REGEX_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="szx-icon-btn szx-mono"
                  tabIndex={tab}
                  onClick={() => {
                    setTestPattern(preset.pattern);
                    setTestDesc(preset.desc);
                    void runTest(undefined, undefined, undefined, preset.pattern);
                  }}
                  style={{ height: 22, fontSize: 10, padding: "0 6px" }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={testRaw}
              readOnly={isRevealLayer}
              tabIndex={tab}
              onChange={(e) => {
                setTestRaw(e.target.value);
                clearDebugFeedback();
              }}
              placeholder="测试视频原标题"
              style={INPUT_STYLE}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 6 }}>
              <input
                type="text"
                value={testOwner}
                readOnly={isRevealLayer}
                tabIndex={tab}
                onChange={(e) => {
                  setTestOwner(e.target.value);
                  clearDebugFeedback();
                }}
                placeholder="UP主昵称"
                style={INPUT_STYLE}
              />
              <input
                type="text"
                value={testMid}
                readOnly={isRevealLayer}
                tabIndex={tab}
                onChange={(e) => {
                  setTestMid(e.target.value);
                  clearDebugFeedback();
                }}
                placeholder="MID(0全局)"
                className="szx-mono"
                style={INPUT_STYLE}
              />
            </div>
            <input
              type="text"
              value={testPattern}
              readOnly={isRevealLayer}
              tabIndex={tab}
              onChange={(e) => {
                setTestPattern(e.target.value);
                clearDebugFeedback();
              }}
              placeholder="正则需含 (?P<title>...) 与可选 (?P<artist>...)"
              className="szx-mono"
              style={{ ...INPUT_STYLE, fontSize: 11 }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                value={testDesc}
                readOnly={isRevealLayer}
                tabIndex={tab}
                onChange={(e) => {
                  setTestDesc(e.target.value);
                  if (ruleSavedMsg) setRuleSavedMsg("");
                }}
                placeholder="规则说明"
                style={{ ...INPUT_STYLE, flex: 1, fontSize: 11 }}
              />
              <button
                type="button"
                className="szx-icon-btn szx-mono"
                tabIndex={tab}
                disabled={!inTauri}
                onClick={() => void runTest()}
                style={{ height: 28, fontSize: 11 }}
              >
                测试
              </button>
              <button
                type="button"
                className="szx-icon-btn szx-mono"
                tabIndex={tab}
                disabled={!inTauri}
                onClick={() => void handleSaveRule()}
                style={{ height: 28, fontSize: 11, borderColor: "var(--accent)" }}
              >
                <Plus size={11} />
                保存规则
              </button>
            </div>
          </>
        )}

        {ruleError && (
          <div
            className="szx-mono"
            style={{
              fontSize: 10.5,
              color: "var(--warn)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
            }}
          >
            <span>{ruleError}</span>
            <button
              type="button"
              tabIndex={tab}
              onClick={() => setRuleError("")}
              style={{ border: "none", background: "transparent", color: "var(--ink-dim)", cursor: "pointer", padding: 2 }}
              title="关闭提示"
            >
              <X size={11} />
            </button>
          </div>
        )}
        {ruleSavedMsg && !ruleError && (
          <div
            className="szx-mono"
            style={{
              fontSize: 10.5,
              color: "var(--accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
            }}
          >
            <span>{ruleSavedMsg}</span>
            <button
              type="button"
              tabIndex={tab}
              onClick={() => setRuleSavedMsg("")}
              style={{ border: "none", background: "transparent", color: "var(--ink-dim)", cursor: "pointer", padding: 2 }}
              title="关闭提示"
            >
              <X size={11} />
            </button>
          </div>
        )}

        {preview && debuggerExpanded && (
          <div
            className="szx-mono"
            style={{
              fontSize: 10.5,
              padding: 8,
              borderRadius: 6,
              background: "var(--panel-glass)",
              border: "1px dashed var(--accent)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--accent)", marginBottom: 3 }}>
              <span>
                <Sparkles size={10} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                调试预览 (测试结果)
              </span>
              <button
                type="button"
                tabIndex={tab}
                onClick={() => setPreview(null)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--ink-dim)",
                  cursor: "pointer",
                  fontSize: 10,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 2,
                  padding: 0,
                }}
                title="关闭调试结果"
              >
                <X size={11} />
                清除
              </button>
            </div>
            <div>
              歌名: <strong>{preview.title}</strong> | 艺人: <strong>{preview.artist_display}</strong>
              {preview.version ? ` | [${preview.version}]` : ""}
            </div>
            <div style={{ color: "var(--ink-dim)", marginTop: 2 }}>
              rule={preview.rule_id} · conf={Math.round(preview.confidence * 100)}% · {preview.reason}
            </div>
          </div>
        )}

        {customRules.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div className="szx-mono" style={{ fontSize: 10, color: "var(--ink-dim)" }}>
              已启用的自定义规则 ({customRules.length})
            </div>
            {customRules.map((r) => (
              <div
                key={r.id}
                className="szx-mono"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 6,
                  fontSize: 10,
                  padding: "4px 6px",
                  borderRadius: 6,
                  border: "1px solid var(--line)",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  [{r.uploaderMid === 0 ? "全局" : `MID:${r.uploaderMid}`}] {r.description || r.pattern}
                </span>
                <button
                  type="button"
                  tabIndex={tab}
                  onClick={() => onDeleteRule(r.id)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "var(--warn)",
                    cursor: "pointer",
                    padding: 2,
                  }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
