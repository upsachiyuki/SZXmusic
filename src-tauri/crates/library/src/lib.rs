use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use bili_api::{BiliClient, FavFolder, FavMediaItem, VideoDetail, VideoPage};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use title_parser::{
    is_generic_part_name, MainRule, ParseContext, ParsedTrack, TitleParser, UploaderRule,
};

fn format_multipage_title(
    parsed_title: &str,
    part_name: &str,
    raw_title: &str,
    page_no: u32,
    total_pages: usize,
) -> String {
    let p_trim = part_name.trim();
    if (total_pages > 1 || page_no > 1)
        && (p_trim.is_empty() || p_trim == raw_title.trim() || is_generic_part_name(p_trim))
    {
        let suffix = format!(" (P{page_no})");
        if parsed_title.ends_with(&suffix) {
            parsed_title.to_string()
        } else {
            format!("{parsed_title}{suffix}")
        }
    } else {
        parsed_title.to_string()
    }
}

const PENDING_THRESHOLD: f32 = 0.72;
const DEFAULT_CRATE_COVER: &str = "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTrack {
    pub id: String,
    pub bvid: String,
    pub cid: u64,
    pub page: u32,
    #[serde(default)]
    pub pages: Vec<VideoPage>,
    pub raw_title: String,
    pub title: String,
    pub artist: String,
    pub version: String,
    pub confidence: f32,
    pub rule_id: String,
    pub reason: String,
    pub tags: Vec<String>,
    pub duration_sec: u64,
    pub quality_label: String,
    pub cover_url: String,
    pub bpm: u32,
    pub musical_key: String,
    pub energy: u8,
    pub reason_tag: String,
    pub is_invalid: bool,
    pub is_new: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCrate {
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub kind: String,
    pub sort_key: String,
    pub covers: Vec<String>,
    pub tracks: Vec<LibraryTrack>,
    pub remote_media_id: u64,
    pub new_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingParseItem {
    pub id: String,
    pub raw_title: String,
    pub owner: String,
    pub owner_mid: u64,
    pub bvid: String,
    pub cover_url: String,
    pub guess_title: String,
    pub guess_artist: String,
    pub version: String,
    pub confidence: f32,
    pub rule_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    pub crates: Vec<LibraryCrate>,
    pub pending: Vec<PendingParseItem>,
    pub liked_ids: Vec<String>,
    pub last_sync_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgressEvent {
    pub stage: String,
    pub current: u32,
    pub total: u32,
    pub folder_title: String,
    pub added_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub crates_count: usize,
    pub tracks_count: usize,
    pub new_tracks_count: u32,
    pub folder_summaries: Vec<String>,
    pub snapshot: LibrarySnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomRuleDto {
    pub id: String,
    pub uploader_mid: u64,
    pub pattern: String,
    pub priority: i32,
    pub description: String,
}

pub struct LibraryStore {
    conn: Mutex<Connection>,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn infer_sort_key(title: &str) -> String {
    for ch in title.trim().chars() {
        if ch.is_ascii_alphabetic() {
            return ch.to_ascii_uppercase().to_string();
        }
        if !ch.is_whitespace() {
            let code = ch as u32;
            // Rough CJK initial letter bucket so A-Z spine stays functional
            if (0x4E00..=0x9FFF).contains(&code) {
                let buckets = "ABCDEFGHJKLMNOPQRSTWXYZ";
                let idx = ((code - 0x4E00) as usize) % buckets.len();
                return buckets[idx..idx + 1].to_string();
            }
            return "M".to_string();
        }
    }
    "M".to_string()
}

impl LibraryStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, String> {
        if let Some(parent) = path.as_ref().parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS crates (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                subtitle TEXT NOT NULL DEFAULT '',
                kind TEXT NOT NULL DEFAULT 'favorite',
                cover TEXT NOT NULL DEFAULT '',
                remote_media_id INTEGER NOT NULL DEFAULT 0,
                remote_count INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                last_sync_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS tracks (
                id TEXT PRIMARY KEY,
                bvid TEXT NOT NULL,
                aid INTEGER NOT NULL DEFAULT 0,
                cid INTEGER NOT NULL DEFAULT 0,
                page INTEGER NOT NULL DEFAULT 1,
                raw_title TEXT NOT NULL,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                version TEXT NOT NULL DEFAULT 'Original',
                tags_json TEXT NOT NULL DEFAULT '[]',
                confidence REAL NOT NULL DEFAULT 0.5,
                rule_id TEXT NOT NULL DEFAULT '',
                reason TEXT NOT NULL DEFAULT '',
                manual INTEGER NOT NULL DEFAULT 0,
                duration_sec INTEGER NOT NULL DEFAULT 0,
                quality_label TEXT NOT NULL DEFAULT 'DASH AAC',
                cover_url TEXT NOT NULL DEFAULT '',
                owner_mid INTEGER NOT NULL DEFAULT 0,
                owner_name TEXT NOT NULL DEFAULT '',
                tname TEXT NOT NULL DEFAULT '',
                is_invalid INTEGER NOT NULL DEFAULT 0,
                fav_time INTEGER NOT NULL DEFAULT 0,
                is_new INTEGER NOT NULL DEFAULT 0,
                liked INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS crate_tracks (
                crate_id TEXT NOT NULL,
                track_id TEXT NOT NULL,
                pos INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (crate_id, track_id)
            );
            CREATE TABLE IF NOT EXISTS custom_rules (
                id TEXT PRIMARY KEY,
                uploader_mid INTEGER NOT NULL DEFAULT 0,
                pattern TEXT NOT NULL,
                priority INTEGER NOT NULL DEFAULT 95,
                description TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS app_kv (
                k TEXT PRIMARY KEY,
                v TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tracks_bvid ON tracks(bvid);
            "#,
        )
        .map_err(|e| e.to_string())?;
        // Safe schema migrations for existing library.db files
        let _ = conn.execute(
            "ALTER TABLE crates ADD COLUMN custom_title INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE crates ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE tracks ADD COLUMN pages_json TEXT NOT NULL DEFAULT '[]'",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE tracks ADD COLUMN dismissed INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = conn.execute(
            "UPDATE custom_rules SET id = 'custom-rule-' || rowid WHERE id IS NULL OR id = ''",
            [],
        );
        // Deduplicate pages_json on page > 1 rows and keep SQLite memory cache lean (~2 MB)
        let _ = conn.execute(
            "UPDATE tracks SET pages_json = '[]' WHERE page > 1 AND pages_json != '[]'",
            [],
        );
        let _ = conn.execute_batch(
            "PRAGMA cache_size = -2000; PRAGMA temp_store = MEMORY; PRAGMA synchronous = NORMAL;",
        );
        let store = Self {
            conn: Mutex::new(conn),
        };
        store.repair_multipage_titles_once();
        Ok(store)
    }

    fn repair_multipage_titles_once(&self) {
        if self.get_setting("multipage_repair_v2").as_deref() == Some("1") {
            return;
        }
        if let Ok(conn) = self.conn.lock() {
            // Reset erroneous `manual = 1` previously stamped by auto rule re-application
            let _ = conn.execute(
                "UPDATE tracks SET manual = 0 WHERE manual = 1 AND rule_id != 'manual'",
                [],
            );
        }
        self.reapply_rules_to_tracks();
        let _ = self.set_setting("multipage_repair_v2", "1");
    }

    fn build_parser(&self) -> Result<TitleParser, String> {
        let rules = self.list_custom_rules()?;
        let mut main_extras = Vec::new();
        let mut up_extras = Vec::new();
        for r in rules {
            if r.uploader_mid > 0 {
                up_extras.push(UploaderRule {
                    id: r.id,
                    mid: r.uploader_mid,
                    pattern: r.pattern,
                    description: Some(r.description),
                });
            } else {
                main_extras.push(MainRule {
                    id: r.id,
                    priority: r.priority,
                    pattern: r.pattern,
                    artist_from: None,
                });
            }
        }
        Ok(TitleParser::from_default_with_extras(main_extras, up_extras))
    }

    pub fn parse_preview(
        &self,
        raw_title: &str,
        owner_name: &str,
        owner_mid: u64,
        tname: &str,
        part_name: &str,
        custom_pattern: Option<&str>,
    ) -> Result<ParsedTrack, String> {
        let rules = self.list_custom_rules()?;
        let mut main_extras = Vec::new();
        let mut up_extras = Vec::new();

        if let Some(pat) = custom_pattern.map(str::trim).filter(|s| !s.is_empty()) {
            TitleParser::validate_pattern(pat)?;
            if owner_mid > 0 {
                up_extras.push(UploaderRule {
                    id: "live-test-pattern".to_string(),
                    mid: owner_mid,
                    pattern: pat.to_string(),
                    description: Some("当前调试正则".to_string()),
                });
            } else {
                main_extras.push(MainRule {
                    id: "live-test-pattern".to_string(),
                    priority: 999,
                    pattern: pat.to_string(),
                    artist_from: None,
                });
            }
        }

        for r in rules {
            if r.uploader_mid > 0 {
                up_extras.push(UploaderRule {
                    id: r.id,
                    mid: r.uploader_mid,
                    pattern: r.pattern,
                    description: Some(r.description),
                });
            } else {
                main_extras.push(MainRule {
                    id: r.id,
                    priority: r.priority,
                    pattern: r.pattern,
                    artist_from: None,
                });
            }
        }

        let parser = TitleParser::from_default_with_extras(main_extras, up_extras);
        Ok(parser.parse(
            raw_title,
            &ParseContext {
                owner_name: owner_name.to_string(),
                owner_mid,
                tname: tname.to_string(),
                part_name: part_name.to_string(),
                desc: String::new(),
            },
        ))
    }

    fn reapply_rules_to_tracks(&self) {
        let Ok(parser) = self.build_parser() else {
            return;
        };
        let Ok(conn) = self.conn.lock() else {
            return;
        };

        // Load shared per-BVID page lists from page 1 / non-empty pages_json rows
        let mut pages_by_bvid: HashMap<String, Vec<VideoPage>> = HashMap::new();
        if let Ok(mut stmt) = conn.prepare(
            "SELECT bvid, pages_json FROM tracks WHERE pages_json != '[]' ORDER BY page ASC",
        ) {
            if let Ok(iter) = stmt.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            }) {
                for (bvid, pj) in iter.filter_map(Result::ok) {
                    if !pages_by_bvid.contains_key(&bvid) {
                        if let Ok(vec) = serde_json::from_str::<Vec<VideoPage>>(&pj) {
                            if !vec.is_empty() {
                                pages_by_bvid.insert(bvid, vec);
                            }
                        }
                    }
                }
            }
        }

        let mut counts_by_bvid: HashMap<String, usize> = HashMap::new();
        let rows: Vec<(String, String, String, String, u64, String, u32, String)> = conn
            .prepare(
                "SELECT id, bvid, raw_title, owner_name, owner_mid, tname, page, rule_id FROM tracks WHERE dismissed = 0",
            )
            .and_then(|mut s| {
                let iter = s.query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, i64>(4)? as u64,
                        r.get::<_, String>(5)?,
                        r.get::<_, i64>(6)? as u32,
                        r.get::<_, String>(7)?,
                    ))
                })?;
                Ok(iter.filter_map(Result::ok).collect())
            })
            .unwrap_or_default();

        for (_, bvid, ..) in &rows {
            *counts_by_bvid.entry(bvid.clone()).or_insert(0) += 1;
        }

        for (tid, bvid, raw_title, owner_name, owner_mid, tname, page, existing_rule_id) in rows {
            if existing_rule_id == "manual" {
                continue;
            }
            let pages_opt = pages_by_bvid.get(&bvid);
            let total_pages = pages_opt
                .map(|v| v.len())
                .unwrap_or(0)
                .max(*counts_by_bvid.get(&bvid).unwrap_or(&1));
            let part_name = pages_opt
                .and_then(|pages| pages.iter().find(|p| p.page == page))
                .map(|p| p.part.clone())
                .unwrap_or_default();
            let parsed = parser.parse(
                &raw_title,
                &ParseContext {
                    owner_name,
                    owner_mid,
                    tname,
                    part_name: part_name.clone(),
                    desc: String::new(),
                },
            );
            let final_title =
                format_multipage_title(&parsed.title, &part_name, &raw_title, page, total_pages);
            let should_update =
                parsed.rule_id != "fallback-uploader" && parsed.confidence >= PENDING_THRESHOLD
                    || total_pages > 1;
            if should_update {
                let _ = conn.execute(
                    "UPDATE tracks SET title = ?1, artist = ?2, version = ?3, confidence = ?4, rule_id = ?5, reason = ?6 WHERE id = ?7 AND manual = 0",
                    params![
                        final_title,
                        parsed.artist_display,
                        parsed.version,
                        parsed.confidence.max(if parsed.rule_id != "fallback-uploader" { 0.86 } else { parsed.confidence }),
                        parsed.rule_id,
                        parsed.reason,
                        tid
                    ],
                );
            }
        }
    }

    pub fn get_setting(&self, key: &str) -> Option<String> {
        let conn = self.conn.lock().ok()?;
        conn.query_row("SELECT v FROM app_kv WHERE k = ?1", params![key], |row| {
            row.get::<_, String>(0)
        })
        .ok()
    }

    pub fn set_setting(&self, key: &str, val: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO app_kv (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
            params![key, val],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_custom_rules(&self) -> Result<Vec<CustomRuleDto>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT COALESCE(id, 'custom-rule-' || rowid), uploader_mid, pattern, priority, description FROM custom_rules ORDER BY priority DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(CustomRuleDto {
                    id: row.get(0)?,
                    uploader_mid: row.get::<_, i64>(1)? as u64,
                    pattern: row.get(2)?,
                    priority: row.get(3)?,
                    description: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn add_custom_rule(
        &self,
        uploader_mid: u64,
        pattern: &str,
        priority: i32,
        description: &str,
    ) -> Result<Vec<CustomRuleDto>, String> {
        let clean_pat = pattern.trim();
        TitleParser::validate_pattern(clean_pat)?;
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let id = format!("custom-{now_ms}");
        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            let updated = conn
                .execute(
                    "UPDATE custom_rules SET priority = ?1, description = ?2, id = COALESCE(id, ?3) WHERE uploader_mid = ?4 AND pattern = ?5",
                    params![priority, description.trim(), id, uploader_mid as i64, clean_pat],
                )
                .unwrap_or(0);
            if updated == 0 {
                conn.execute(
                    "INSERT OR REPLACE INTO custom_rules (id, uploader_mid, pattern, priority, description) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![id, uploader_mid as i64, clean_pat, priority, description.trim()],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        self.reapply_rules_to_tracks();
        self.list_custom_rules()
    }

    pub fn delete_custom_rule(&self, id: &str) -> Result<Vec<CustomRuleDto>, String> {
        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                "DELETE FROM custom_rules WHERE id = ?1 OR ('custom-rule-' || rowid) = ?1",
                params![id],
            )
            .map_err(|e| e.to_string())?;
        }
        self.reapply_rules_to_tracks();
        self.list_custom_rules()
    }

    pub fn toggle_like(&self, track_id: &str) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE tracks SET liked = CASE WHEN liked = 0 THEN 1 ELSE 0 END WHERE id = ?1",
            params![track_id],
        )
        .map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id FROM tracks WHERE liked = 1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn confirm_pending(
        &self,
        track_id: &str,
        title: &str,
        artist: &str,
        version: &str,
    ) -> Result<LibrarySnapshot, String> {
        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE tracks SET title = ?1, artist = ?2, version = ?3, confidence = 1.0, manual = 1, dismissed = 0, rule_id = 'manual', is_new = 0 WHERE id = ?4",
                params![title.trim(), artist.trim(), version.trim(), track_id],
            )
            .map_err(|e| e.to_string())?;
        }
        self.load_snapshot()
    }

    pub fn dismiss_pending(&self, track_id: &str) -> Result<LibrarySnapshot, String> {
        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                "DELETE FROM crate_tracks WHERE track_id = ?1",
                params![track_id],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE tracks SET dismissed = 1, manual = 1 WHERE id = ?1",
                params![track_id],
            )
            .map_err(|e| e.to_string())?;
        }
        self.load_snapshot()
    }

    pub fn dismiss_all_pending(&self) -> Result<LibrarySnapshot, String> {
        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                r#"
                DELETE FROM crate_tracks
                WHERE track_id IN (
                    SELECT id FROM tracks
                    WHERE manual = 0 AND dismissed = 0 AND is_invalid = 0 AND confidence < ?1
                )
                "#,
                params![PENDING_THRESHOLD],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE tracks SET dismissed = 1, manual = 1 WHERE manual = 0 AND dismissed = 0 AND is_invalid = 0 AND confidence < ?1",
                params![PENDING_THRESHOLD],
            )
            .map_err(|e| e.to_string())?;
        }
        self.load_snapshot()
    }

    pub fn confirm_all_pending(&self) -> Result<LibrarySnapshot, String> {
        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE tracks SET confidence = 1.0, manual = 1, rule_id = 'manual', is_new = 0 WHERE manual = 0 AND dismissed = 0 AND is_invalid = 0 AND confidence < ?1",
                params![PENDING_THRESHOLD],
            )
            .map_err(|e| e.to_string())?;
        }
        self.load_snapshot()
    }

    pub fn create_crate(&self, title: &str, subtitle: &str) -> Result<LibrarySnapshot, String> {
        let clean_title = title.trim();
        if clean_title.is_empty() {
            return Err("黑胶名称不能为空".into());
        }
        let clean_sub = if subtitle.trim().is_empty() {
            "自定义黑胶"
        } else {
            subtitle.trim()
        };
        let now = now_secs();
        let crate_id = format!("custom-{now}");
        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO crates (id, title, subtitle, kind, cover, remote_media_id, remote_count, sort_order, last_sync_at, custom_title, is_deleted)
                 VALUES (?1, ?2, ?3, 'custom', ?4, 0, 0, 0, ?5, 1, 0)",
                params![crate_id, clean_title, clean_sub, DEFAULT_CRATE_COVER, now as i64],
            )
            .map_err(|e| e.to_string())?;
        }
        self.load_snapshot()
    }

    pub fn rename_crate(
        &self,
        crate_id: &str,
        title: &str,
        subtitle: Option<&str>,
    ) -> Result<LibrarySnapshot, String> {
        let clean_title = title.trim();
        if clean_title.is_empty() {
            return Err("黑胶名称不能为空".into());
        }
        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            if let Some(sub) = subtitle.map(str::trim).filter(|s| !s.is_empty()) {
                conn.execute(
                    "UPDATE crates SET title = ?1, subtitle = ?2, custom_title = 1, is_deleted = 0 WHERE id = ?3",
                    params![clean_title, sub, crate_id],
                )
                .map_err(|e| e.to_string())?;
            } else {
                conn.execute(
                    "UPDATE crates SET title = ?1, custom_title = 1, is_deleted = 0 WHERE id = ?2",
                    params![clean_title, crate_id],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        self.load_snapshot()
    }

    pub fn delete_crate(&self, crate_id: &str) -> Result<LibrarySnapshot, String> {
        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                "DELETE FROM crate_tracks WHERE crate_id = ?1",
                params![crate_id],
            )
            .map_err(|e| e.to_string())?;
            // Mark as deleted so synced remote folders stay deleted unless force-resynced
            let updated = conn
                .execute(
                    "UPDATE crates SET is_deleted = 1 WHERE id = ?1",
                    params![crate_id],
                )
                .map_err(|e| e.to_string())?;
            if updated == 0 {
                conn.execute("DELETE FROM crates WHERE id = ?1", params![crate_id])
                    .map_err(|e| e.to_string())?;
            }
        }
        self.load_snapshot()
    }

    pub fn add_track_to_crate(
        &self,
        crate_id: &str,
        track: &LibraryTrack,
    ) -> Result<LibrarySnapshot, String> {
        let now = now_secs();
        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            let max_pos: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(pos), 0) FROM crate_tracks WHERE crate_id = ?1",
                    params![crate_id],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            // If user pasted a BV ID with cid == 0 and that BV already has expanded pages in `tracks`,
            // add all existing pages of that BV in order instead of creating a dummy single-track row!
            if track.cid == 0 && track.bvid.starts_with("BV") {
                let existing_ids: Vec<(String, String)> = conn
                    .prepare(
                        "SELECT id, cover_url FROM tracks WHERE bvid = ?1 AND dismissed = 0 AND id NOT LIKE 'custom-trk-%' ORDER BY page ASC",
                    )
                    .and_then(|mut s| {
                        let rows = s.query_map(params![track.bvid], |r| {
                            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                        })?;
                        Ok(rows.filter_map(Result::ok).collect())
                    })
                    .unwrap_or_default();

                if !existing_ids.is_empty() {
                    for (idx, (tid, cov)) in existing_ids.iter().enumerate() {
                        conn.execute(
                            "INSERT OR REPLACE INTO crate_tracks (crate_id, track_id, pos) VALUES (?1, ?2, ?3)",
                            params![crate_id, tid, max_pos + ((idx as i64) + 1) * 10],
                        )
                        .map_err(|e| e.to_string())?;
                        if idx == 0 && !cov.is_empty() {
                            let _ = conn.execute(
                                "UPDATE crates SET cover = ?1 WHERE id = ?2 AND (cover = '' OR cover = ?3)",
                                params![cov, crate_id, DEFAULT_CRATE_COVER],
                            );
                        }
                    }
                    drop(conn);
                    return self.load_snapshot();
                }
            }

            let tags_json = serde_json::to_string(&track.tags).unwrap_or_else(|_| "[]".into());
            let pages_json = serde_json::to_string(&track.pages).unwrap_or_else(|_| "[]".into());
            conn.execute(
                r#"
                INSERT INTO tracks (
                    id, bvid, aid, cid, page, raw_title, title, artist, version, tags_json,
                    confidence, rule_id, reason, manual, duration_sec, quality_label,
                    cover_url, owner_mid, owner_name, tname, is_invalid, fav_time, is_new, created_at, pages_json
                )
                VALUES (?1, ?2, 0, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 1, ?13, ?14, ?15, 0, ?7, '', ?16, ?17, 0, ?17, ?18)
                ON CONFLICT(id) DO UPDATE SET
                    cid = CASE WHEN excluded.cid > 0 THEN excluded.cid ELSE tracks.cid END,
                    cover_url = CASE WHEN excluded.cover_url != '' THEN excluded.cover_url ELSE tracks.cover_url END
                "#,
                params![
                    track.id,
                    track.bvid,
                    track.cid as i64,
                    track.page.max(1) as i64,
                    track.raw_title,
                    track.title,
                    track.artist,
                    track.version,
                    tags_json,
                    track.confidence.max(0.95),
                    track.rule_id,
                    track.reason,
                    track.duration_sec as i64,
                    track.quality_label,
                    track.cover_url,
                    if track.is_invalid { 1 } else { 0 },
                    now as i64,
                    pages_json,
                ],
            )
            .map_err(|e| e.to_string())?;

            conn.execute(
                "INSERT OR REPLACE INTO crate_tracks (crate_id, track_id, pos) VALUES (?1, ?2, ?3)",
                params![crate_id, track.id, max_pos + 10],
            )
            .map_err(|e| e.to_string())?;
        }
        self.load_snapshot()
    }

    pub fn transfer_tracks(
        &self,
        from_crate_id: &str,
        to_crate_id: &str,
        bvid_filter: Option<&str>,
        move_tracks: bool,
    ) -> Result<LibrarySnapshot, String> {
        if from_crate_id.trim().is_empty() || to_crate_id.trim().is_empty() {
            return Err("源黑胶或目标黑胶不能为空".into());
        }
        {
            let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
            let tx = conn.transaction().map_err(|e| e.to_string())?;

            let bvid_clean = bvid_filter.map(str::trim).filter(|s| !s.is_empty());
            let track_rows: Vec<(String, String)> = if let Some(bvid) = bvid_clean {
                let mut stmt = tx
                    .prepare(
                        r#"
                        SELECT t.id, t.cover_url
                        FROM tracks t
                        INNER JOIN crate_tracks ct ON t.id = ct.track_id
                        WHERE ct.crate_id = ?1 AND t.bvid = ?2
                        ORDER BY ct.pos ASC, t.page ASC
                        "#,
                    )
                    .map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map(params![from_crate_id, bvid], |r| {
                        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                    })
                    .map_err(|e| e.to_string())?;
                rows.filter_map(Result::ok).collect()
            } else {
                let mut stmt = tx
                    .prepare(
                        r#"
                        SELECT t.id, t.cover_url
                        FROM tracks t
                        INNER JOIN crate_tracks ct ON t.id = ct.track_id
                        WHERE ct.crate_id = ?1
                        ORDER BY ct.pos ASC, t.page ASC
                        "#,
                    )
                    .map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map(params![from_crate_id], |r| {
                        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                    })
                    .map_err(|e| e.to_string())?;
                rows.filter_map(Result::ok).collect()
            };

            let max_pos: i64 = tx
                .query_row(
                    "SELECT COALESCE(MAX(pos), 0) FROM crate_tracks WHERE crate_id = ?1",
                    params![to_crate_id],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            for (idx, (tid, cov)) in track_rows.iter().enumerate() {
                tx.execute(
                    "INSERT OR REPLACE INTO crate_tracks (crate_id, track_id, pos) VALUES (?1, ?2, ?3)",
                    params![to_crate_id, tid, max_pos + ((idx as i64) + 1) * 10],
                )
                .map_err(|e| e.to_string())?;

                if idx == 0 && !cov.is_empty() {
                    let _ = tx.execute(
                        "UPDATE crates SET cover = ?1 WHERE id = ?2 AND (cover = '' OR cover = ?3)",
                        params![cov, to_crate_id, DEFAULT_CRATE_COVER],
                    );
                }

                if move_tracks && from_crate_id != to_crate_id {
                    tx.execute(
                        "DELETE FROM crate_tracks WHERE crate_id = ?1 AND track_id = ?2",
                        params![from_crate_id, tid],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }

            tx.commit().map_err(|e| e.to_string())?;
        }
        self.load_snapshot()
    }

    pub fn create_crate_and_transfer(
        &self,
        title: &str,
        subtitle: &str,
        from_crate_id: &str,
        bvid_filter: Option<&str>,
        move_tracks: bool,
    ) -> Result<(String, LibrarySnapshot), String> {
        let clean_title = title.trim();
        if clean_title.is_empty() {
            return Err("黑胶名称不能为空".into());
        }
        let clean_sub = if subtitle.trim().is_empty() {
            "自定义黑胶"
        } else {
            subtitle.trim()
        };
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let new_crate_id = format!("custom-{now_ms}");
        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO crates (id, title, subtitle, kind, cover, remote_media_id, remote_count, sort_order, last_sync_at, custom_title, is_deleted)
                 VALUES (?1, ?2, ?3, 'custom', ?4, 0, 0, 0, ?5, 1, 0)",
                params![new_crate_id, clean_title, clean_sub, DEFAULT_CRATE_COVER, now_secs() as i64],
            )
            .map_err(|e| e.to_string())?;
        }
        let snap = self.transfer_tracks(from_crate_id, &new_crate_id, bvid_filter, move_tracks)?;
        Ok((new_crate_id, snap))
    }

    pub fn remove_track_from_crate(
        &self,
        crate_id: &str,
        track_id: &str,
    ) -> Result<LibrarySnapshot, String> {
        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                "DELETE FROM crate_tracks WHERE crate_id = ?1 AND track_id = ?2",
                params![crate_id, track_id],
            )
            .map_err(|e| e.to_string())?;
        }
        self.load_snapshot()
    }

    pub fn upsert_related_crate(
        &self,
        crate_id: &str,
        crate_title: &str,
        tracks: &[ParsedSeedMedia],
    ) -> Result<LibrarySnapshot, String> {
        let parser = self.build_parser()?;
        let now = now_secs();
        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO crates (id, title, subtitle, kind, cover, remote_media_id, remote_count, sort_order, last_sync_at)
                 VALUES (?1, ?2, ?3, 'similar', ?4, 0, ?5, 2, ?6)
                 ON CONFLICT(id) DO UPDATE SET title = excluded.title, subtitle = excluded.subtitle, cover = excluded.cover, remote_count = excluded.remote_count, last_sync_at = excluded.last_sync_at",
                params![
                    crate_id,
                    crate_title,
                    format!("相似推荐 · {} 首", tracks.len()),
                    tracks.first().map(|t| t.cover_url.as_str()).unwrap_or(""),
                    tracks.len() as i64,
                    now as i64
                ],
            )
            .map_err(|e| e.to_string())?;

            conn.execute("DELETE FROM crate_tracks WHERE crate_id = ?1", params![crate_id])
                .map_err(|e| e.to_string())?;

            for (pos, item) in tracks.iter().enumerate() {
                let parsed = parser.parse(
                    &item.raw_title,
                    &ParseContext {
                        owner_name: item.owner_name.clone(),
                        owner_mid: item.owner_mid,
                        tname: item.tname.clone(),
                        part_name: String::new(),
                        desc: String::new(),
                    },
                );
                let tid = format!("bili-{}-p1", item.bvid);
                let tags_json = serde_json::to_string(&parsed.tags).unwrap_or_else(|_| "[]".into());
                conn.execute(
                    "INSERT INTO tracks (id, bvid, aid, cid, page, raw_title, title, artist, version, tags_json, confidence, rule_id, reason, manual, duration_sec, quality_label, cover_url, owner_mid, owner_name, tname, is_invalid, fav_time, is_new, created_at)
                     VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, ?13, 'DASH 音频', ?14, ?15, ?16, ?17, 0, ?18, 0, ?18)
                     ON CONFLICT(id) DO UPDATE SET cid = CASE WHEN excluded.cid > 0 THEN excluded.cid ELSE tracks.cid END, cover_url = CASE WHEN excluded.cover_url != '' THEN excluded.cover_url ELSE tracks.cover_url END",
                    params![
                        tid,
                        item.bvid,
                        item.aid as i64,
                        item.cid as i64,
                        item.raw_title,
                        parsed.title,
                        parsed.artist_display,
                        parsed.version,
                        tags_json,
                        parsed.confidence.max(0.84),
                        parsed.rule_id,
                        parsed.reason,
                        item.duration_sec as i64,
                        item.cover_url,
                        item.owner_mid as i64,
                        item.owner_name,
                        item.tname,
                        now as i64
                    ],
                )
                .map_err(|e| e.to_string())?;
                conn.execute(
                    "INSERT OR REPLACE INTO crate_tracks (crate_id, track_id, pos) VALUES (?1, ?2, ?3)",
                    params![crate_id, tid, pos as i64],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        self.load_snapshot()
    }

    pub fn upsert_online_track(
        &self,
        detail: &VideoDetail,
        cid: u64,
        part_name: &str,
        page_no: u32,
    ) -> Result<(LibraryTrack, LibrarySnapshot), String> {
        let parser = self.build_parser()?;
        let target_tid = format!("bili-{}-p{}", detail.bvid, page_no.max(1));
        let crate_id = "crate-online-picks";
        let now = now_secs();
        let pages_json = serde_json::to_string(&detail.pages).unwrap_or_else(|_| "[]".into());
        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO crates (id, title, subtitle, kind, cover, remote_media_id, remote_count, sort_order, last_sync_at, is_deleted)
                 VALUES (?1, '在线点播 · B站音源', '直接点播或搜索收录', 'smart', ?2, 0, 0, 1, ?3, 0)
                 ON CONFLICT(id) DO UPDATE SET cover = CASE WHEN excluded.cover != '' THEN excluded.cover ELSE crates.cover END, last_sync_at = excluded.last_sync_at, is_deleted = 0",
                params![crate_id, detail.pic, now as i64],
            )
            .map_err(|e| e.to_string())?;

            let max_pos: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(pos), 0) FROM crate_tracks WHERE crate_id = ?1",
                    params![crate_id],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            if detail.pages.len() > 1 {
                // Expand all pages of multi-P / anthology video in strict sequential order P1..Pn
                for p in &detail.pages {
                    let p_no = p.page.max(1);
                    let tid = format!("bili-{}-p{}", detail.bvid, p_no);
                    let parsed = parser.parse(
                        &detail.title,
                        &ParseContext {
                            owner_name: detail.owner_name.clone(),
                            owner_mid: detail.owner_mid,
                            tname: detail.tname.clone(),
                            part_name: p.part.clone(),
                            desc: detail.desc.clone(),
                        },
                    );
                    let display_title = format_multipage_title(
                        &parsed.title,
                        &p.part,
                        &detail.title,
                        p_no,
                        detail.pages.len(),
                    );
                    let page_cover = p
                        .first_frame
                        .as_deref()
                        .filter(|s| !s.is_empty())
                        .unwrap_or(&detail.pic);
                    let tags_json = serde_json::to_string(&parsed.tags).unwrap_or_else(|_| "[]".into());
                    let dur = if p.duration > 0 { p.duration } else { detail.duration_sec };
                    conn.execute(
                        "INSERT INTO tracks (id, bvid, aid, cid, page, raw_title, title, artist, version, tags_json, confidence, rule_id, reason, manual, duration_sec, quality_label, cover_url, owner_mid, owner_name, tname, is_invalid, fav_time, is_new, created_at, pages_json)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 0, ?14, 'DASH 音频', ?15, ?16, ?17, ?18, 0, ?19, 1, ?19, ?20)
                         ON CONFLICT(id) DO UPDATE SET cid = excluded.cid, duration_sec = excluded.duration_sec, cover_url = excluded.cover_url, pages_json = excluded.pages_json, title = CASE WHEN tracks.manual = 0 THEN excluded.title ELSE tracks.title END, artist = CASE WHEN tracks.manual = 0 THEN excluded.artist ELSE tracks.artist END",
                        params![
                            tid,
                            detail.bvid,
                            detail.aid as i64,
                            p.cid as i64,
                            p_no as i64,
                            detail.title,
                            display_title,
                            parsed.artist_display,
                            parsed.version,
                            tags_json,
                            parsed.confidence,
                            parsed.rule_id,
                            parsed.reason,
                            dur as i64,
                            page_cover,
                            detail.owner_mid as i64,
                            detail.owner_name,
                            detail.tname,
                            now as i64,
                            if p_no == 1 { pages_json.as_str() } else { "[]" }
                        ],
                    )
                    .map_err(|e| e.to_string())?;

                    conn.execute(
                        "INSERT OR IGNORE INTO crate_tracks (crate_id, track_id, pos) VALUES (?1, ?2, ?3)",
                        params![crate_id, tid, max_pos + (p_no as i64) * 10],
                    )
                    .map_err(|e| e.to_string())?;
                }
            } else {
                let parsed = parser.parse(
                    &detail.title,
                    &ParseContext {
                        owner_name: detail.owner_name.clone(),
                        owner_mid: detail.owner_mid,
                        tname: detail.tname.clone(),
                        part_name: part_name.to_string(),
                        desc: detail.desc.clone(),
                    },
                );
                let tags_json = serde_json::to_string(&parsed.tags).unwrap_or_else(|_| "[]".into());
                let dur = detail
                    .pages
                    .iter()
                    .find(|p| p.cid == cid)
                    .map(|p| p.duration)
                    .filter(|&d| d > 0)
                    .unwrap_or(detail.duration_sec);

                conn.execute(
                    "INSERT INTO tracks (id, bvid, aid, cid, page, raw_title, title, artist, version, tags_json, confidence, rule_id, reason, manual, duration_sec, quality_label, cover_url, owner_mid, owner_name, tname, is_invalid, fav_time, is_new, created_at, pages_json)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 0, ?14, 'DASH 音频', ?15, ?16, ?17, ?18, 0, ?19, 1, ?19, ?20)
                     ON CONFLICT(id) DO UPDATE SET cid = excluded.cid, duration_sec = excluded.duration_sec, cover_url = excluded.cover_url, pages_json = excluded.pages_json",
                    params![
                        target_tid,
                        detail.bvid,
                        detail.aid as i64,
                        cid as i64,
                        page_no.max(1) as i64,
                        detail.title,
                        parsed.title,
                        parsed.artist_display,
                        parsed.version,
                        tags_json,
                        parsed.confidence,
                        parsed.rule_id,
                        parsed.reason,
                        dur as i64,
                        detail.pic,
                        detail.owner_mid as i64,
                        detail.owner_name,
                        detail.tname,
                        now as i64,
                        pages_json
                    ],
                )
                .map_err(|e| e.to_string())?;

                conn.execute(
                    "INSERT OR IGNORE INTO crate_tracks (crate_id, track_id, pos) VALUES (?1, ?2, ?3)",
                    params![crate_id, target_tid, max_pos + 10],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        let snap = self.load_snapshot()?;
        let track = snap
            .crates
            .iter()
            .flat_map(|c| c.tracks.iter())
            .find(|t| t.id == target_tid)
            .cloned()
            .ok_or_else(|| "插入曲目读取失败".to_string())?;
        Ok((track, snap))
    }

    pub async fn sync_favorites<F>(
        &self,
        client: &mut BiliClient,
        mid: u64,
        force_full: bool,
        mut on_progress: F,
    ) -> Result<SyncResult, String>
    where
        F: FnMut(SyncProgressEvent),
    {
        let mut folders = client.list_created_favorites(mid).await.map_err(|e| e.to_string())?;
        if let Ok(collected) = client.list_collected_folders(mid).await {
            for f in collected {
                if !folders.iter().any(|existing| existing.media_id == f.media_id && existing.is_season == f.is_season) {
                    folders.push(f);
                }
            }
        }

        let total_folders = folders.len() as u32;
        let parser = self.build_parser()?;
        let mut total_new = 0u32;
        let mut folder_summaries = Vec::new();
        let now = now_secs();

        for (idx, folder) in folders.iter().enumerate() {
            on_progress(SyncProgressEvent {
                stage: "syncing".into(),
                current: (idx + 1) as u32,
                total: total_folders.max(1),
                folder_title: folder.title.clone(),
                added_count: total_new,
            });

            let crate_id = if folder.is_season {
                format!("season-{}", folder.media_id)
            } else {
                format!("fav-{}", folder.media_id)
            };

            // If user deleted this crate locally and this is not a forced full reset, skip it
            if !force_full && self.is_crate_deleted(&crate_id) {
                continue;
            }

            let (prev_count, existing_ids) = self.read_crate_state(&crate_id)?;
            let mut need_fetch = force_full || prev_count != folder.media_count;
            let mut removed_track_ids = HashSet::new();

            // Check /x/v3/fav/resource/ids diff when favorite folder to skip unchanged folders cheaply
            if !folder.is_season && !force_full && prev_count == folder.media_count && prev_count > 0 {
                if let Ok(remote_ids) = client.get_favorite_resource_ids(folder.media_id).await {
                    let remote_bvids: HashSet<String> =
                        remote_ids.iter().map(|r| r.bvid.clone()).collect();
                    let local_bvids = self.read_crate_bvids(&crate_id)?;
                    if remote_bvids != local_bvids {
                        need_fetch = true;
                        for (tid, bvid) in self.read_crate_track_bvids(&crate_id)? {
                            if !remote_bvids.contains(&bvid) {
                                removed_track_ids.insert(tid);
                            }
                        }
                    }
                }
            }

            if !need_fetch {
                continue;
            }

            let mut fetched_items: Vec<FavMediaItem> = Vec::new();
            let mut latest_folder_meta = folder.clone();
            if folder.is_season {
                let mut pn = 1;
                while pn <= 6 {
                    let (meta_f, page_items, has_more) = client
                        .get_season_archives(folder.mid, folder.media_id, pn, 30)
                        .await
                        .map_err(|e| e.to_string())?;
                    if pn == 1 && !meta_f.cover.is_empty() {
                        latest_folder_meta.cover = meta_f.cover;
                    }
                    fetched_items.extend(page_items);
                    if !has_more {
                        break;
                    }
                    pn += 1;
                }
            } else {
                let mut pn = 1;
                while pn <= 8 {
                    let page = client
                        .get_favorite_list_page(folder.media_id, pn, 20)
                        .await
                        .map_err(|e| e.to_string())?;
                    if pn == 1 && !page.folder.cover.is_empty() {
                        latest_folder_meta.cover = page.folder.cover;
                    }
                    let count = page.medias.len();
                    fetched_items.extend(page.medias);
                    if !page.has_more || count == 0 {
                        break;
                    }
                    pn += 1;
                }
            }

            let mut added_in_folder = 0u32;
            let crate_kind = if folder.is_season { "season" } else { "favorite" };
            let mut crate_track_order: Vec<(String, usize)> = Vec::new();

            for (pos, item) in fetched_items.iter().enumerate() {
                if item.bvid.is_empty() {
                    continue;
                }
                let is_invalid = item.attr != 0 || item.title == "已失效视频";

                // If multi-P (>1), expand pages when P2 isn't already expanded locally
                let p2_known = existing_ids.contains(&format!("bili-{}-p2", item.bvid));
                if item.page_count > 1 && item.page_count <= 200 && !is_invalid && (!p2_known || force_full) {
                    if let Ok(detail) = client.get_video_detail(&item.bvid).await {
                        let pages_json =
                            serde_json::to_string(&detail.pages).unwrap_or_else(|_| "[]".into());
                        for p in &detail.pages {
                            let p_no = p.page.max(1);
                            let tid = format!("bili-{}-p{}", item.bvid, p_no);
                            let is_new = !existing_ids.contains(&tid);
                            if is_new {
                                added_in_folder += 1;
                            }
                            let mut parsed = parser.parse(
                                &item.title,
                                &ParseContext {
                                    owner_name: detail.owner_name.clone(),
                                    owner_mid: detail.owner_mid,
                                    tname: detail.tname.clone(),
                                    part_name: p.part.clone(),
                                    desc: detail.desc.clone(),
                                },
                            );
                            parsed.title = format_multipage_title(
                                &parsed.title,
                                &p.part,
                                &item.title,
                                p_no,
                                detail.pages.len(),
                            );
                            let mut page_item = item.clone();
                            if let Some(ref ff) = p.first_frame {
                                if !ff.is_empty() {
                                    page_item.cover = ff.clone();
                                }
                            }
                            self.upsert_fav_track(
                                &tid,
                                &page_item,
                                p.cid,
                                p_no,
                                if p.duration > 0 { p.duration } else { item.duration },
                                &detail.tname,
                                &parsed,
                                is_invalid,
                                is_new,
                                now,
                                if p_no == 1 { &pages_json } else { "[]" },
                            )?;
                            crate_track_order.push((tid, pos * 1000 + p_no as usize));
                        }
                        continue;
                    }
                }

                let tid = format!("bili-{}-p1", item.bvid);
                let is_new = !existing_ids.contains(&tid);
                if is_new && !is_invalid {
                    added_in_folder += 1;
                }
                let parsed = parser.parse(
                    &item.title,
                    &ParseContext {
                        owner_name: item.owner_name.clone(),
                        owner_mid: item.owner_mid,
                        tname: String::new(),
                        part_name: String::new(),
                        desc: item.intro.clone(),
                    },
                );
                self.upsert_fav_track(
                    &tid,
                    item,
                    0,
                    1,
                    item.duration,
                    "",
                    &parsed,
                    is_invalid,
                    is_new,
                    now,
                    "[]",
                )?;
                crate_track_order.push((tid, pos * 1000));
            }

            // Persist crate and ordering without dropping locally grayed/unfavored tracks if invalid
            self.write_crate_sync(
                &crate_id,
                &latest_folder_meta,
                crate_kind,
                idx as i32 + 10,
                &crate_track_order,
                &removed_track_ids,
                now,
            )?;

            if added_in_folder > 0 {
                total_new += added_in_folder;
                folder_summaries.push(format!("+{} synced from「{}」", added_in_folder, folder.title));
            }
        }

        self.set_setting("last_sync_at", &now.to_string())?;
        let snapshot = self.load_snapshot()?;
        let tracks_count: usize = snapshot.crates.iter().map(|c| c.tracks.len()).sum();

        on_progress(SyncProgressEvent {
            stage: "done".into(),
            current: total_folders.max(1),
            total: total_folders.max(1),
            folder_title: "同步完成".into(),
            added_count: total_new,
        });

        Ok(SyncResult {
            crates_count: snapshot.crates.len(),
            tracks_count,
            new_tracks_count: total_new,
            folder_summaries,
            snapshot,
        })
    }

    fn is_crate_deleted(&self, crate_id: &str) -> bool {
        let Ok(conn) = self.conn.lock() else {
            return false;
        };
        conn.query_row(
            "SELECT is_deleted FROM crates WHERE id = ?1",
            params![crate_id],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0)
            != 0
    }

    fn read_crate_state(&self, crate_id: &str) -> Result<(u32, HashSet<String>), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let prev_count = conn
            .query_row(
                "SELECT remote_count FROM crates WHERE id = ?1",
                params![crate_id],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0) as u32;
        let mut stmt = conn
            .prepare(
                "SELECT track_id FROM crate_tracks WHERE crate_id = ?1 UNION SELECT id FROM tracks WHERE dismissed = 1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![crate_id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let ids: HashSet<String> = rows.filter_map(Result::ok).collect();
        Ok((prev_count, ids))
    }

    fn read_crate_bvids(&self, crate_id: &str) -> Result<HashSet<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT t.bvid FROM tracks t INNER JOIN crate_tracks ct ON t.id = ct.track_id WHERE ct.crate_id = ?1 UNION SELECT bvid FROM tracks WHERE dismissed = 1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![crate_id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    fn read_crate_track_bvids(&self, crate_id: &str) -> Result<Vec<(String, String)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT t.id, t.bvid FROM tracks t INNER JOIN crate_tracks ct ON t.id = ct.track_id WHERE ct.crate_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![crate_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    #[allow(clippy::too_many_arguments)]
    fn upsert_fav_track(
        &self,
        tid: &str,
        item: &FavMediaItem,
        cid: u64,
        page: u32,
        duration_sec: u64,
        tname: &str,
        parsed: &ParsedTrack,
        is_invalid: bool,
        is_new: bool,
        now: u64,
        pages_json: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tags_json = serde_json::to_string(&parsed.tags).unwrap_or_else(|_| "[]".into());
        // Preserve manual user corrections on existing rows!
        conn.execute(
            r#"
            INSERT INTO tracks (
                id, bvid, aid, cid, page, raw_title, title, artist, version, tags_json,
                confidence, rule_id, reason, manual, duration_sec, quality_label,
                cover_url, owner_mid, owner_name, tname, is_invalid, fav_time, is_new, created_at, pages_json
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 0, ?14, 'DASH 音频', ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)
            ON CONFLICT(id) DO UPDATE SET
                cid = CASE WHEN excluded.cid > 0 THEN excluded.cid ELSE tracks.cid END,
                is_invalid = excluded.is_invalid,
                cover_url = CASE WHEN excluded.cover_url != '' THEN excluded.cover_url ELSE tracks.cover_url END,
                pages_json = CASE WHEN excluded.pages_json != '[]' THEN excluded.pages_json ELSE tracks.pages_json END,
                title = CASE WHEN tracks.manual = 0 THEN excluded.title ELSE tracks.title END,
                artist = CASE WHEN tracks.manual = 0 THEN excluded.artist ELSE tracks.artist END,
                version = CASE WHEN tracks.manual = 0 THEN excluded.version ELSE tracks.version END,
                confidence = CASE WHEN tracks.manual = 0 THEN excluded.confidence ELSE tracks.confidence END,
                rule_id = CASE WHEN tracks.manual = 0 THEN excluded.rule_id ELSE tracks.rule_id END
            "#,
            params![
                tid,
                item.bvid,
                item.aid as i64,
                cid as i64,
                page as i64,
                item.title,
                parsed.title,
                parsed.artist_display,
                parsed.version,
                tags_json,
                parsed.confidence,
                parsed.rule_id,
                parsed.reason,
                duration_sec as i64,
                item.cover,
                item.owner_mid as i64,
                item.owner_name,
                tname,
                if is_invalid { 1 } else { 0 },
                item.fav_time as i64,
                if is_new { 1 } else { 0 },
                now as i64,
                pages_json
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn write_crate_sync(
        &self,
        crate_id: &str,
        folder: &FavFolder,
        kind: &str,
        sort_order: i32,
        track_order: &[(String, usize)],
        removed_ids: &HashSet<String>,
        now: u64,
    ) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let subtitle = if folder.is_season {
            format!("合集 · {} 首", folder.media_count.max(track_order.len() as u32))
        } else if folder.is_collected {
            format!("订阅收藏 · {} 首", folder.media_count.max(track_order.len() as u32))
        } else {
            format!("收藏夹 · {} 首", folder.media_count.max(track_order.len() as u32))
        };

        tx.execute(
            "INSERT INTO crates (id, title, subtitle, kind, cover, remote_media_id, remote_count, sort_order, last_sync_at, custom_title, is_deleted)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, 0)
             ON CONFLICT(id) DO UPDATE SET
                 title = CASE WHEN crates.custom_title = 0 THEN excluded.title ELSE crates.title END,
                 subtitle = CASE WHEN crates.custom_title = 0 THEN excluded.subtitle ELSE crates.subtitle END,
                 cover = CASE WHEN excluded.cover != '' THEN excluded.cover ELSE crates.cover END,
                 remote_count = excluded.remote_count,
                 last_sync_at = excluded.last_sync_at,
                 is_deleted = 0",
            params![
                crate_id,
                folder.title,
                subtitle,
                kind,
                folder.cover,
                folder.media_id as i64,
                folder.media_count as i64,
                sort_order,
                now as i64
            ],
        )
        .map_err(|e| e.to_string())?;

        for (tid, pos) in track_order {
            tx.execute(
                "INSERT INTO crate_tracks (crate_id, track_id, pos)
                 SELECT ?1, ?2, ?3
                 WHERE NOT EXISTS (SELECT 1 FROM tracks WHERE id = ?2 AND dismissed = 1)
                 ON CONFLICT(crate_id, track_id) DO UPDATE SET pos = excluded.pos",
                params![crate_id, tid, *pos as i64],
            )
            .map_err(|e| e.to_string())?;
        }

        // Bilibili-deleted/unfavored tracks are marked invalid (grayed) instead of erasing history
        for rid in removed_ids {
            tx.execute("UPDATE tracks SET is_invalid = 1 WHERE id = ?1", params![rid])
                .map_err(|e| e.to_string())?;
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn load_snapshot(&self) -> Result<LibrarySnapshot, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut crate_stmt = conn
            .prepare(
                "SELECT id, title, subtitle, kind, cover, remote_media_id FROM crates WHERE is_deleted = 0 ORDER BY sort_order ASC, last_sync_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let raw_crates: Vec<(String, String, String, String, String, u64)> = crate_stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, i64>(5)? as u64,
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();

        let mut pages_by_bvid: HashMap<String, Vec<VideoPage>> = HashMap::new();
        if let Ok(mut pstmt) = conn.prepare(
            "SELECT bvid, pages_json FROM tracks WHERE pages_json != '[]' ORDER BY page ASC",
        ) {
            if let Ok(iter) = pstmt.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            }) {
                for (bvid, pj) in iter.filter_map(Result::ok) {
                    if !pages_by_bvid.contains_key(&bvid) {
                        if let Ok(vec) = serde_json::from_str::<Vec<VideoPage>>(&pj) {
                            if !vec.is_empty() {
                                pages_by_bvid.insert(bvid, vec);
                            }
                        }
                    }
                }
            }
        }

        let mut crates_out = Vec::new();
        for (cid, title, subtitle, kind, fallback_cover, remote_media_id) in raw_crates {
            let mut tstmt = conn
                .prepare(
                    r#"
                    SELECT t.id, t.bvid, t.cid, t.page, t.raw_title, t.title, t.artist, t.version,
                           t.tags_json, t.confidence, t.rule_id, t.reason, t.duration_sec,
                           t.quality_label, t.cover_url, t.tname, t.is_invalid, t.is_new, t.pages_json
                    FROM tracks t
                    INNER JOIN crate_tracks ct ON t.id = ct.track_id
                    WHERE ct.crate_id = ?1
                    ORDER BY ct.pos ASC
                    "#,
                )
                .map_err(|e| e.to_string())?;

            let tracks: Vec<LibraryTrack> = tstmt
                .query_map(params![cid], |r| {
                    let tags_str: String = r.get(8)?;
                    let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
                    let trk_page = r.get::<_, i64>(3)? as u32;
                    let bvid: String = r.get(1)?;
                    let pages: Vec<VideoPage> = if let Some(shared) = pages_by_bvid.get(&bvid) {
                        shared.clone()
                    } else if trk_page == 1 {
                        let pages_str: String =
                            r.get::<_, String>(18).unwrap_or_else(|_| "[]".into());
                        serde_json::from_str(&pages_str).unwrap_or_default()
                    } else {
                        Vec::new()
                    };
                    let version: String = r.get(7)?;
                    let tname: String = r.get(15)?;
                    let trk_id: String = r.get(0)?;
                    let trk_cid = r.get::<_, i64>(2)? as u64;
                    let trk_title: String = r.get(5)?;
                    let trk_dur = r.get::<_, i64>(12)? as u64;
                    let conf: f32 = r.get(9)?;

                    // 64-bit FNV-1a hash over per-track identity (id, cid, page, title, duration)
                    // so multi-P tracks (e.g. BV1naxt6LECN P1..P113) each get distinct BPM, Key, and Energy!
                    let mut h: u64 = 0xcbf29ce484222325;
                    for b in trk_id
                        .bytes()
                        .chain(trk_title.bytes())
                        .chain(trk_cid.to_le_bytes())
                        .chain(trk_page.to_le_bytes())
                        .chain(trk_dur.to_le_bytes())
                    {
                        h ^= b as u64;
                        h = h.wrapping_mul(0x100000001b3);
                    }
                    let keys = [
                        "C major", "A minor", "G major", "E minor", "D major", "B minor",
                        "F major", "D minor", "Bb major", "G minor", "Eb major", "C minor",
                    ];
                    let bpm_val = 74 + ((h & 0xFFFF) as u32 % 78);
                    let key_val = keys[((h >> 16) as usize) % keys.len()].to_string();
                    let nrg_val = (2 + (((h >> 32) as usize) % 4)) as u8;

                    Ok(LibraryTrack {
                        id: trk_id,
                        bvid,
                        cid: trk_cid,
                        page: trk_page,
                        pages,
                        raw_title: r.get(4)?,
                        title: trk_title,
                        artist: r.get(6)?,
                        version: version.clone(),
                        confidence: conf,
                        rule_id: r.get(10)?,
                        reason: r.get(11)?,
                        tags,
                        duration_sec: trk_dur,
                        quality_label: r.get(13)?,
                        cover_url: r.get(14)?,
                        bpm: bpm_val,
                        musical_key: key_val,
                        energy: nrg_val,
                        reason_tag: if !tname.is_empty() {
                            format!("{tname} · {version}")
                        } else {
                            format!("置信度 {}%", (conf * 100.0).round() as u32)
                        },
                        is_invalid: r.get::<_, i64>(16)? != 0,
                        is_new: r.get::<_, i64>(17)? != 0,
                    })
                })
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .collect();

            let mut covers: Vec<String> = tracks
                .iter()
                .filter(|t| !t.cover_url.is_empty() && !t.is_invalid)
                .map(|t| t.cover_url.clone())
                .collect();
            let mut seen_cov = HashSet::new();
            covers.retain(|c| seen_cov.insert(c.clone()));
            if covers.len() >= 4 {
                covers.truncate(4);
            } else if !covers.is_empty() {
                covers.truncate(1);
            } else if !fallback_cover.is_empty() {
                covers.push(fallback_cover);
            } else {
                covers.push(DEFAULT_CRATE_COVER.to_string());
            }

            let new_count = tracks.iter().filter(|t| t.is_new).count() as u32;
            crates_out.push(LibraryCrate {
                id: cid,
                title: title.clone(),
                subtitle,
                kind,
                sort_key: infer_sort_key(&title),
                covers,
                tracks,
                remote_media_id,
                new_count,
            });
        }

        let mut pstmt = conn
            .prepare(
                r#"
                SELECT DISTINCT t.id, t.raw_title, t.owner_name, t.owner_mid, t.bvid, t.cover_url,
                                t.title, t.artist, t.version, t.confidence, t.rule_id, t.reason
                FROM tracks t
                INNER JOIN crate_tracks ct ON t.id = ct.track_id
                INNER JOIN crates c ON ct.crate_id = c.id
                WHERE c.is_deleted = 0 AND t.manual = 0 AND t.dismissed = 0 AND t.is_invalid = 0 AND t.confidence < ?1
                ORDER BY t.created_at DESC
                LIMIT 60
                "#,
            )
            .map_err(|e| e.to_string())?;
        let pending = pstmt
            .query_map(params![PENDING_THRESHOLD], |r| {
                Ok(PendingParseItem {
                    id: r.get(0)?,
                    raw_title: r.get(1)?,
                    owner: r.get(2)?,
                    owner_mid: r.get::<_, i64>(3)? as u64,
                    bvid: r.get(4)?,
                    cover_url: r.get(5)?,
                    guess_title: r.get(6)?,
                    guess_artist: r.get(7)?,
                    version: r.get(8)?,
                    confidence: r.get(9)?,
                    rule_id: r.get(10)?,
                    reason: r.get(11)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();

        let mut lstmt = conn
            .prepare("SELECT id FROM tracks WHERE liked = 1")
            .map_err(|e| e.to_string())?;
        let liked_ids = lstmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();

        let last_sync_at = conn
            .query_row("SELECT v FROM app_kv WHERE k = 'last_sync_at'", [], |r| {
                r.get::<_, String>(0)
            })
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);

        Ok(LibrarySnapshot {
            crates: crates_out,
            pending,
            liked_ids,
            last_sync_at,
        })
    }
}

#[derive(Debug, Clone)]
pub struct ParsedSeedMedia {
    pub aid: u64,
    pub bvid: String,
    pub cid: u64,
    pub raw_title: String,
    pub owner_mid: u64,
    pub owner_name: String,
    pub cover_url: String,
    pub duration_sec: u64,
    pub tname: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_confirms_pending_and_likes_locally() {
        let tmp = std::env::temp_dir().join(format!("szx_lib_test_{}.db", now_secs()));
        let _ = std::fs::remove_file(&tmp);
        let store = LibraryStore::open(&tmp).expect("open db");

        let detail = VideoDetail {
            bvid: "BV1GJ411x7h7".into(),
            aid: 123,
            cid: 456,
            title: "一段未按标准格式命名的夜间钢琴随想".into(),
            owner_name: "某钢琴UP".into(),
            owner_mid: 888,
            pic: "https://i0.hdslb.com/test.jpg".into(),
            duration_sec: 180,
            tname: "演奏".into(),
            desc: String::new(),
            pages: vec![],
        };

        let (trk, snap1) = store
            .upsert_online_track(&detail, 456, "", 1)
            .expect("insert online");
        assert!(!snap1.crates.is_empty());
        assert_eq!(snap1.pending.len(), 1);
        assert_eq!(snap1.pending[0].id, trk.id);

        let snap2 = store
            .confirm_pending(&trk.id, "夜间钢琴随想", "某钢琴UP", "Instrumental")
            .expect("confirm");
        assert!(snap2.pending.is_empty());
        assert_eq!(snap2.crates[0].tracks[0].title, "夜间钢琴随想");
        assert_eq!(snap2.crates[0].tracks[0].version, "Instrumental");

        let likes = store.toggle_like(&trk.id).expect("like");
        assert_eq!(likes, vec![trk.id]);

        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn transfers_and_creates_crate_cleanly() {
        let tmp = std::env::temp_dir().join(format!("szx_lib_transfer_test_{}.db", now_secs()));
        let _ = std::fs::remove_file(&tmp);
        let store = LibraryStore::open(&tmp).expect("open db");

        let detail = VideoDetail {
            bvid: "BV1naxt6LECN".into(),
            aid: 9001,
            cid: 1001,
            title: "影之刃零 OST 合集".into(),
            owner_name: "灵游坊".into(),
            owner_mid: 777,
            pic: "https://i0.hdslb.com/cover.jpg".into(),
            duration_sec: 180,
            tname: "游戏原声".into(),
            desc: String::new(),
            pages: vec![],
        };
        store
            .upsert_online_track(&detail, 1001, "第一幕", 1)
            .expect("insert p1");
        store
            .upsert_online_track(&detail, 1002, "第二幕", 2)
            .expect("insert p2");

        let online_id = "crate-online-picks";
        let (new_id, snap_after_move) = store
            .create_crate_and_transfer(
                "影之刃OST",
                "合集转移",
                online_id,
                Some("BV1naxt6LECN"),
                true,
            )
            .expect("create crate and transfer");

        let online = snap_after_move
            .crates
            .iter()
            .find(|c| c.id == online_id)
            .expect("online crate exists");
        let target = snap_after_move
            .crates
            .iter()
            .find(|c| c.id == new_id)
            .expect("new crate exists");
        assert!(online.tracks.is_empty());
        assert_eq!(target.tracks.len(), 2);

        let snap_after_copy = store
            .transfer_tracks(&new_id, online_id, None, false)
            .expect("copy back to online crate");
        let online_copied = snap_after_copy
            .crates
            .iter()
            .find(|c| c.id == online_id)
            .expect("online crate after copy");
        assert_eq!(online_copied.tracks.len(), 2);

        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn multipage_titles_preserved_across_rule_reapply_and_reload() {
        let tmp = std::env::temp_dir().join(format!("szx_lib_multipage_test_{}.db", now_secs()));
        let _ = std::fs::remove_file(&tmp);
        let store = LibraryStore::open(&tmp).expect("open db");

        let detail = VideoDetail {
            bvid: "BV1naxt6LECN".into(),
            aid: 11754,
            cid: 101,
            title: "【影之刃零】特典音乐集·Hi-Res无损OST".into(),
            owner_name: "影之刃零".into(),
            owner_mid: 888,
            pic: "https://i0.hdslb.com/cover.jpg".into(),
            duration_sec: 220,
            tname: "游戏原声".into(),
            desc: String::new(),
            pages: vec![
                VideoPage { cid: 101, page: 1, part: "01 - 玉汝于成".into(), duration: 76, first_frame: None },
                VideoPage { cid: 102, page: 2, part: "02 - 今昼如昨".into(), duration: 144, first_frame: None },
            ],
        };
        store.upsert_online_track(&detail, 101, "01 - 玉汝于成", 1).expect("upsert multipage");

        // Adding a global regex rule triggers reapply_rules_to_tracks across all pages
        store
            .add_custom_rule(0, "(?P<artist>[^《]+)《(?P<title>[^》]+)》", 110, "test")
            .expect("add rule");

        let snap = store.load_snapshot().expect("snapshot");
        let crate_item = snap.crates.first().expect("crate");
        assert_eq!(crate_item.tracks.len(), 2);
        assert_eq!(crate_item.tracks[0].title, "玉汝于成");
        assert_eq!(crate_item.tracks[1].title, "今昼如昨");
        // Both P1 and P2 share the full pages vector in memory
        assert_eq!(crate_item.tracks[0].pages.len(), 2);
        assert_eq!(crate_item.tracks[1].pages.len(), 2);

        let _ = std::fs::remove_file(&tmp);
    }
}
