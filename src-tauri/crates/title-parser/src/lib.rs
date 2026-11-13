use std::collections::HashSet;

use serde::{Deserialize, Serialize};

const DEFAULT_RULES_TOML: &str = include_str!("../../../../rules/default.toml");

#[derive(Debug, Clone, Deserialize)]
pub struct RulesFile {
    #[serde(default)]
    pub noise: Vec<SimplePatternRule>,
    #[serde(default)]
    pub version_rule: Vec<VersionPatternRule>,
    #[serde(default)]
    pub rule: Vec<MainRule>,
    #[serde(default)]
    pub uploader_rule: Vec<UploaderRule>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SimplePatternRule {
    pub id: String,
    pub pattern: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VersionPatternRule {
    pub id: String,
    pub version: String,
    pub pattern: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MainRule {
    pub id: String,
    #[serde(default = "default_priority")]
    pub priority: i32,
    pub pattern: String,
    #[serde(default)]
    pub artist_from: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct UploaderRule {
    pub id: String,
    pub mid: u64,
    pub pattern: String,
    #[serde(default)]
    pub description: Option<String>,
}

fn default_priority() -> i32 {
    50
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ParseContext {
    pub owner_name: String,
    pub owner_mid: u64,
    pub tname: String,
    pub part_name: String,
    pub desc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedTrack {
    pub title: String,
    pub artists: Vec<String>,
    pub artist_display: String,
    pub version: String,
    pub tags: Vec<String>,
    pub confidence: f32,
    pub rule_id: String,
    pub reason: String,
    pub normalized_input: String,
    pub stripped_input: String,
}

enum CompiledRegex {
    Fast(regex::Regex),
    Fancy(fancy_regex::Regex),
}

impl CompiledRegex {
    fn compile(pattern: &str) -> Result<Self, String> {
        match regex::Regex::new(pattern) {
            Ok(re) => Ok(Self::Fast(re)),
            Err(_) => fancy_regex::Regex::new(pattern)
                .map(Self::Fancy)
                .map_err(|e| format!("无效正则 '{pattern}': {e}")),
        }
    }

    fn capture_named(&self, text: &str, group: &str) -> Option<String> {
        match self {
            Self::Fast(re) => re
                .captures(text)
                .and_then(|c| c.name(group))
                .map(|m| m.as_str().trim().to_string()),
            Self::Fancy(re) => re
                .captures(text)
                .ok()
                .flatten()
                .and_then(|c| c.name(group))
                .map(|m| m.as_str().trim().to_string()),
        }
    }

    fn strip_all(&self, text: &str, matched_out: &mut Vec<String>) -> String {
        match self {
            Self::Fast(re) => {
                for m in re.find_iter(text) {
                    let clean = clean_bracket_edges(m.as_str());
                    if !clean.is_empty() {
                        matched_out.push(clean);
                    }
                }
                re.replace_all(text, " ").into_owned()
            }
            Self::Fancy(re) => {
                let mut current = text.to_string();
                let mut guard = 0;
                while guard < 12 {
                    guard += 1;
                    let Ok(Some(m)) = re.find(&current) else {
                        break;
                    };
                    if m.start() == m.end() {
                        break;
                    }
                    let clean = clean_bracket_edges(m.as_str());
                    if !clean.is_empty() {
                        matched_out.push(clean);
                    }
                    current = format!("{} {}", &current[..m.start()], &current[m.end()..]);
                }
                current
            }
        }
    }

    fn extract_version(&self, text: &str) -> Option<(String, Option<String>)> {
        match self {
            Self::Fast(re) => re.captures(text).and_then(|caps| {
                let m = caps.get(0)?;
                let orig = caps
                    .name("orig")
                    .map(|g| g.as_str().trim().to_string())
                    .filter(|s| !s.is_empty());
                let stripped = format!("{} {}", &text[..m.start()], &text[m.end()..]);
                Some((stripped, orig))
            }),
            Self::Fancy(re) => re.captures(text).ok().flatten().and_then(|caps| {
                let m = caps.get(0)?;
                let orig = caps
                    .name("orig")
                    .map(|g| g.as_str().trim().to_string())
                    .filter(|s| !s.is_empty());
                let stripped = format!("{} {}", &text[..m.start()], &text[m.end()..]);
                Some((stripped, orig))
            }),
        }
    }
}

pub struct TitleParser {
    noise_rules: Vec<(String, CompiledRegex)>,
    version_rules: Vec<(String, String, CompiledRegex)>,
    main_rules: Vec<(MainRule, CompiledRegex)>,
    uploader_rules: Vec<(UploaderRule, CompiledRegex)>,
}

impl TitleParser {
    pub fn from_default_with_extras(
        extra_main: Vec<MainRule>,
        extra_uploader: Vec<UploaderRule>,
    ) -> Self {
        let mut cfg: RulesFile = toml::from_str(DEFAULT_RULES_TOML).unwrap_or(RulesFile {
            noise: Vec::new(),
            version_rule: Vec::new(),
            rule: Vec::new(),
            uploader_rule: Vec::new(),
        });
        cfg.rule.extend(extra_main);
        cfg.uploader_rule.extend(extra_uploader);
        Self::from_config(cfg)
    }

    pub fn from_config(mut cfg: RulesFile) -> Self {
        let noise_rules = cfg
            .noise
            .into_iter()
            .filter_map(|r| CompiledRegex::compile(&r.pattern).ok().map(|re| (r.id, re)))
            .collect();

        let version_rules = cfg
            .version_rule
            .into_iter()
            .filter_map(|r| {
                CompiledRegex::compile(&r.pattern)
                    .ok()
                    .map(|re| (r.id, r.version, re))
            })
            .collect();

        cfg.rule.sort_by(|a, b| b.priority.cmp(&a.priority));
        let main_rules = cfg
            .rule
            .into_iter()
            .filter_map(|r| CompiledRegex::compile(&r.pattern).ok().map(|re| (r, re)))
            .collect();

        let uploader_rules = cfg
            .uploader_rule
            .into_iter()
            .filter_map(|r| CompiledRegex::compile(&r.pattern).ok().map(|re| (r, re)))
            .collect();

        Self {
            noise_rules,
            version_rules,
            main_rules,
            uploader_rules,
        }
    }

    pub fn validate_pattern(pattern: &str) -> Result<(), String> {
        let trimmed = pattern.trim();
        if trimmed.is_empty() {
            return Err("正则模式不能为空".into());
        }
        if !trimmed.contains("(?P<title>") && !trimmed.contains("(?<title>") {
            return Err("正则需包含命名捕获组 (?P<title>...) 以提取歌名".into());
        }
        CompiledRegex::compile(trimmed).map(|_| ())
    }

    pub fn parse(&self, raw_title: &str, ctx: &ParseContext) -> ParsedTrack {
        // Choose effective input: prefer specific multi-P part_name when present and informative
        let part_clean = ctx.part_name.trim();
        let source_title = if !part_clean.is_empty()
            && part_clean != raw_title.trim()
            && !is_generic_part_name(part_clean)
        {
            part_clean
        } else {
            raw_title
        };

        let normalized = normalize_title(source_title);
        let mut working = normalized.clone();
        let mut tags = Vec::new();

        // Step 2: noise & optional leading multi-P index stripping ("01. ", "02、", "01 - ")
        if source_title != raw_title {
            working = strip_leading_track_index(&working);
        }
        for (_id, re) in &self.noise_rules {
            working = re.strip_all(&working, &mut tags);
        }
        if source_title != raw_title {
            working = strip_leading_track_index(&working);
        }
        working = collapse_spaces(&working);
        working = trim_punct_edges(&working);

        // Step 3: version extraction (extract all matching version badges, e.g. both 【翻唱】 and （Cover：原唱）)
        let mut version = "Original".to_string();
        for (_id, ver_name, re) in &self.version_rules {
            for _ in 0..4 {
                let Some((next_work, orig_hint)) = re.extract_version(&working) else {
                    break;
                };
                if version == "Original" {
                    version = ver_name.clone();
                }
                if let Some(orig) = orig_hint {
                    tags.push(format!("原唱:{orig}"));
                }
                let cleaned = trim_punct_edges(&collapse_spaces(&next_work));
                if cleaned == working {
                    break;
                }
                working = cleaned;
            }
        }
        // Fallback version scan from parent raw_title if part_name didn't carry it
        if version == "Original" && source_title != raw_title {
            let norm_parent = normalize_title(raw_title);
            for (_id, ver_name, re) in &self.version_rules {
                if re.extract_version(&norm_parent).is_some() {
                    version = ver_name.clone();
                    break;
                }
            }
        }

        let stripped_input = working.clone();

        // Step 4: Uploader-specific rules first, then priority main rules
        let mut matched_title: Option<String> = None;
        let mut matched_artist: Option<String> = None;
        let mut hit_rule_id = "fallback-uploader".to_string();
        let mut base_conf = 0.48f32;
        let mut reason = "未能命中规则，暂时以 UP 主作歌手兜底".to_string();

        for (ur, re) in &self.uploader_rules {
            if ur.mid != 0 && ur.mid != ctx.owner_mid {
                continue;
            }
            if let Some(t) = re.capture_named(&working, "title") {
                matched_title = Some(t);
                matched_artist = re.capture_named(&working, "artist");
                hit_rule_id = ur.id.clone();
                base_conf = 0.94;
                reason = format!("命中专属 UP 规则 ({hit_rule_id})");
                break;
            }
        }

        if matched_title.is_none() {
            for (mr, re) in &self.main_rules {
                if let Some(t) = re.capture_named(&working, "title") {
                    let cleaned_t = trim_punct_edges(&t);
                    if cleaned_t.is_empty() {
                        continue;
                    }
                    let cap_artist = re.capture_named(&working, "artist").filter(|s| !s.is_empty());

                    // Special handling for bracket-artist:
                    // 1) "【本草纲目|4K纯享】蹲！" -> bracket holds song title + quality tag
                    // 2) "【4K纯享】..." or "【中字】..." -> bracket is a tag/topic, not an artist
                    if mr.id == "bracket-artist" {
                        if let Some(ref raw_br) = cap_artist {
                            if let Some((song_part, tag_part)) = raw_br.split_once(['|', '｜', '丨']) {
                                if is_noise_or_topic_label(tag_part) && !song_part.trim().is_empty() {
                                    matched_title = Some(song_part.trim().to_string());
                                    matched_artist = if !ctx.owner_name.is_empty() {
                                        Some(ctx.owner_name.clone())
                                    } else {
                                        None
                                    };
                                    hit_rule_id = "bracket-song-pipe-tag".to_string();
                                    base_conf = 0.88;
                                    reason = "命中规则 bracket-song-pipe-tag".to_string();
                                    break;
                                }
                            }
                            if is_noise_or_topic_label(raw_br) {
                                // Strip the leading topic/tag bracket and let remaining rules or clean title take over
                                matched_title = Some(cleaned_t);
                                matched_artist = if !ctx.owner_name.is_empty() {
                                    Some(ctx.owner_name.clone())
                                } else {
                                    None
                                };
                                hit_rule_id = "bracket-tag-stripped".to_string();
                                base_conf = 0.80;
                                reason = "剥离前缀标签括号".to_string();
                                break;
                            }
                        }
                    }

                    // Reject pure numbers as artist in dash-separated / slash rules
                    if let Some(ref a) = cap_artist {
                        if a.chars().all(|c| c.is_ascii_digit() || c.is_whitespace()) {
                            continue;
                        }
                    }

                    matched_title = Some(cleaned_t);
                    matched_artist = if cap_artist.is_some() {
                        cap_artist
                    } else if mr.artist_from.as_deref() == Some("uploader") && !ctx.owner_name.is_empty() {
                        Some(ctx.owner_name.clone())
                    } else {
                        None
                    };
                    hit_rule_id = mr.id.clone();
                    base_conf = match mr.id.as_str() {
                        "bracket-artist" => 0.87,
                        "angle-title-artist" => 0.90,
                        "dash-separated" => 0.85,
                        "vocaloid-slash" => 0.82,
                        "pipe-trailing-artist" => 0.82,
                        "book-title" => 0.78,
                        "trailing-bracket-title" => 0.84,
                        "corner-quote-title" => 0.82,
                        "series-pipe-title" => 0.84,
                        _ if mr.priority >= 85 => 0.86,
                        _ if mr.priority >= 70 => 0.78,
                        _ => 0.74,
                    };
                    reason = format!("命中规则 {hit_rule_id}");
                    break;
                }
            }
        }

        // If this is a multi-P video with an informative part_name, promote confidence and infer album/artist from raw_title
        if matched_title.is_none() && source_title != raw_title && !working.is_empty() {
            matched_title = Some(working.clone());
            if matched_artist.is_none() {
                matched_artist = extract_leading_bracket_album(raw_title)
                    .or_else(|| (!ctx.owner_name.trim().is_empty()).then(|| ctx.owner_name.trim().to_string()));
            }
            hit_rule_id = "multipage-part".to_string();
            base_conf = 0.86;
            reason = "分P独立曲目识别".to_string();
        }

        let mut final_title = matched_title
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                if working.is_empty() {
                    normalized.clone()
                } else {
                    working.clone()
                }
            });
        // Strip outer 《》 if rule left book quotes around title
        final_title = final_title
            .trim_start_matches('《')
            .trim_end_matches('》')
            .trim()
            .to_string();

        let fallback_artist = if ctx.owner_name.trim().is_empty() {
            "未知艺人".to_string()
        } else {
            ctx.owner_name.trim().to_string()
        };
        let artist_raw = matched_artist.unwrap_or_else(|| fallback_artist.clone());
        let artists: Vec<String> = split_artists(&artist_raw);
        let artist_display = if artists.is_empty() {
            fallback_artist
        } else {
            artists.join(" / ")
        };

        // Step 5: Context validation & confidence adjustment
        let mut conf = base_conf;
        let owner_lc = ctx.owner_name.to_lowercase();
        let desc_lc = ctx.desc.to_lowercase();
        if artists.iter().any(|a| {
            let al = a.to_lowercase();
            !al.is_empty() && (owner_lc.contains(&al) || al.contains(&owner_lc) || desc_lc.contains(&al))
        }) {
            conf += 0.08;
            reason.push_str(" · UP/简介佐证");
        }
        if final_title.chars().count() > 42 || has_unbalanced_brackets(&final_title) {
            conf -= 0.16;
            reason.push_str(" · 标题较长/含未闭合括号");
        }
        if ctx.tname.contains("翻唱") && version == "Cover" {
            conf += 0.05;
        }
        conf = conf.clamp(0.05, 0.99);

        let mut seen = HashSet::new();
        let dedup_tags: Vec<String> = tags
            .into_iter()
            .filter(|t| seen.insert(t.clone()))
            .collect();

        ParsedTrack {
            title: final_title,
            artists,
            artist_display,
            version,
            tags: dedup_tags,
            confidence: (conf * 100.0).round() / 100.0,
            rule_id: hit_rule_id,
            reason,
            normalized_input: normalized,
            stripped_input,
        }
    }
}

pub fn is_generic_part_name(part: &str) -> bool {
    let lower = part.trim().to_lowercase();
    if matches!(
        lower.as_str(),
        "" | "full" | "正片" | "完整版" | "视频" | "音频" | "mv" | "pv" | "audio" | "video"
    ) {
        return true;
    }
    let stripped = lower
        .trim_start_matches("part")
        .trim_start_matches("disc")
        .trim_start_matches("分p")
        .trim_start_matches("cd")
        .trim_start_matches("ep")
        .trim_start_matches('p')
        .trim_start_matches(|c: char| matches!(c, ' ' | '-' | '_' | '.' | '#' | ':' | '：'));
    !stripped.is_empty() && stripped.len() <= 3 && stripped.chars().all(|c| c.is_ascii_digit())
}

fn normalize_title(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        let mapped = match ch {
            '（' => '(',
            '）' => ')',
            '［' => '[',
            '］' => ']',
            '　' => ' ',
            '：' => ':',
            '－' => '-',
            _ => ch,
        };
        out.push(mapped);
    }
    collapse_spaces(&out)
}

fn collapse_spaces(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clean_bracket_edges(s: &str) -> String {
    s.trim()
        .trim_matches(|c| matches!(c, '【' | '】' | '[' | ']' | '(' | ')' | '（' | '）'))
        .trim()
        .to_string()
}

fn trim_punct_edges(s: &str) -> String {
    s.trim()
        .trim_matches(|c: char| matches!(c, '-' | '–' | '—' | '/' | '|' | ':' | '：' | ' '))
        .trim()
        .to_string()
}

fn strip_leading_track_index(s: &str) -> String {
    let mut trimmed = s.trim_start();
    // 0. Strip leading bracketed page tag like "[P01] ", "【02】 "
    for (open, close) in [('【', '】'), ('[', ']'), ('(', ')')] {
        if let Some(after_open) = trimmed.strip_prefix(open) {
            if let Some((inside, rest)) = after_open.split_once(close) {
                if is_generic_part_name(inside) && !rest.trim().is_empty() {
                    trimmed = rest.trim_start();
                    break;
                }
            }
        }
    }

    // 1. Strip leading "P27:", "P1 ", "EP1 ", "Ep08 "
    let lower = trimmed.to_lowercase();
    for prefix in ["ep", "p"] {
        if let Some(after_p) = lower.strip_prefix(prefix) {
            let digits = after_p.chars().take_while(|c| c.is_ascii_digit()).count();
            if (1..=3).contains(&digits) {
                let raw_rest = &trimmed[prefix.len() + digits..];
                let cleaned = raw_rest
                    .trim_start_matches(|c: char| {
                        matches!(c, ':' | '：' | '.' | '、' | '-' | '–' | '—' | '_' | ')' | ' ')
                    })
                    .trim();
                if !cleaned.is_empty() {
                    return cleaned.to_string();
                }
            }
        }
    }

    // 2. Strip leading "01 - ", "01. ", "01、", "01) ", "01_ ", "01： ", "01 "
    let digits = trimmed.chars().take_while(|c| c.is_ascii_digit()).count();
    if (1..=3).contains(&digits) {
        let rest = &trimmed[digits..];
        let trimmed_rest = rest.trim_start();
        if let Some(after_sep) = rest
            .strip_prefix('.')
            .or_else(|| rest.strip_prefix('、'))
            .or_else(|| rest.strip_prefix(')'))
            .or_else(|| rest.strip_prefix('_'))
            .or_else(|| rest.strip_prefix(':'))
            .or_else(|| rest.strip_prefix('：'))
            .or_else(|| trimmed_rest.strip_prefix('-'))
            .or_else(|| trimmed_rest.strip_prefix('–'))
            .or_else(|| trimmed_rest.strip_prefix('—'))
        {
            if !after_sep.trim().is_empty() {
                return after_sep.trim().to_string();
            }
        }
        // Or "25 第一章 上" -> strip leading track number + space
        if rest.starts_with(' ') && !trimmed_rest.is_empty() {
            return trimmed_rest.to_string();
        }
    }
    trimmed.to_string()
}

fn is_noise_or_topic_label(s: &str) -> bool {
    let lc = s.trim().to_lowercase();
    let noise_keywords = [
        "4k", "8k", "1080p", "720p", "60fps", "hi-res", "hires", "hdr", "纯享", "无损",
        "中字", "双语", "字幕", "熟肉", "生肉", "自压", "合集", "ost", "官方", "mv", "pv",
        "杜比", "dolby", "黑屏", "弹幕版", "完整版", "收藏级", "游番剧",
    ];
    noise_keywords.iter().any(|k| lc.contains(k))
}

fn extract_leading_bracket_album(raw_title: &str) -> Option<String> {
    let t = raw_title.trim();
    if let Some(rest) = t.strip_prefix('【') {
        if let Some((inside, _)) = rest.split_once('】') {
            let clean = inside.trim();
            if !clean.is_empty() && !is_noise_or_topic_label(clean) {
                return Some(clean.to_string());
            }
        }
    }
    None
}

fn split_artists(raw: &str) -> Vec<String> {
    let normalized = raw
        .replace(" feat. ", " & ")
        .replace(" Feat. ", " & ")
        .replace(" ft. ", " & ")
        .replace(" × ", " & ");
    normalized
        .split(['/', '&', '、', ','])
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn has_unbalanced_brackets(s: &str) -> bool {
    let mut b1 = 0i32;
    let mut b2 = 0i32;
    let mut b3 = 0i32;
    for ch in s.chars() {
        match ch {
            '【' => b1 += 1,
            '】' => b1 -= 1,
            '(' => b2 += 1,
            ')' => b2 -= 1,
            '[' => b3 += 1,
            ']' => b3 -= 1,
            _ => {}
        }
    }
    b1 != 0 || b2 != 0 || b3 != 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_classic_bili_music_titles() {
        let parser = TitleParser::from_default_with_extras(vec![], vec![]);

        let p_noise = parser.parse(
            "【4K修复】周杰伦 - 晴天 【官方完整MV】【无损音质】",
            &ParseContext {
                owner_name: "周杰伦".into(),
                ..Default::default()
            },
        );
        assert_eq!(p_noise.artist_display, "周杰伦");
        assert_eq!(p_noise.title, "晴天");
        assert_eq!(p_noise.rule_id, "dash-separated");
        assert!(p_noise.confidence >= 0.85);
        assert!(p_noise.tags.contains(&"4K修复".to_string()));

        let p_bracket = parser.parse("【YOASOBI】群青 (Live)", &ParseContext::default());
        assert_eq!(p_bracket.artist_display, "YOASOBI");
        assert_eq!(p_bracket.title, "群青");
        assert_eq!(p_bracket.version, "Live");
        assert_eq!(p_bracket.rule_id, "bracket-artist");

        let p_vocaloid = parser.parse("千本桜 / 初音ミク", &ParseContext::default());
        assert_eq!(p_vocaloid.title, "千本桜");
        assert_eq!(p_vocaloid.artist_display, "初音ミク");
        assert_eq!(p_vocaloid.rule_id, "vocaloid-slash");

        let p_cover = parser.parse(
            "【翻唱】《兰亭序》（Cover：周杰伦）",
            &ParseContext {
                owner_name: "星尘翻唱".into(),
                tname: "翻唱".into(),
                ..Default::default()
            },
        );
        assert_eq!(p_cover.title, "兰亭序");
        assert_eq!(p_cover.version, "Cover");
        assert_eq!(p_cover.rule_id, "book-title");
        assert!(p_cover.tags.iter().any(|t| t.contains("周杰伦")));

        let p_fallback = parser.parse(
            "随手记录一段夜晚很安静的旋律也许能做成伴奏",
            &ParseContext {
                owner_name: "某UP主".into(),
                ..Default::default()
            },
        );
        assert_eq!(p_fallback.rule_id, "fallback-uploader");
        assert!(p_fallback.confidence < 0.72);
    }

    #[test]
    fn prefers_informative_part_name_for_multipage() {
        let parser = TitleParser::from_default_with_extras(vec![], vec![]);
        let p = parser.parse(
            "【无损合集】华语经典精选50首",
            &ParseContext {
                owner_name: "合集搬运".into(),
                part_name: "02. 陈奕迅 - 富士山下 (Live)".into(),
                ..Default::default()
            },
        );
        assert_eq!(p.title, "富士山下");
        assert_eq!(p.version, "Live");
        assert!(p.artist_display.contains("陈奕迅"));

        let p_ost = parser.parse(
            "【影之刃零】特典音乐集·Hi-Res无损OST",
            &ParseContext {
                owner_name: "影之刃零".into(),
                part_name: "02 - 今昼如昨 2026 大笛吉他曲".into(),
                ..Default::default()
            },
        );
        assert_eq!(p_ost.title, "今昼如昨 2026 大笛吉他曲");
        assert_eq!(p_ost.rule_id, "multipage-part");

        let p_generic = parser.parse(
            "【周杰伦】晴天",
            &ParseContext {
                owner_name: "某UP主".into(),
                part_name: "P2".into(),
                ..Default::default()
            },
        );
        assert_eq!(p_generic.title, "晴天");
        assert_eq!(p_generic.artist_display, "周杰伦");
    }
}
