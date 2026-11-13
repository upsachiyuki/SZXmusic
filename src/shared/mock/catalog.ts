import { makeCoverDataUri } from "./coverArt";

export type CrateKind = "favorite" | "season" | "artist" | "smart" | "similar" | "daily" | "custom";

export interface TrackPageItem {
  cid: number;
  page: number;
  part: string;
  duration: number;
  first_frame?: string;
}

export interface TrackItem {
  id: string;
  bvid: string;
  cid?: number;
  page: number;
  pages?: TrackPageItem[];
  rawTitle: string;
  title: string;
  artist: string;
  version: string;
  confidence: number;
  ruleId: string;
  reason?: string;
  tags?: string[];
  durationSec: number;
  qualityLabel: string;
  coverUrl: string;
  bpm: number;
  musicalKey: string;
  energy: number; // 1..5
  reasonTag: string;
  isInvalid?: boolean;
  isNew?: boolean;
}

export interface CrateItem {
  id: string;
  title: string;
  subtitle: string;
  kind: CrateKind;
  sortKey: string;
  /** Video covers used on the sleeve (1 = single hero video cover, 4 = 2x2 video cover collage) */
  covers: string[];
  tracks: TrackItem[];
  remoteMediaId?: number;
  newCount?: number;
}

const COVER_SUNSET = makeCoverDataUri({
  id: "sunset",
  bgA: "#4a2c24",
  bgB: "#1e1a18",
  accent: "#d97757",
  motif: "sunset",
  caption: "晴天 · 4K修复",
  badge: "FLAC",
});

const COVER_CITY = makeCoverDataUri({
  id: "city",
  bgA: "#2a2b3d",
  bgB: "#171820",
  accent: "#e28a62",
  motif: "city",
  caption: "Plastic Love",
  badge: "Hi-Res",
});

const COVER_NEON = makeCoverDataUri({
  id: "neon",
  bgA: "#372434",
  bgB: "#1a171c",
  accent: "#d97757",
  motif: "neon",
  caption: "深夜电波",
  badge: "192K",
});

const COVER_WAVES = makeCoverDataUri({
  id: "waves",
  bgA: "#23363b",
  bgB: "#161d1f",
  accent: "#e09a6c",
  motif: "waves",
  caption: "群青 · Live",
  badge: "LIVE",
});

const COVER_FOREST = makeCoverDataUri({
  id: "forest",
  bgA: "#24332a",
  bgB: "#151a17",
  accent: "#d97757",
  motif: "forest",
  caption: "万物生长",
  badge: "INDIE",
});

const COVER_ORBIT = makeCoverDataUri({
  id: "orbit",
  bgA: "#3a2d25",
  bgB: "#191615",
  accent: "#e4885c",
  motif: "orbit",
  caption: "Astronomia",
  badge: "OST",
});

const COVER_RAIN = makeCoverDataUri({
  id: "rain",
  bgA: "#2c3036",
  bgB: "#18191c",
  accent: "#d97757",
  motif: "rain",
  caption: "雨夜弹唱",
  badge: "COVER",
});

const COVER_GRID = makeCoverDataUri({
  id: "grid",
  bgA: "#3d2621",
  bgB: "#171413",
  accent: "#e07a54",
  motif: "grid",
  caption: "80s Synth",
  badge: "REMIX",
});

const COVER_VINYL = makeCoverDataUri({
  id: "vinyl",
  bgA: "#302b27",
  bgB: "#191716",
  accent: "#d97757",
  motif: "vinyl",
  caption: "七里香 · 现场",
  badge: "FLAC",
});

