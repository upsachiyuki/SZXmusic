import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Bell,
  Droplets,
  Moon,
  Pause,
  Play,
  Search,
  Sparkles,
  Sun,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  LiquidThemeStage,
  type LiquidThemeMode,
} from "@shared/liquid-theme";

const DEMO_THEME_KEY = "orlune-liquid-demo-theme";

const DOT_FONT_5X7: Record<string, string[]> = {
  "0": [".111.", "1...1", "1..11", "1.1.1", "11..1", "1...1", ".111."],
  "1": ["..1..", ".11..", "..1..", "..1..", "..1..", "..1..", ".111."],
  "2": [".111.", "1...1", "....1", "..11.", ".1...", "1....", "11111"],
  "3": [".111.", "1...1", "....1", "..11.", "....1", "1...1", ".111."],
  "4": ["...1.", "..11.", ".1.1.", "1..1.", "11111", "...1.", "...1."],
  "5": ["11111", "1....", "1111.", "....1", "....1", "1...1", ".111."],
  "6": [".111.", "1....", "1111.", "1...1", "1...1", "1...1", ".111."],
  "7": ["11111", "....1", "...1.", "..1..", ".1...", ".1...", ".1..."],
  "8": [".111.", "1...1", "1...1", ".111.", "1...1", "1...1", ".111."],
  "9": [".111.", "1...1", "1...1", ".1111", "....1", "...1.", ".11.."],
  "$": ["..1..", ".1111", "1.1..", ".111.", "..1.1", "1111.", "..1.."],
  ".": [".....", ".....", ".....", ".....", ".....", ".11..", ".11.."],
  ",": [".....", ".....", ".....", ".....", "..1..", "..1..", ".1..."],
  ":": [".....", ".11..", ".11..", ".....", ".11..", ".11..", "....."],
  "M": ["1...1", "11.11", "1.1.1", "1...1", "1...1", "1...1", "1...1"],
  "K": ["1...1", "1..1.", "1.1..", "11...", "1.1..", "1..1.", "1...1"],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
};

function DotMatrixText({
  text,
  dotSize = 3.2,
  gap = 1.6,
}: {
  text: string;
  dotSize?: number;
  gap?: number;
}) {
  const step = dotSize + gap;
  const charW = 5 * step;
  const charGap = step * 1.1;
  const height = 7 * step;
  const totalWidth = Math.max(10, text.length * (charW + charGap) - charGap);

  return (
    <svg
      width={totalWidth}
      height={height}
      viewBox={`0 0 ${totalWidth} ${height}`}
      style={{ display: "block", maxWidth: "100%", height: "auto" }}
      aria-label={text}
    >
      {text.split("").map((ch, charIdx) => {
        const rows = DOT_FONT_5X7[ch] ?? DOT_FONT_5X7[" "];
        const xOffset = charIdx * (charW + charGap);
        return rows.map((rowStr, rIdx) =>
          rowStr.split("").map((cell, cIdx) =>
            cell === "1" ? (
              <circle
                key={`${charIdx}-${rIdx}-${cIdx}`}
                cx={xOffset + cIdx * step + dotSize / 2}
                cy={rIdx * step + dotSize / 2}
                r={dotSize / 2}
                fill="currentColor"
              />
            ) : null
          )
        );
      })}
    </svg>
  );
}

interface DemoTrack {
  rank: string;
  title: string;
  artist: string;
  bpm: string;
  plays: number;
  displayPlays: string;
  city: string;
  color: string;
  duration: string;
}

const DEMO_TRACKS: DemoTrack[] = [
  {
    rank: "01",
    title: "Glasshouse",
    artist: "Mira Vale",
    bpm: "124 BPM · A minor",
    plays: 812440,
    displayPlays: "812,440",
    city: "Lisbon",
    color: "var(--d-ink-strong)",
    duration: "3:48",
  },
  {
    rank: "02",
    title: "Lowlight",
    artist: "Mira Vale, Joon Park",
    bpm: "118 BPM · F# minor",
    plays: 604118,
    displayPlays: "604,118",
    city: "Berlin",
    color: "var(--d-orange)",
    duration: "4:12",
  },
  {
    rank: "03",
    title: "Night Swim",
    artist: "Mira Vale",
    bpm: "102 BPM · D major",
    plays: 388902,
    displayPlays: "388,902",
    city: "Seoul",
    color: "var(--d-blue)",
    duration: "3:29",
  },
  {
    rank: "04",
    title: "Paper Moons",
    artist: "Mira Vale, Ines Ruiz",
    bpm: "96 BPM · C minor",
    plays: 241665,
    displayPlays: "241,665",
    city: "Mexico City",
    color: "var(--d-teal)",
    duration: "4:04",
  },
];

const STREAM_COLS_BY_RANGE: Record<"7d" | "30d" | "90d", number[]> = {
  "7d": [2, 3, 5, 4, 6, 8, 7, 5, 4, 6, 7, 8, 6, 4, 5, 7, 9, 8],
  "30d": [3, 4, 5, 5, 6, 4, 3, 3, 4, 5, 6, 7, 8, 7, 6, 4, 4, 3],
  "90d": [4, 5, 6, 7, 6, 5, 4, 5, 6, 7, 7, 8, 9, 8, 7, 6, 5, 6],
};

const WAVE_HEIGHTS = [
  2, 3, 5, 4, 7, 9, 6, 4, 8, 10, 8, 5, 7, 9, 6, 3, 5, 7, 4, 6, 8, 5, 3, 4, 6, 4, 2, 3,
];

const NAV_TABS = ["Overview", "Catalog", "Releases", "Royalties", "Audience"] as const;

export function LiquidDemoApp() {
  const [theme, setTheme] = useState<LiquidThemeMode>(() => {
    try {
      const saved = localStorage.getItem(DEMO_THEME_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch {
      // ignore storage errors
    }
    return "light";
  });

  // Persist theme & sync html[data-theme] so FOUC script and scrollbars stay consistent
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(DEMO_THEME_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  // Preserved interactive UI & form states (remain intact across liquid transitions!)
  const [activeNav, setActiveNav] = useState<(typeof NAV_TABS)[number]>("Overview");
  const [searchOpen, setSearchOpen] = useState(false);
  const [trackFilter, setTrackFilter] = useState("");
  const [selectedRank, setSelectedRank] = useState("01");
  const [streamRange, setStreamRange] = useState<"7d" | "30d" | "90d">("30d");
  const [selectedHour, setSelectedHour] = useState(21);
  const [isPlaying, setIsPlaying] = useState(true);
  const [durationMs, setDurationMs] = useState(1150);

  // Release checklist & workbench form fields (kept live during liquid reveal)
  const [checklist, setChecklist] = useState({
    master: true,
    artwork: true,
    delivery: false,
    pitch: false,
  });
  const [releaseTitle, setReleaseTitle] = useState("Lowlight (Deluxe EP)");
  const [territory, setTerritory] = useState("GLOBAL");
  const [channelFilter, setChannelFilter] = useState<"all" | "streaming" | "sync" | "live">("all");
  const [campaignNotes, setCampaignNotes] = useState(
    "Lisbon & Berlin midnight premiere · lossless WAV master verified."
  );

  const filteredTracks = useMemo(() => {
    const q = trackFilter.trim().toLowerCase();
    return DEMO_TRACKS.filter((t) => {
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.city.toLowerCase().includes(q)
      );
    });
  }, [trackFilter]);

  const activeTrack = useMemo(
    () => DEMO_TRACKS.find((t) => t.rank === selectedRank) ?? DEMO_TRACKS[0],
    [selectedRank]
  );

  const streamKpi =
    streamRange === "7d" ? "642K" : streamRange === "90d" ? "6.91M" : "2.48M";
  const revenueKpi =
    channelFilter === "streaming"
      ? "$11,236"
      : channelFilter === "sync"
        ? "$4,420"
        : channelFilter === "live"
          ? "$2,764"
          : "$18,420";

  return (
    <div className="orlune-stage">
      <LiquidThemeStage
        theme={theme}
        onThemeChange={setTheme}
        durationMs={durationMs}
        layoutMode="document"
        soundPersistKey="orlune-liquid-demo-sound"
      >
        {(liquid) => {
          const isReveal = liquid.isRevealLayer;
          const inactiveTab = isReveal ? -1 : undefined;

          return (
            <div className="orlune-layer" data-theme={liquid.theme}>
              {/* Sticky Header */}
              <header className="orlune-header">
                <div className="orlune-header-inner">
                  <div className="orlune-brand">
                    <div className="orlune-brand-grid" aria-hidden="true">
                      {Array.from({ length: 9 }).map((_, idx) => (
                        <span key={idx} />
                      ))}
                    </div>
                    <span>orlune</span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        color: "var(--d-ink-muted)",
                        marginLeft: 4,
                      }}
                    >
                      Liquid Reveal
                    </span>
                  </div>

                  <nav className="orlune-nav-pills" aria-label="Workspace sections">
                    {NAV_TABS.map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        tabIndex={inactiveTab}
                        className={`orlune-nav-btn ${activeNav === tab ? "is-active" : ""}`}
                        onClick={() => !isReveal && setActiveNav(tab)}
                      >
                        {tab}
                      </button>
                    ))}
                  </nav>

                  <div className="orlune-actions">
                    <button
                      type="button"
                      tabIndex={inactiveTab}
                      className={`orlune-icon-btn ${searchOpen ? "is-accent" : ""}`}
                      title="筛选曲目"
                      onClick={() => !isReveal && setSearchOpen((v) => !v)}
                    >
                      <Search size={15} />
                    </button>

                    <button
                      type="button"
                      tabIndex={inactiveTab}
                      className="orlune-icon-btn"
                      title="发行通知"
                      onClick={() => !isReveal && setSelectedRank((r) => (r === "01" ? "02" : "01"))}
                    >
                      <Bell size={15} />
                      <span className="orlune-notif-dot" />
                    </button>

                    {/* Primary Liquid Theme Reveal Trigger Button */}
                    <button
                      type="button"
                      tabIndex={inactiveTab}
                      data-testid={isReveal ? undefined : "theme-toggle-btn"}
                      className="orlune-theme-switch"
                      aria-label={
                        liquid.theme === "light"
                          ? "Switch to dark theme with liquid reveal"
                          : "Switch to light theme with liquid reveal"
                      }
                      title="点击触发液体主题揭示（支持快速连点中断与浅/深双向流动）"
                      onClick={(e) => {
                        if (!isReveal) {
                          liquid.toggleTheme(e);
                        }
                      }}
                    >
                      <span
                        className={`orlune-theme-slot ${liquid.theme === "light" ? "is-knob" : ""}`}
                      >
                        <Sun size={14} />
                      </span>
                      <span
                        className={`orlune-theme-slot ${liquid.theme === "dark" ? "is-knob" : ""}`}
                      >
                        <Moon size={14} />
                      </span>
                    </button>

                    <div className="orlune-avatar">MV</div>
                  </div>
                </div>
              </header>

              <main className="orlune-container">
                {/* Inline Search Filter Drawer when opened */}
                {searchOpen && (
                  <div className="orlune-control-strip" style={{ marginTop: 14 }}>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flex: 1,
                        minWidth: 220,
                      }}
                    >
                      <Search size={14} style={{ color: "var(--d-ink-muted)" }} />
                      <input
                        type="text"
                        className="orlune-input"
                        placeholder="搜索曲目、艺人或城市（切换主题时保留输入内容）..."
                        value={trackFilter}
                        readOnly={isReveal}
                        tabIndex={inactiveTab}
                        onChange={(e) => !isReveal && setTrackFilter(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      tabIndex={inactiveTab}
                      className="orlune-chip"
                      onClick={() => !isReveal && setTrackFilter("")}
                    >
                      清空筛选 ({filteredTracks.length}/4)
                    </button>
                  </div>
                )}

                {/* Audio Synthesis & Liquid Controls Strip (Sound defaults to OFF) */}
                <section className="orlune-control-strip" aria-label="Liquid animation and Web Audio controls">
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12.5,
                        fontWeight: 600,
                      }}
                    >
                      <Droplets size={14} style={{ color: "var(--d-blue)" }} />
                      <span>Web Audio 液体同步音效</span>
                    </span>

                    <button
                      type="button"
                      tabIndex={inactiveTab}
                      data-testid={isReveal ? undefined : "sound-toggle-btn"}
                      className={`orlune-chip ${liquid.soundEnabled ? "is-active" : ""}`}
                      onClick={() => !isReveal && liquid.setSoundEnabled(!liquid.soundEnabled)}
                    >
                      {liquid.soundEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
                      <span>{liquid.soundEnabled ? "已开启 · 记住选择" : "默认关闭"}</span>
                    </button>

                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 12,
                        color: "var(--d-ink-muted)",
                      }}
                    >
                      <span>音量 {Math.round(liquid.soundVolume * 100)}%</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={liquid.soundVolume}
                        readOnly={isReveal}
                        tabIndex={inactiveTab}
                        onChange={(e) =>
                          !isReveal && liquid.setSoundVolume(Number(e.target.value))
                        }
                        style={{ accentColor: "#2F6BFF", width: 92 }}
                      />
                    </label>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      tabIndex={inactiveTab}
                      className="orlune-chip"
                      onClick={() => !isReveal && liquid.previewSound("to-dark")}
                    >
                      <Sparkles size={12} style={{ color: "var(--d-orange)" }} />
                      <span>试听 浅→深</span>
                    </button>
                    <button
                      type="button"
                      tabIndex={inactiveTab}
                      className="orlune-chip"
                      onClick={() => !isReveal && liquid.previewSound("to-light")}
                    >
                      <Sparkles size={12} style={{ color: "var(--d-teal)" }} />
                      <span>试听 深→浅</span>
                    </button>
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                        color: "var(--d-ink-muted)",
                      }}
                    >
                      <span>流速 {(durationMs / 1000).toFixed(2)}s</span>
                      <input
                        type="range"
                        min={650}
                        max={1800}
                        step={50}
                        value={durationMs}
                        readOnly={isReveal}
                        tabIndex={inactiveTab}
                        onChange={(e) => !isReveal && setDurationMs(Number(e.target.value))}
                        style={{ accentColor: "#14A3A8", width: 84 }}
                      />
                    </label>
                    <a
                      href="/"
                      tabIndex={inactiveTab}
                      style={{
                        fontSize: 12,
                        color: "var(--d-blue)",
                        textDecoration: "none",
                        fontWeight: 600,
                      }}
                    >
                      返回 SZXmusic →
                    </a>
                  </div>
                </section>

                {/* Top 4-Card Analytics Grid matching orlune reference */}
                <section className="orlune-grid-top">
                  {/* Card 1: Streams */}
                  <article className="orlune-card orlune-card-glow-orange">
                    <div>
                      <div className="orlune-card-head">
                        <span className="orlune-card-title">Streams</span>
                        <div style={{ display: "flex", gap: 4 }}>
                          {(["7d", "30d", "90d"] as const).map((r) => (
                            <button
                              key={r}
                              type="button"
                              tabIndex={inactiveTab}
                              className={`orlune-badge`}
                              style={{
                                cursor: "pointer",
                                background:
                                  streamRange === r ? "var(--d-pill-active-bg)" : undefined,
                                color: streamRange === r ? "var(--d-pill-active-ink)" : undefined,
                              }}
                              onClick={() => !isReveal && setStreamRange(r)}
                            >
                              {r}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div style={{ marginTop: 18, color: "var(--d-ink-strong)" }}>
                        <DotMatrixText text={streamKpi} dotSize={3.6} gap={1.5} />
                      </div>
                      <div style={{ marginTop: 10, fontSize: 12 }}>
                        <span style={{ color: "var(--d-teal)", fontWeight: 600 }}>+12.4%</span>{" "}
                        <span style={{ color: "var(--d-ink-muted)" }}>vs last period</span>
                      </div>
                    </div>

                    <div style={{ marginTop: 18 }}>
                      <svg
                        viewBox="0 0 216 96"
                        style={{ width: "100%", height: "auto", display: "block" }}
                        aria-label="Dot matrix stream trend chart"
                      >
                        {STREAM_COLS_BY_RANGE[streamRange].map((lvl, col) =>
                          Array.from({ length: 10 }).map((_, row) => {
                            const active = 9 - row < lvl;
                            return (
                              <circle
                                key={`${col}-${row}`}
                                cx={col * 12 + 5}
                                cy={row * 9 + 5}
                                r={2.6}
                                fill={
                                  active
                                    ? col >= 12
                                      ? "var(--d-orange)"
                                      : "var(--d-ink-strong)"
                                    : "var(--d-line)"
                                }
                              />
                            );
                          })
                        )}
                      </svg>
                      <div
                        style={{
                          marginTop: 10,
                          fontSize: 11.5,
                          color: "var(--d-ink-muted)",
                        }}
                      >
                        Today · 96,240 plays
                      </div>
                    </div>
                  </article>

                  {/* Card 2: Now mastering */}
                  <article className="orlune-card orlune-cover-card">
                    <div>
                      <div className="orlune-artwork-frame">
                        <svg
                          viewBox="0 0 300 180"
                          preserveAspectRatio="xMidYMid slice"
                          style={{ width: "100%", height: "100%", display: "block" }}
                        >
                          <defs>
                            <linearGradient id={isReveal ? undefined : "orluneShade"} x1="0" y1="0" x2="1" y2="1">
                              <stop offset="0%" stopColor="#F1F0ED" />
                              <stop offset="55%" stopColor="#141319" stopOpacity="0.35" />
                              <stop offset="100%" stopColor="#060609" stopOpacity="0.72" />
                            </linearGradient>
                          </defs>
                          <rect width="300" height="180" fill="#F1F0ED" />
                          <polygon points="0,120 300,62 300,180 0,180" fill="#141319" opacity="0.22" />
                          <line x1="0" y1="120" x2="300" y2="62" stroke="#141319" strokeOpacity="0.35" strokeWidth="1.2" />
                          {/* Minimalist figure casting a long crisp shadow matching reference art */}
                          <polygon points="184,54 198,60 64,178 44,172" fill="#060609" opacity="0.88" />
                          <circle cx="192" cy="40" r="7" fill="#060609" />
                          <rect x="184" y="47" width="15" height="22" rx="6" fill="#E07A2E" />
                          <rect x="187" y="67" width="8" height="14" rx="3" fill="#141319" />
                        </svg>
                        <span className="orlune-artwork-badge-left">Now mastering</span>
                        <span className="orlune-artwork-badge-right">
                          <span className="orlune-live-dot" />
                          Live
                        </span>
                      </div>

                      <div style={{ padding: "12px 10px 6px" }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--d-ink-strong)" }}>
                          {activeTrack.title}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--d-ink-muted)", marginTop: 2 }}>
                          {activeTrack.artist} · {activeTrack.bpm}
                        </div>
                      </div>
                    </div>

                    <div style={{ padding: "8px 10px 8px" }}>
                      <svg
                        viewBox="0 0 280 56"
                        style={{ width: "100%", height: "auto", display: "block" }}
                        aria-label="Dot matrix audio waveform"
                      >
                        {WAVE_HEIGHTS.map((amp, x) =>
                          Array.from({ length: 11 }).map((_, y) => {
                            const dist = Math.abs(y - 5);
                            const lit = dist <= Math.floor(amp / 2);
                            const played = x < 17;
                            return (
                              <circle
                                key={`${x}-${y}`}
                                cx={x * 10 + 4}
                                cy={y * 5 + 3}
                                r={1.8}
                                fill={
                                  !lit
                                    ? "transparent"
                                    : played
                                      ? "var(--d-ink-strong)"
                                      : "var(--d-line)"
                                }
                              />
                            );
                          })
                        )}
                      </svg>
                      <div
                        style={{
                          marginTop: 6,
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 11,
                          color: "var(--d-ink-muted)",
                        }}
                      >
                        <span>2:03</span>
                        <span>{activeTrack.duration}</span>
                      </div>
                    </div>
                  </article>

                  {/* Card 3: Listening clock */}
                  <article className="orlune-card">
                    <div className="orlune-card-head">
                      <span className="orlune-card-title">Listening clock</span>
                      <span className="orlune-badge">24h</span>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: "10px 0",
                      }}
                    >
                      <svg
                        viewBox="0 0 220 220"
                        style={{ width: "100%", maxWidth: 204, height: "auto" }}
                        aria-label="24 hour listening radial clock"
                      >
                        {Array.from({ length: 24 }).map((_, hr) => {
                          const angle = (hr / 24) * Math.PI * 2 - Math.PI / 2;
                          const isPeak = hr >= 20 && hr <= 23;
                          const isSel = hr === selectedHour;
                          const innerR = 60;
                          const outerR = isSel ? 94 : isPeak ? 89 : 76 + (hr % 3) * 4;
                          const x1 = 110 + Math.cos(angle) * innerR;
                          const y1 = 110 + Math.sin(angle) * innerR;
                          const x2 = 110 + Math.cos(angle) * outerR;
                          const y2 = 110 + Math.sin(angle) * outerR;
                          return (
                            <line
                              key={hr}
                              x1={x1}
                              y1={y1}
                              x2={x2}
                              y2={y2}
                              stroke={
                                isSel
                                  ? "var(--d-blue)"
                                  : isPeak
                                    ? "var(--d-ink-strong)"
                                    : "var(--d-line)"
                              }
                              strokeWidth={isSel ? 3.2 : isPeak ? 2.4 : 1.7}
                              strokeLinecap="round"
                              style={{ cursor: isReveal ? "default" : "pointer" }}
                              onClick={() => !isReveal && setSelectedHour(hr)}
                            />
                          );
                        })}
                        <text
                          x="110"
                          y="108"
                          textAnchor="middle"
                          fill="var(--d-ink-strong)"
                          fontSize="24"
                          fontWeight="500"
                        >
                          {String(selectedHour).padStart(2, "0")}:00
                        </text>
                        <text
                          x="110"
                          y="128"
                          textAnchor="middle"
                          fill="var(--d-ink-muted)"
                          fontSize="11"
                        >
                          peak hour
                        </text>
                      </svg>
                    </div>

                    <div style={{ fontSize: 11.5, color: "var(--d-ink-muted)" }}>
                      Peak window 20:00 - 23:00 (点击刻度切换时段)
                    </div>
                  </article>

                  {/* Card 4: Next release */}
                  <article className="orlune-card orlune-card-glow-teal">
                    <div>
                      <div className="orlune-card-head">
                        <span className="orlune-card-title">Next release</span>
                        <span
                          className="orlune-icon-btn"
                          style={{
                            width: 28,
                            height: 28,
                            background: "var(--d-pill-active-bg)",
                            color: "var(--d-pill-active-ink)",
                          }}
                        >
                          <ArrowUpRight size={14} />
                        </span>
                      </div>

                      <div style={{ marginTop: 18, color: "var(--d-ink-strong)" }}>
                        <DotMatrixText text="12" dotSize={5.4} gap={2.2} />
                      </div>
                      <div style={{ marginTop: 8, fontSize: 13, color: "var(--d-ink-muted)" }}>
                        days until{" "}
                        <strong style={{ color: "var(--d-ink-strong)" }}>
                          {releaseTitle || "Lowlight"}
                        </strong>
                      </div>

                      <div
                        style={{
                          marginTop: 16,
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 8,
                          fontSize: 12,
                        }}
                      >
                        {(
                          [
                            ["master", "Master"],
                            ["artwork", "Artwork"],
                            ["delivery", "Delivery"],
                            ["pitch", "Pitch"],
                          ] as const
                        ).map(([key, label]) => (
                          <label
                            key={key}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              cursor: "pointer",
                              color: checklist[key] ? "var(--d-ink-strong)" : "var(--d-ink-muted)",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checklist[key]}
                              readOnly={isReveal}
                              tabIndex={inactiveTab}
                              onChange={() =>
                                !isReveal &&
                                setChecklist((prev) => ({ ...prev, [key]: !prev[key] }))
                              }
                              style={{ accentColor: "#14A3A8" }}
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div style={{ marginTop: 18 }}>
                      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                        {[checklist.master, checklist.artwork, checklist.delivery, checklist.pitch].map(
                          (done, i) => (
                            <div
                              key={i}
                              style={{
                                flex: 1,
                                height: 3,
                                borderRadius: 999,
                                background: done ? "var(--d-teal)" : "var(--d-line)",
                              }}
                            />
                          )
                        )}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--d-ink-muted)" }}>
                        Single · 21 December · {territory}
                      </div>
                    </div>
                  </article>
                </section>

                {/* Bottom 3-Card Row */}
                <section className="orlune-grid-bottom">
                  {/* Top tracks */}
                  <article className="orlune-card">
                    <div className="orlune-card-head" style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className="orlune-card-title">Top tracks</span>
                        <span style={{ fontSize: 12, color: "var(--d-ink-muted)" }}>
                          Last {streamRange} · {activeNav}
                        </span>
                      </div>
                      <button
                        type="button"
                        tabIndex={inactiveTab}
                        className="orlune-badge"
                        style={{ cursor: "pointer" }}
                        onClick={() => !isReveal && setSearchOpen((v) => !v)}
                      >
                        {trackFilter ? `Filter: ${trackFilter}` : "Filter ▾"}
                      </button>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      {filteredTracks.map((tr) => (
                        <button
                          key={tr.rank}
                          type="button"
                          tabIndex={inactiveTab}
                          className={`orlune-track-row ${
                            selectedRank === tr.rank ? "is-selected" : ""
                          }`}
                          onClick={() => !isReveal && setSelectedRank(tr.rank)}
                        >
                          <span style={{ fontSize: 11, color: "var(--d-ink-muted)" }}>{tr.rank}</span>
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--d-ink-strong)" }}>
                            {tr.title}
                          </span>
                          <span
                            className="orlune-track-artist-col"
                            style={{ fontSize: 12, color: "var(--d-ink-muted)" }}
                          >
                            {tr.artist}
                          </span>
                          <div className="orlune-bar-track">
                            <div
                              className="orlune-bar-fill"
                              style={{
                                width: `${Math.round((tr.plays / 850000) * 100)}%`,
                                background: tr.color,
                              }}
                            />
                          </div>
                          <span
                            style={{
                              fontSize: 12,
                              textAlign: "right",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {tr.displayPlays}
                          </span>
                        </button>
                      ))}
                    </div>
                  </article>

                  {/* Revenue */}
                  <article className="orlune-card orlune-card-glow-blue">
                    <div>
                      <div className="orlune-card-head">
                        <span className="orlune-card-title">Revenue</span>
                        <span className="orlune-badge">{channelFilter}</span>
                      </div>

                      <div style={{ marginTop: 18, color: "var(--d-ink-strong)" }}>
                        <DotMatrixText text={revenueKpi} dotSize={3.6} gap={1.5} />
                      </div>
                      <div style={{ marginTop: 10, fontSize: 12 }}>
                        <span style={{ color: "var(--d-teal)", fontWeight: 600 }}>+$2,140</span>{" "}
                        <span style={{ color: "var(--d-ink-muted)" }}>this week</span>
                      </div>
                    </div>

                    <div style={{ marginTop: 22 }}>
                      <div style={{ display: "flex", gap: 4, height: 8, marginBottom: 12 }}>
                        <div
                          style={{
                            width: "61%",
                            borderRadius: 999,
                            background: "var(--d-ink-strong)",
                          }}
                        />
                        <div
                          style={{
                            width: "24%",
                            borderRadius: 999,
                            background: "var(--d-blue)",
                          }}
                        />
                        <div
                          style={{
                            width: "15%",
                            borderRadius: 999,
                            background: "var(--d-teal)",
                          }}
                        />
                      </div>

                      <div
                        style={{
                          display: "flex",
                          gap: 12,
                          flexWrap: "wrap",
                          fontSize: 11,
                          color: "var(--d-ink-muted)",
                          marginBottom: 12,
                        }}
                      >
                        <span>● Streaming 61%</span>
                        <span style={{ color: "var(--d-blue)" }}>● Sync 24%</span>
                        <span style={{ color: "var(--d-teal)" }}>● Live 15%</span>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 11.5,
                          color: "var(--d-ink-muted)",
                        }}
                      >
                        <span>Next payout</span>
                        <span style={{ color: "var(--d-ink-strong)", fontWeight: 600 }}>
                          1 December
                        </span>
                      </div>
                    </div>
                  </article>

                  {/* Top cities */}
                  <article className="orlune-card">
                    <div className="orlune-card-head" style={{ marginBottom: 14 }}>
                      <span className="orlune-card-title">Top cities</span>
                      <span className="orlune-badge">Audience</span>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      {[
                        { city: "Lisbon", val: "18.2K", pct: "84%", color: "var(--d-orange)" },
                        { city: "Berlin", val: "12.9K", pct: "60%", color: "var(--d-blue)" },
                        { city: "Seoul", val: "9.4K", pct: "44%", color: "var(--d-teal)" },
                        { city: "Mexico City", val: "7.1K", pct: "33%", color: "var(--d-ink-strong)" },
                      ].map((item) => (
                        <div key={item.city}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontSize: 12.5,
                              marginBottom: 5,
                            }}
                          >
                            <span>{item.city}</span>
                            <span style={{ fontWeight: 600 }}>{item.val}</span>
                          </div>
                          <div className="orlune-bar-track">
                            <div
                              className="orlune-bar-fill"
                              style={{ width: item.pct, background: item.color }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                </section>

                {/* Scrollable State Retention Workbench (verifies scroll alignment, sticky header, fixed bar, and form retention) */}
                <section className="orlune-grid-workbench">
                  <article className="orlune-card">
                    <div className="orlune-card-head" style={{ marginBottom: 14 }}>
                      <span className="orlune-card-title">
                        状态与表单保持工作台 · Form &amp; Filter State Verification
                      </span>
                      <span className="orlune-badge">Live State</span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <label className="orlune-field-label">
                        <span>发行名称（切换主题不丢失输入）</span>
                        <input
                          type="text"
                          data-testid={isReveal ? undefined : "release-title-input"}
                          className="orlune-input"
                          value={releaseTitle}
                          readOnly={isReveal}
                          tabIndex={inactiveTab}
                          onChange={(e) => !isReveal && setReleaseTitle(e.target.value)}
                        />
                      </label>

                      <label className="orlune-field-label">
                        <span>发行区域</span>
                        <select
                          className="orlune-select"
                          value={territory}
                          tabIndex={inactiveTab}
                          style={isReveal ? { pointerEvents: "none" } : undefined}
                          onChange={(e) => !isReveal && setTerritory(e.target.value)}
                        >
                          <option value="GLOBAL">Global (WW)</option>
                          <option value="EU-BERLIN">Europe · Berlin</option>
                          <option value="APAC-SEOUL">Asia-Pacific · Seoul</option>
                          <option value="LATAM-MX">LatAm · Mexico City</option>
                        </select>
                      </label>
                    </div>

                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, color: "var(--d-ink-muted)", marginBottom: 6 }}>
                        收入渠道筛选
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {(["all", "streaming", "sync", "live"] as const).map((ch) => (
                          <button
                            key={ch}
                            type="button"
                            tabIndex={inactiveTab}
                            className={`orlune-chip ${channelFilter === ch ? "is-active" : ""}`}
                            onClick={() => !isReveal && setChannelFilter(ch)}
                          >
                            {ch.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>

                    <label className="orlune-field-label" style={{ marginTop: 12 }}>
                      <span>宣发备注</span>
                      <textarea
                        rows={3}
                        className="orlune-textarea"
                        value={campaignNotes}
                        readOnly={isReveal}
                        tabIndex={inactiveTab}
                        onChange={(e) => !isReveal && setCampaignNotes(e.target.value)}
                      />
                    </label>
                  </article>

                  <article className="orlune-card">
                    <div className="orlune-card-head" style={{ marginBottom: 10 }}>
                      <span className="orlune-card-title">实现机制与渲染说明</span>
                      <span className="orlune-badge">Architecture</span>
                    </div>

                    <div
                      style={{
                        fontSize: 12.5,
                        lineHeight: 1.68,
                        color: "var(--d-ink-muted)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <p style={{ margin: 0 }}>
                        1. <strong style={{ color: "var(--d-ink-strong)" }}>动态 SVG clipPath</strong>：点击右上角切换开关后，单一{" "}
                        <code>requestAnimationFrame</code> 仅更新 <code>&lt;path d="..."&gt;</code>，由按钮底部垂直流出摆动液柱、分离液滴，触底飞溅涟漪并推动多谐波液面上涨覆盖全屏。
                      </p>
                      <p style={{ margin: 0 }}>
                        2. <strong style={{ color: "var(--d-ink-strong)" }}>双层同步与无障碍隔离</strong>：揭示层挂载 <code>inert</code> 与 <code>aria-hidden="true"</code>，禁用焦点和重复点击，同步窗口滚动与内层滚动容器，<code>sticky</code> 顶栏与底部 <code>fixed</code> 播放条像素级对齐。
                      </p>
                      <p style={{ margin: 0 }}>
                        3. <strong style={{ color: "var(--d-ink-strong)" }}>Web Audio 同步合成</strong>：默认关闭，仅在用户交互后解锁 <code>AudioContext</code>，随实际进度触发倾倒、触底水花、连续水声及浅/深差分收尾音；窗口后台/打断/静音时即时中止且不误播完成音。
                      </p>
                    </div>
                  </article>
                </section>
              </main>

              {/* Fixed Bottom Mini-Dock (verifies fixed-element alignment across sticky + scrolled reveal) */}
              <div className="orlune-fixed-dock-wrap">
                <div className="orlune-fixed-dock">
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <button
                      type="button"
                      tabIndex={inactiveTab}
                      className="orlune-icon-btn"
                      style={{
                        background: "var(--d-pill-active-bg)",
                        color: "var(--d-pill-active-ink)",
                      }}
                      title={isPlaying ? "Pause monitor" : "Play monitor"}
                      onClick={() => !isReveal && setIsPlaying((p) => !p)}
                    >
                      {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--d-ink-strong)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {activeTrack.title} · {activeTrack.artist}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--d-ink-muted)" }}>
                        Fixed Bar Alignment · {activeTrack.city} · {liquid.theme.toUpperCase()} MODE
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      type="button"
                      tabIndex={inactiveTab}
                      className="orlune-chip"
                      onClick={(e) => !isReveal && liquid.toggleTheme(e)}
                    >
                      <Droplets size={12} style={{ color: "var(--d-teal)" }} />
                      <span>液体揭示切换</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        }}
      </LiquidThemeStage>
    </div>
  );
}