export const MOCK_CRATES: CrateItem[] = [
  {
    id: "crate-commute",
    title: "通勤收藏夹",
    subtitle: "B站收藏夹 · 24 首",
    kind: "favorite",
    sortKey: "T",
    covers: [COVER_SUNSET, COVER_WAVES, COVER_VINYL, COVER_FOREST],
    tracks: [
      {
        id: "trk-1",
        bvid: "BV1xx411c7mD",
        page: 1,
        rawTitle: "【4K修复】周杰伦 - 晴天 官方MV 无损音质",
        title: "晴天",
        artist: "周杰伦",
        version: "Original",
        confidence: 0.96,
        ruleId: "dash-separated",
        durationSec: 269,
        qualityLabel: "FLAC 24/96",
        coverUrl: COVER_SUNSET,
        bpm: 92,
        musicalKey: "Am",
        energy: 4,
        reasonTag: "高频点播 · 92 BPM",
      },
      {
        id: "trk-2",
        bvid: "BV1Ys411h7qK",
        page: 1,
        rawTitle: "周杰伦 - 七里香 (2004 无与伦比演唱会 Live)",
        title: "七里香",
        artist: "周杰伦",
        version: "Live",
        confidence: 0.94,
        ruleId: "dash-separated",
        durationSec: 302,
        qualityLabel: "FLAC 16/44.1",
        coverUrl: COVER_VINYL,
        bpm: 88,
        musicalKey: "Am",
        energy: 4,
        reasonTag: "同调 Am · 常一起听",
      },
      {
        id: "trk-3",
        bvid: "BV1w54y1m7C8",
        page: 1,
        rawTitle: "【YOASOBI】群青 (THE FIRST TAKE Live)",
        title: "群青",
        artist: "YOASOBI",
        version: "Live",
        confidence: 0.91,
        ruleId: "bracket-artist",
        durationSec: 256,
        qualityLabel: "AAC 192K",
        coverUrl: COVER_WAVES,
        bpm: 135,
        musicalKey: "C",
        energy: 5,
        reasonTag: "同流派日系流行",
      },
      {
        id: "trk-4",
        bvid: "BV1kN411P7aL",
        page: 1,
        rawTitle: "万能青年旅店 - 杀死那个石家庄人【无损】",
        title: "杀死那个石家庄人",
        artist: "万能青年旅店",
        version: "Original",
        confidence: 0.97,
        ruleId: "dash-separated",
        durationSec: 344,
        qualityLabel: "FLAC 24/48",
        coverUrl: COVER_FOREST,
        bpm: 108,
        musicalKey: "Em",
        energy: 4,
        reasonTag: "华语独立摇滚",
      },
      {
        id: "trk-5",
        bvid: "BV19Z4y1s79T",
        page: 2,
        rawTitle: "Rainy Acoustic / 陈绮贞《旅行的意义》吉他翻唱",
        title: "旅行的意义",
        artist: "陈绮贞",
        version: "Cover",
        confidence: 0.87,
        ruleId: "book-title",
        durationSec: 245,
        qualityLabel: "AAC 192K",
        coverUrl: COVER_RAIN,
        bpm: 86,
        musicalKey: "G",
        energy: 2,
        reasonTag: "原声吉他音色接近",
      },
    ],
  },
  {
    id: "crate-citypop",
    title: "日系 City Pop",
    subtitle: "UP 合集 · 18 首",
    kind: "season",
    sortKey: "C",
    covers: [COVER_CITY],
    tracks: [
      {
        id: "trk-6",
        bvid: "BV12b411q7mP",
        cid: 1001,
        page: 1,
        pages: [
          { cid: 1001, page: 1, part: "Plastic Love (1984 Extended)", duration: 472 },
          { cid: 1002, page: 2, part: "Stay With Me — 真夜中のドア", duration: 312 },
          { cid: 1003, page: 3, part: "Ride On Time (Live 1980)", duration: 264 },
        ],
        rawTitle: "竹内まりや - Plastic Love (1984 Extended)",
        title: "Plastic Love",
        artist: "竹内まりや",
        version: "Original",
        confidence: 0.95,
        ruleId: "dash-separated",
        durationSec: 472,
        qualityLabel: "Hi-Res FLAC",
        coverUrl: COVER_CITY,
        bpm: 118,
        musicalKey: "Fm",
        energy: 4,
        reasonTag: "80s 都市律动",
      },
      {
        id: "trk-7",
        bvid: "BV1M4411e7V1",
        page: 1,
        rawTitle: "山下達郎 - Sparkle【高音质黑胶转录】",
        title: "Sparkle",
        artist: "山下達郎",
        version: "Original",
        confidence: 0.94,
        ruleId: "dash-separated",
        durationSec: 254,
        qualityLabel: "FLAC 24/96",
        coverUrl: COVER_GRID,
        bpm: 116,
        musicalKey: "F#m",
        energy: 5,
        reasonTag: "相似艺人 · 编曲同源",
      },
    ],
  },
  {
    id: "crate-midnight",
    title: "深夜编码电台",
    subtitle: "智能唱片 · 15 首",
    kind: "smart",
    sortKey: "S",
    covers: [COVER_NEON, COVER_RAIN, COVER_ORBIT, COVER_CITY],
    tracks: [
      {
        id: "trk-8",
        bvid: "BV1aT4y197xX",
        page: 1,
        rawTitle: "Nujabes - Luv(sic) pt.3 feat. Shing02",
        title: "Luv(sic) pt.3",
        artist: "Nujabes",
        version: "Original",
        confidence: 0.93,
        ruleId: "dash-separated",
        durationSec: 336,
        qualityLabel: "FLAC 16/44.1",
        coverUrl: COVER_NEON,
        bpm: 94,
        musicalKey: "Dm",
        energy: 3,
        reasonTag: "BPM ≈ 92 · 夜间低频",
      },
      {
        id: "trk-9",
        bvid: "BV1pK4y1b7zB",
        page: 1,
        rawTitle: "梶浦由記 - Sis puella magica! [Hi-Res]",
        title: "Sis puella magica!",
        artist: "梶浦由記",
        version: "Original",
        confidence: 0.96,
        ruleId: "dash-separated",
        durationSec: 169,
        qualityLabel: "Hi-Res FLAC",
        coverUrl: COVER_ORBIT,
        bpm: 102,
        musicalKey: "Cm",
        energy: 3,
        reasonTag: "弦乐氛围相似",
      },
    ],
  },
  {
    id: "crate-acg",
    title: "ACG 与游戏原声",
    subtitle: "B站收藏夹 · 32 首",
    kind: "favorite",
    sortKey: "A",
    covers: [COVER_ORBIT],
    tracks: [
      {
        id: "trk-10",
        bvid: "BV1zW4y1F7dK",
        page: 1,
        rawTitle: "Evan Call - Zoltraak (葬送的芙莉莲 OST)",
        title: "Zoltraak",
        artist: "Evan Call",
        version: "Original",
        confidence: 0.95,
        ruleId: "dash-separated",
        durationSec: 194,
        qualityLabel: "FLAC 24/48",
        coverUrl: COVER_ORBIT,
        bpm: 128,
        musicalKey: "Dm",
        energy: 5,
        reasonTag: "声学动态相似",
      },
    ],
  },
  {
    id: "crate-indie",
    title: "华语独立现场",
    subtitle: "智能唱片 · 12 首",
    kind: "smart",
    sortKey: "H",
    covers: [COVER_FOREST],
    tracks: [
      {
        id: "trk-11",
        bvid: "BV1D5411c72A",
        page: 1,
        rawTitle: "郭顶 - 凄美地【4K 演唱会现场】",
        title: "凄美地",
        artist: "郭顶",
        version: "Live",
        confidence: 0.94,
        ruleId: "dash-separated",
        durationSec: 251,
        qualityLabel: "AAC 192K",
        coverUrl: COVER_FOREST,
        bpm: 96,
        musicalKey: "Em",
        energy: 3,
        reasonTag: "同歌单共现 · 声学匹配",
      },
    ],
  },
  {
    id: "crate-daily",
    title: "每日推荐 11.13",
    subtitle: "本地多路召回 · 10 首",
    kind: "daily",
    sortKey: "M",
    covers: [COVER_RAIN, COVER_SUNSET, COVER_GRID, COVER_NEON],
    tracks: [
      {
        id: "trk-12",
        bvid: "BV17x411z79M",
        page: 1,
        rawTitle: "草东没有派对 - 山海 [Live 现场版]",
        title: "山海",
        artist: "草东没有派对",
        version: "Live",
        confidence: 0.92,
        ruleId: "dash-separated",
        durationSec: 251,
        qualityLabel: "FLAC 16/44.1",
        coverUrl: COVER_RAIN,
        bpm: 112,
        musicalKey: "Am",
        energy: 4,
        reasonTag: "相似艺人 + 高频共现",
      },
    ],
  },
  {
    id: "crate-synth",
    title: "Synthwave / 复古合成器",
    subtitle: "B站合集 · 16 首",
    kind: "season",
    sortKey: "R",
    covers: [COVER_GRID],
    tracks: [
      {
        id: "trk-13",
        bvid: "BV1eV411e7b8",
        page: 1,
        rawTitle: "The Midnight - Sunset (Instrumental Remix)",
        title: "Sunset",
        artist: "The Midnight",
        version: "Remix",
        confidence: 0.91,
        ruleId: "dash-separated",
        durationSec: 278,
        qualityLabel: "AAC 192K",
        coverUrl: COVER_GRID,
        bpm: 114,
        musicalKey: "C",
        energy: 4,
        reasonTag: "同流派合成器浪潮",
      },
    ],
  },
  {
    id: "crate-cover",
    title: "宝藏翻唱与木吉他",
    subtitle: "UP 合集 · 21 首",
    kind: "favorite",
    sortKey: "B",
    covers: [COVER_RAIN],
    tracks: [
      {
        id: "trk-14",
        bvid: "BV1q44y1g79B",
        page: 1,
        rawTitle: "【吉他弹唱】晴天 - 周杰伦 (Cover)",
        title: "晴天",
        artist: "周杰伦",
        version: "Cover",
        confidence: 0.89,
        ruleId: "dash-separated",
        durationSec: 244,
        qualityLabel: "AAC 192K",
        coverUrl: COVER_RAIN,
        bpm: 90,
        musicalKey: "G",
        energy: 2,
        reasonTag: "同曲翻唱版本",
      },
    ],
  },
  {
    id: "crate-jay",
    title: "周杰伦 · 精选盘",
    subtitle: "按艺人自动生成 · 19 首",
    kind: "artist",
    sortKey: "Z",
    covers: [COVER_VINYL, COVER_SUNSET, COVER_RAIN, COVER_CITY],
    tracks: [
      {
        id: "trk-15",
        bvid: "BV1fx411d7C2",
        page: 1,
        rawTitle: "周杰伦 - 夜曲【官方MV 4K修复】",
        title: "夜曲",
        artist: "周杰伦",
        version: "Original",
        confidence: 0.97,
        ruleId: "dash-separated",
        durationSec: 226,
        qualityLabel: "FLAC 24/96",
        coverUrl: COVER_VINYL,
        bpm: 90,
        musicalKey: "Cm",
        energy: 3,
        reasonTag: "同艺人 · 声学近似",
      },
    ],
  },
];

export interface PendingParseItem {
  id: string;
  bvid: string;
  uploader: string;
  ownerMid?: number;
  coverUrl?: string;
  rawTitle: string;
  suggestedTitle: string;
  suggestedArtist: string;
  version?: string;
  ruleId?: string;
  confidence: number;
  reason: string;
}

export const MOCK_PENDING_ITEMS: PendingParseItem[] = [
  {
    id: "pend-1",
    bvid: "BV1Xy4y1k7Zp",
    uploader: "失眠唱片馆",
    rawTitle: "半夜两点循环的歌《落日飞车》My Jinji 超清现场",
    suggestedTitle: "My Jinji",
    suggestedArtist: "落日飞车",
    confidence: 0.58,
    reason: "《》内为艺人而非歌名，置信度低于阈值 0.70",
  },
  {
    id: "pend-2",
    bvid: "BV19w411S7Q2",
    uploader: "路边小号手",
    rawTitle: "【随手录】天气太好忍不住吹了一段新宝岛",
    suggestedTitle: "新宝岛",
    suggestedArtist: "路边小号手",
    confidence: 0.52,
    reason: "无分隔符，暂用 UP 主名兜底艺人",
  },
  {
    id: "pend-3",
    bvid: "BV1Lm411f74C",
    uploader: "夜行电台FM",
    rawTitle: "深夜自习室 01 | 2小时无广告纯音乐合集（含时间轴）",
    suggestedTitle: "深夜自习室 01",
    suggestedArtist: "夜行电台FM",
    confidence: 0.49,
    reason: "疑似多曲合集，建议拆分为时间轴曲目",
  },
];
