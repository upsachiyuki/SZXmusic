use std::collections::BTreeMap;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use md5::{Digest, Md5};
use qrcode::render::svg;
use qrcode::QrCode;
use reqwest::header::{HeaderMap, HeaderValue, ORIGIN, REFERER, SET_COOKIE, USER_AGENT};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const DESKTOP_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MIXIN_KEY_ENC_TAB: [usize; 64] = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19,
    29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

#[derive(Debug, Error)]
pub enum BiliError {
    #[error("HTTP 请求失败: {0}")]
    Http(#[from] reqwest::Error),
    #[error("B站接口返回错误 ({code}): {message}")]
    Api { code: i64, message: String },
    #[error("缺少必要字段: {0}")]
    MissingField(&'static str),
    #[error("登录凭据无效或已过期，请重新扫码")]
    Unauthorized,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BiliCredentials {
    pub sessdata: String,
    pub bili_jct: String,
    pub dede_user_id: String,
    pub refresh_token: String,
    pub buvid3: Option<String>,
    pub buvid4: Option<String>,
}

impl BiliCredentials {
    pub fn is_logged_in(&self) -> bool {
        !self.sessdata.trim().is_empty() && !self.dede_user_id.trim().is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrLoginStart {
    pub qrcode_key: String,
    pub url: String,
    pub svg: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrPollStatus {
    pub status: String, // "waiting" | "scanned" | "expired" | "confirmed" | "error"
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing)]
    pub credentials: Option<BiliCredentials>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BiliUserInfo {
    pub is_login: bool,
    pub mid: u64,
    pub uname: String,
    pub face: String,
    pub vip_type: u8,
    pub vip_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavFolder {
    pub media_id: u64,
    pub title: String,
    pub cover: String,
    pub media_count: u32,
    pub is_collected: bool,
    pub is_season: bool,
    pub mid: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavResourceId {
    pub aid: u64,
    pub bvid: String,
    pub rtype: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavMediaItem {
    pub aid: u64,
    pub bvid: String,
    pub title: String,
    pub cover: String,
    pub duration: u64,
    pub owner_mid: u64,
    pub owner_name: String,
    pub fav_time: u64,
    pub attr: i64,
    pub page_count: u32,
    pub intro: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavListPage {
    pub folder: FavFolder,
    pub medias: Vec<FavMediaItem>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoPage {
    pub cid: u64,
    pub page: u32,
    pub part: String,
    pub duration: u64,
    #[serde(default)]
    pub first_frame: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoDetail {
    pub bvid: String,
    pub aid: u64,
    pub cid: u64,
    pub title: String,
    pub owner_name: String,
    pub owner_mid: u64,
    pub pic: String,
    pub duration_sec: u64,
    pub tname: String,
    pub desc: String,
    pub pages: Vec<VideoPage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioStreamCandidate {
    pub id: u32,
    pub quality_label: String,
    pub codec: String,
    pub mime_type: String,
    pub bandwidth: u64,
    pub base_url: String,
    pub backup_urls: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchVideoItem {
    pub bvid: String,
    pub aid: u64,
    pub title: String,
    pub author: String,
    pub mid: u64,
    pub pic: String,
    pub duration_sec: u64,
    pub play: u64,
    pub tag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelatedVideoItem {
    pub bvid: String,
    pub aid: u64,
    pub cid: u64,
    pub title: String,
    pub owner_name: String,
    pub owner_mid: u64,
    pub pic: String,
    pub duration_sec: u64,
    pub tname: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricLineItem {
    pub time_sec: f64,
    pub end_sec: f64,
    pub text: String,
    pub sub_text: Option<String>,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackLyricsBundle {
    pub bvid: String,
    pub cid: u64,
    pub title: String,
    pub owner_name: String,
    pub duration_sec: u64,
    pub source_label: String,
    pub description: String,
    pub pages: Vec<VideoPage>,
    pub lines: Vec<LyricLineItem>,
    pub danmaku: Vec<LyricLineItem>,
}

#[derive(Debug, Clone)]
pub struct WbiKeys {
    pub img_key: String,
    pub sub_key: String,
}

impl WbiKeys {
    pub fn mixin_key(&self) -> String {
        let combined = format!("{}{}", self.img_key, self.sub_key);
        let bytes = combined.as_bytes();
        MIXIN_KEY_ENC_TAB
            .iter()
            .filter_map(|&idx| bytes.get(idx).map(|&b| b as char))
            .take(32)
            .collect()
    }
}

#[derive(Debug, Deserialize)]
struct BiliResponse<T> {
    code: i64,
    #[serde(default)]
    message: String,
    data: Option<T>,
}

#[derive(Debug, Deserialize)]
struct QrGenData {
    url: String,
    qrcode_key: String,
}

#[derive(Debug, Deserialize)]
struct QrPollData {
    #[serde(default)]
    url: String,
    #[serde(default)]
    refresh_token: String,
    #[serde(default)]
    code: i64,
    #[serde(default)]
    message: String,
}

#[derive(Debug, Deserialize)]
struct NavData {
    #[serde(rename = "isLogin", default)]
    is_login: bool,
    #[serde(default)]
    mid: u64,
    #[serde(default)]
    uname: String,
    #[serde(default)]
    face: String,
    #[serde(rename = "vipType", default)]
    vip_type: u8,
    #[serde(default)]
    vip_label: Option<VipLabel>,
    wbi_img: Option<NavWbiImg>,
}

#[derive(Debug, Deserialize)]
struct VipLabel {
    #[serde(default)]
    text: String,
}

#[derive(Debug, Deserialize)]
struct NavWbiImg {
    img_url: String,
    sub_url: String,
}

#[derive(Debug, Deserialize)]
struct SpiData {
    b_3: String,
    b_4: String,
}

#[derive(Debug, Deserialize)]
struct FavListAllData {
    #[serde(default)]
    list: Option<Vec<RawFavFolder>>,
}

#[derive(Debug, Deserialize)]
struct RawFavFolder {
    id: u64,
    #[serde(default)]
    mid: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    cover: String,
    #[serde(default)]
    media_count: u32,
    #[serde(rename = "type", default)]
    folder_type: i32,
}

#[derive(Debug, Deserialize)]
struct RawFavId {
    id: u64,
    #[serde(rename = "type", default)]
    rtype: i64,
    #[serde(default)]
    bvid: Option<String>,
    #[serde(default)]
    bv_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawFavResourceData {
    info: Option<RawFavFolder>,
    #[serde(default)]
    medias: Option<Vec<RawFavMedia>>,
    #[serde(default)]
    has_more: bool,
}

#[derive(Debug, Deserialize)]
struct RawFavMedia {
    id: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    cover: String,
    #[serde(default)]
    intro: String,
    #[serde(default)]
    page: u32,
    #[serde(default)]
    duration: u64,
    #[serde(default)]
    attr: i64,
    #[serde(default)]
    bvid: Option<String>,
    #[serde(default)]
    bv_id: Option<String>,
    #[serde(default)]
    fav_time: u64,
    #[serde(default)]
    upper: Option<ViewOwner>,
}

#[derive(Debug, Deserialize)]
struct SeasonArchivesData {
    meta: Option<SeasonMeta>,
    #[serde(default)]
    archives: Option<Vec<SeasonArchive>>,
    page: Option<SeasonPageInfo>,
}

#[derive(Debug, Deserialize)]
struct SeasonMeta {
    #[serde(default)]
    season_id: u64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    cover: String,
    #[serde(default)]
    total: u32,
    #[serde(default)]
    mid: u64,
}

#[derive(Debug, Deserialize)]
struct SeasonArchive {
    aid: u64,
    #[serde(default)]
    bvid: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    pic: String,
    #[serde(default)]
    duration: u64,
    #[serde(default)]
    pubdate: u64,
}

#[derive(Debug, Deserialize)]
struct SeasonPageInfo {
    #[serde(default)]
    page_num: u32,
    #[serde(default)]
    page_size: u32,
    #[serde(default)]
    total: u32,
}

#[derive(Debug, Deserialize)]
struct ViewData {
    bvid: String,
    aid: u64,
    cid: u64,
    title: String,
    pic: String,
    duration: u64,
    #[serde(default)]
    tname: String,
    #[serde(default)]
    desc: String,
    owner: ViewOwner,
    #[serde(default)]
    pages: Option<Vec<RawVideoPage>>,
}

#[derive(Debug, Deserialize)]
struct RawVideoPage {
    cid: u64,
    page: u32,
    #[serde(default)]
    part: String,
    #[serde(default)]
    duration: u64,
    #[serde(default)]
    first_frame: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ViewOwner {
    #[serde(default)]
    mid: u64,
    #[serde(default)]
    name: String,
}

#[derive(Debug, Deserialize)]
struct SearchResultData {
    #[serde(default)]
    result: Option<Vec<RawSearchVideo>>,
}

#[derive(Debug, Deserialize)]
struct RawSearchVideo {
    #[serde(default)]
    bvid: String,
    #[serde(default)]
    aid: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    mid: u64,
    #[serde(default)]
    pic: String,
    #[serde(default)]
    duration: String,
    #[serde(default)]
    play: serde_json::Value,
    #[serde(default)]
    tag: String,
}

#[derive(Debug, Deserialize)]
struct RelatedItemRaw {
    #[serde(default)]
    bvid: String,
    #[serde(default)]
    aid: u64,
    #[serde(default)]
    cid: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    pic: String,
    #[serde(default)]
    duration: u64,
    #[serde(default)]
    tname: String,
    #[serde(default)]
    owner: Option<ViewOwner>,
}

#[derive(Debug, Deserialize)]
struct PlayUrlData {
    dash: Option<DashData>,
}

#[derive(Debug, Deserialize)]
struct DashData {
    #[serde(default)]
    audio: Vec<DashStream>,
    flac: Option<DashFlac>,
}

#[derive(Debug, Deserialize)]
struct DashFlac {
    audio: Option<DashStream>,
}

#[derive(Debug, Deserialize)]
struct DashStream {
    id: u32,
    #[serde(rename = "baseUrl", default)]
    base_url_camel: Option<String>,
    #[serde(rename = "base_url", default)]
    base_url_snake: Option<String>,
    #[serde(rename = "backupUrl", default)]
    backup_url_camel: Option<Vec<String>>,
    #[serde(rename = "backup_url", default)]
    backup_url_snake: Option<Vec<String>>,
    bandwidth: u64,
    #[serde(rename = "mimeType", default)]
    mime_type_camel: Option<String>,
    #[serde(rename = "mime_type", default)]
    mime_type_snake: Option<String>,
    #[serde(default)]
    codecs: String,
}

pub struct BiliClient {
    http: reqwest::Client,
    creds: BiliCredentials,
    cached_wbi: Option<(WbiKeys, Instant)>,
    last_api_at: Option<Instant>,
}

impl BiliClient {
    pub fn new() -> Result<Self, BiliError> {
        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static(DESKTOP_UA));
        headers.insert(REFERER, HeaderValue::from_static("https://www.bilibili.com/"));
        headers.insert(ORIGIN, HeaderValue::from_static("https://www.bilibili.com"));

        let http = reqwest::Client::builder()
            .default_headers(headers)
            .cookie_store(false)
            .timeout(Duration::from_secs(20))
            .build()?;

        Ok(Self {
            http,
            creds: BiliCredentials::default(),
            cached_wbi: None,
            last_api_at: None,
        })
    }

    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    pub fn set_credentials(&mut self, creds: BiliCredentials) {
        self.creds = creds;
        self.cached_wbi = None;
    }

    pub fn clear_credentials(&mut self) {
        let b3 = self.creds.buvid3.take();
        let b4 = self.creds.buvid4.take();
        self.creds = BiliCredentials {
            buvid3: b3,
            buvid4: b4,
            ..Default::default()
        };
        self.cached_wbi = None;
    }

    pub fn credentials(&self) -> &BiliCredentials {
        &self.creds
    }

    /// Initializes anonymous device fingerprint cookies (`buvid3`/`buvid4`) to reduce -352 / 412 risk.
    pub async fn init_fingerprint(&mut self) -> Result<(), BiliError> {
        if self.creds.buvid3.is_some() {
            return Ok(());
        }
        let resp: BiliResponse<SpiData> = self
            .http
            .get("https://api.bilibili.com/x/frontend/finger/spi")
            .send()
            .await?
            .json()
            .await?;
        if resp.code == 0 {
            if let Some(d) = resp.data {
                self.creds.buvid3 = Some(d.b_3);
                self.creds.buvid4 = Some(d.b_4);
            }
        }
        Ok(())
    }

    pub fn cookie_header(&self) -> Option<String> {
        let mut pairs = Vec::new();
        if let Some(b3) = &self.creds.buvid3 {
            if !b3.is_empty() {
                pairs.push(format!("buvid3={b3}"));
            }
        }
        if let Some(b4) = &self.creds.buvid4 {
            if !b4.is_empty() {
                pairs.push(format!("buvid4={b4}"));
            }
        }
        if !self.creds.sessdata.is_empty() {
            pairs.push(format!("SESSDATA={}", self.creds.sessdata));
        }
        if !self.creds.bili_jct.is_empty() {
            pairs.push(format!("bili_jct={}", self.creds.bili_jct));
        }
        if !self.creds.dede_user_id.is_empty() {
            pairs.push(format!("DedeUserID={}", self.creds.dede_user_id));
        }
        if pairs.is_empty() {
            None
        } else {
            Some(pairs.join("; "))
        }
    }

    async fn polite_pace(&mut self) {
        if let Some(prev) = self.last_api_at {
            let elapsed = prev.elapsed();
            if elapsed < Duration::from_millis(120) {
                tokio::time::sleep(Duration::from_millis(120) - elapsed).await;
            }
        }
        self.last_api_at = Some(Instant::now());
    }

    async fn send_with_backoff(&mut self, url: &str) -> Result<reqwest::Response, BiliError> {
        self.polite_pace().await;
        let cookie = self.cookie_header();
        let mut req = self.http.get(url);
        if let Some(c) = &cookie {
            req = req.header("Cookie", c);
        }
        let resp = req.send().await?;
        if resp.status().as_u16() == 412 || resp.status().as_u16() == 429 {
            tokio::time::sleep(Duration::from_millis(850)).await;
            let mut retry_req = self.http.get(url);
            if let Some(c) = &cookie {
                retry_req = retry_req.header("Cookie", c);
            }
            return Ok(retry_req.send().await?);
        }
        Ok(resp)
    }

    /// Starts Passport QR Code Login and renders crisp inline SVG locally.
    pub async fn qr_generate(&mut self) -> Result<QrLoginStart, BiliError> {
        let _ = self.init_fingerprint().await;
        let resp: BiliResponse<QrGenData> = self
            .send_with_backoff("https://passport.bilibili.com/x/passport-login/web/qrcode/generate")
            .await?
            .json()
            .await?;
        if resp.code != 0 {
            return Err(BiliError::Api {
                code: resp.code,
                message: resp.message,
            });
        }
        let data = resp.data.ok_or(BiliError::MissingField("qr.data"))?;
        let qr = QrCode::new(data.url.as_bytes()).map_err(|_| BiliError::MissingField("qr.svg"))?;
        let svg_str = qr
            .render()
            .min_dimensions(200, 200)
            .dark_color(svg::Color("#141413"))
            .light_color(svg::Color("#faf9f5"))
            .build();

        Ok(QrLoginStart {
            qrcode_key: data.qrcode_key,
            url: data.url,
            svg: svg_str,
        })
    }

    /// Polls Passport QR Code status; when confirmed (code == 0), captures cookies & applies to client.
    pub async fn qr_poll(&mut self, qrcode_key: &str) -> Result<QrPollStatus, BiliError> {
        let url = format!(
            "https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key={}",
            url::form_urlencoded::byte_serialize(qrcode_key.as_bytes()).collect::<String>()
        );
        let resp = self.send_with_backoff(&url).await?;

        let mut sessdata = String::new();
        let mut bili_jct = String::new();
        let mut dede_user_id = String::new();

        for val in resp.headers().get_all(SET_COOKIE) {
            if let Ok(s) = val.to_str() {
                if let Some(kv) = s.split(';').next() {
                    if let Some((k, v)) = kv.split_once('=') {
                        match k.trim() {
                            "SESSDATA" => sessdata = v.trim().to_string(),
                            "bili_jct" => bili_jct = v.trim().to_string(),
                            "DedeUserID" => dede_user_id = v.trim().to_string(),
                            _ => {}
                        }
                    }
                }
            }
        }

        let body: BiliResponse<QrPollData> = resp.json().await?;
        if body.code != 0 {
            return Err(BiliError::Api {
                code: body.code,
                message: body.message,
            });
        }
        let d = body.data.ok_or(BiliError::MissingField("qr.poll.data"))?;

        let status = match d.code {
            0 => "confirmed",
            86101 => "waiting",
            86090 => "scanned",
            86038 => "expired",
            _ => "error",
        }
        .to_string();

        if d.code == 0 {
            // Fallback cookie extraction from crossDomain callback URL params if Set-Cookie omitted any
            if let Ok(parsed_url) = url::Url::parse(&d.url) {
                for (k, v) in parsed_url.query_pairs() {
                    match k.as_ref() {
                        "SESSDATA" if sessdata.is_empty() => sessdata = v.into_owned(),
                        "bili_jct" if bili_jct.is_empty() => bili_jct = v.into_owned(),
                        "DedeUserID" if dede_user_id.is_empty() => dede_user_id = v.into_owned(),
                        _ => {}
                    }
                }
            }
            let creds = BiliCredentials {
                sessdata,
                bili_jct,
                dede_user_id,
                refresh_token: d.refresh_token,
                buvid3: self.creds.buvid3.clone(),
                buvid4: self.creds.buvid4.clone(),
            };
            self.set_credentials(creds.clone());
            return Ok(QrPollStatus {
                status,
                code: d.code,
                message: d.message,
                credentials: Some(creds),
            });
        }

        Ok(QrPollStatus {
            status,
            code: d.code,
            message: d.message,
            credentials: None,
        })
    }

    pub async fn get_nav_user(&mut self) -> Result<BiliUserInfo, BiliError> {
        let _ = self.init_fingerprint().await;
        let resp: BiliResponse<NavData> = self
            .send_with_backoff("https://api.bilibili.com/x/web-interface/nav")
            .await?
            .json()
            .await?;

        let data = resp.data.ok_or(BiliError::MissingField("nav.data"))?;
        if let Some(wbi) = &data.wbi_img {
            let keys = WbiKeys {
                img_key: extract_key_from_url(&wbi.img_url),
                sub_key: extract_key_from_url(&wbi.sub_url),
            };
            self.cached_wbi = Some((keys, Instant::now()));
        }

        Ok(BiliUserInfo {
            is_login: data.is_login && resp.code == 0,
            mid: data.mid,
            uname: data.uname,
            face: normalize_bili_image_url(&data.face),
            vip_type: data.vip_type,
            vip_label: data
                .vip_label
                .map(|l| l.text)
                .filter(|t| !t.is_empty())
                .unwrap_or_else(|| {
                    if data.vip_type >= 2 {
                        "年度大会员".into()
                    } else if data.vip_type == 1 {
                        "大会员".into()
                    } else {
                        "正式会员".into()
                    }
                }),
        })
    }

    pub async fn fetch_wbi_keys(&mut self) -> Result<WbiKeys, BiliError> {
        if let Some((keys, ts)) = &self.cached_wbi {
            if ts.elapsed() < Duration::from_secs(6 * 3600) {
                return Ok(keys.clone());
            }
        }
        let _ = self.init_fingerprint().await;
        let resp: BiliResponse<NavData> = self
            .send_with_backoff("https://api.bilibili.com/x/web-interface/nav")
            .await?
            .json()
            .await?;
        let data = resp.data.ok_or(BiliError::MissingField("nav.data"))?;
        let wbi = data.wbi_img.ok_or(BiliError::MissingField("nav.wbi_img"))?;
        let keys = WbiKeys {
            img_key: extract_key_from_url(&wbi.img_url),
            sub_key: extract_key_from_url(&wbi.sub_url),
        };
        self.cached_wbi = Some((keys.clone(), Instant::now()));
        Ok(keys)
    }

    pub async fn list_created_favorites(&mut self, mid: u64) -> Result<Vec<FavFolder>, BiliError> {
        let url = format!(
            "https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid={mid}"
        );
        let resp: BiliResponse<FavListAllData> = self.send_with_backoff(&url).await?.json().await?;
        if resp.code == -101 {
            return Err(BiliError::Unauthorized);
        }
        if resp.code != 0 {
            return Err(BiliError::Api {
                code: resp.code,
                message: resp.message,
            });
        }
        let list = resp.data.and_then(|d| d.list).unwrap_or_default();
        Ok(list
            .into_iter()
            .map(|f| FavFolder {
                media_id: f.id,
                title: f.title,
                cover: normalize_bili_image_url(&f.cover),
                media_count: f.media_count,
                is_collected: false,
                is_season: false,
                mid: if f.mid == 0 { mid } else { f.mid },
            })
            .collect())
    }

    pub async fn list_collected_folders(&mut self, mid: u64) -> Result<Vec<FavFolder>, BiliError> {
        let mut out = Vec::new();
        for pn in 1..=3 {
            let url = format!(
                "https://api.bilibili.com/x/v3/fav/folder/collected/list?up_mid={mid}&pn={pn}&ps=50&platform=web"
            );
            let resp: BiliResponse<FavListAllData> =
                self.send_with_backoff(&url).await?.json().await?;
            if resp.code != 0 {
                break;
            }
            let list = resp.data.and_then(|d| d.list).unwrap_or_default();
            let count = list.len();
            for f in list {
                out.push(FavFolder {
                    media_id: f.id,
                    title: f.title,
                    cover: normalize_bili_image_url(&f.cover),
                    media_count: f.media_count,
                    is_collected: true,
                    is_season: f.folder_type == 21,
                    mid: f.mid,
                });
            }
            if count < 50 {
                break;
            }
        }
        Ok(out)
    }

    pub async fn get_favorite_resource_ids(
        &mut self,
        media_id: u64,
    ) -> Result<Vec<FavResourceId>, BiliError> {
        let url = format!(
            "https://api.bilibili.com/x/v3/fav/resource/ids?media_id={media_id}"
        );
        let resp: BiliResponse<Vec<RawFavId>> =
            self.send_with_backoff(&url).await?.json().await?;
        if resp.code != 0 {
            return Err(BiliError::Api {
                code: resp.code,
                message: resp.message,
            });
        }
        Ok(resp
            .data
            .unwrap_or_default()
            .into_iter()
            .filter_map(|item| {
                let bvid = item.bvid.or(item.bv_id)?;
                Some(FavResourceId {
                    aid: item.id,
                    bvid,
                    rtype: item.rtype,
                })
            })
            .collect())
    }

    pub async fn get_favorite_list_page(
        &mut self,
        media_id: u64,
        pn: u32,
        ps: u32,
    ) -> Result<FavListPage, BiliError> {
        let url = format!(
            "https://api.bilibili.com/x/v3/fav/resource/list?media_id={media_id}&pn={pn}&ps={ps}&platform=web"
        );
        let resp: BiliResponse<RawFavResourceData> =
            self.send_with_backoff(&url).await?.json().await?;
        if resp.code != 0 {
            return Err(BiliError::Api {
                code: resp.code,
                message: resp.message,
            });
        }
        let data = resp
            .data
            .ok_or(BiliError::MissingField("fav.resource.data"))?;
        let raw_info = data.info.ok_or(BiliError::MissingField("fav.resource.info"))?;
        let folder = FavFolder {
            media_id: raw_info.id,
            title: raw_info.title,
            cover: normalize_bili_image_url(&raw_info.cover),
            media_count: raw_info.media_count,
            is_collected: false,
            is_season: false,
            mid: raw_info.mid,
        };
        let medias = data
            .medias
            .unwrap_or_default()
            .into_iter()
            .filter_map(|m| {
                let bvid = m.bvid.or(m.bv_id)?;
                let (owner_mid, owner_name) = m
                    .upper
                    .map(|u| (u.mid, u.name))
                    .unwrap_or((0, "未知UP主".into()));
                Some(FavMediaItem {
                    aid: m.id,
                    bvid,
                    title: m.title,
                    cover: normalize_bili_image_url(&m.cover),
                    duration: m.duration,
                    owner_mid,
                    owner_name,
                    fav_time: m.fav_time,
                    attr: m.attr,
                    page_count: m.page.max(1),
                    intro: m.intro,
                })
            })
            .collect();

        Ok(FavListPage {
            folder,
            medias,
            has_more: data.has_more,
        })
    }

    pub async fn get_season_archives(
        &mut self,
        mid: u64,
        season_id: u64,
        pn: u32,
        ps: u32,
    ) -> Result<(FavFolder, Vec<FavMediaItem>, bool), BiliError> {
        let url = format!(
            "https://api.bilibili.com/x/polymer/web-space/seasons_archives_list?mid={mid}&season_id={season_id}&sort_reverse=false&page_num={pn}&page_size={ps}"
        );
        let resp: BiliResponse<SeasonArchivesData> =
            self.send_with_backoff(&url).await?.json().await?;
        if resp.code != 0 {
            return Err(BiliError::Api {
                code: resp.code,
                message: resp.message,
            });
        }
        let data = resp.data.ok_or(BiliError::MissingField("season.data"))?;
        let meta = data.meta.ok_or(BiliError::MissingField("season.meta"))?;
        let folder = FavFolder {
            media_id: meta.season_id,
            title: meta.name,
            cover: normalize_bili_image_url(&meta.cover),
            media_count: meta.total,
            is_collected: true,
            is_season: true,
            mid: if meta.mid == 0 { mid } else { meta.mid },
        };
        let has_more = data
            .page
            .map(|p| (p.page_num * p.page_size) < p.total)
            .unwrap_or(false);
        let items = data
            .archives
            .unwrap_or_default()
            .into_iter()
            .map(|a| FavMediaItem {
                aid: a.aid,
                bvid: a.bvid,
                title: a.title,
                cover: normalize_bili_image_url(&a.pic),
                duration: a.duration,
                owner_mid: folder.mid,
                owner_name: String::new(),
                fav_time: a.pubdate,
                attr: 0,
                page_count: 1,
                intro: String::new(),
            })
            .collect();
        Ok((folder, items, has_more))
    }

    pub async fn get_video_detail(&mut self, bvid: &str) -> Result<VideoDetail, BiliError> {
        let _ = self.init_fingerprint().await;
        let url = format!(
            "https://api.bilibili.com/x/web-interface/view?bvid={}",
            url::form_urlencoded::byte_serialize(bvid.as_bytes()).collect::<String>()
        );
        let resp: BiliResponse<ViewData> = self.send_with_backoff(&url).await?.json().await?;
        if resp.code != 0 {
            return Err(BiliError::Api {
                code: resp.code,
                message: resp.message,
            });
        }
        let d = resp.data.ok_or(BiliError::MissingField("view.data"))?;
        let pages = d
            .pages
            .unwrap_or_default()
            .into_iter()
            .map(|p| VideoPage {
                cid: p.cid,
                page: p.page,
                part: p.part,
                duration: p.duration,
                first_frame: p
                    .first_frame
                    .filter(|s| !s.trim().is_empty())
                    .map(|s| normalize_bili_image_url(&s)),
            })
            .collect();
        Ok(VideoDetail {
            bvid: d.bvid,
            aid: d.aid,
            cid: d.cid,
            title: d.title,
            owner_name: d.owner.name,
            owner_mid: d.owner.mid,
            pic: normalize_bili_image_url(&d.pic),
            duration_sec: d.duration,
            tname: d.tname,
            desc: d.desc,
            pages,
        })
    }

    pub async fn search_videos(
        &mut self,
        keyword: &str,
        pn: u32,
    ) -> Result<Vec<SearchVideoItem>, BiliError> {
        let _ = self.init_fingerprint().await;
        let keys = self.fetch_wbi_keys().await?;

        let mut params = BTreeMap::new();
        params.insert("search_type".to_string(), "video".to_string());
        params.insert("keyword".to_string(), keyword.to_string());
        params.insert("page".to_string(), pn.max(1).to_string());
        params.insert("page_size".to_string(), "20".to_string());

        let signed_qs = sign_wbi_params(params, &keys);
        let url = format!("https://api.bilibili.com/x/web-interface/wbi/search/type?{signed_qs}");

        let resp: BiliResponse<SearchResultData> = self.send_with_backoff(&url).await?.json().await?;
        if resp.code == -352 || resp.code == -412 {
            // Invalidate cached WBI keys and retry once
            self.cached_wbi = None;
            let keys2 = self.fetch_wbi_keys().await?;
            let mut params2 = BTreeMap::new();
            params2.insert("search_type".to_string(), "video".to_string());
            params2.insert("keyword".to_string(), keyword.to_string());
            params2.insert("page".to_string(), pn.max(1).to_string());
            params2.insert("page_size".to_string(), "20".to_string());
            let signed2 = sign_wbi_params(params2, &keys2);
            let url2 = format!(
                "https://api.bilibili.com/x/web-interface/wbi/search/type?{signed2}"
            );
            let resp2: BiliResponse<SearchResultData> =
                self.send_with_backoff(&url2).await?.json().await?;
            if resp2.code != 0 {
                return Err(BiliError::Api {
                    code: resp2.code,
                    message: resp2.message,
                });
            }
            return Ok(map_search_items(resp2.data.and_then(|d| d.result).unwrap_or_default()));
        }
        if resp.code != 0 {
            return Err(BiliError::Api {
                code: resp.code,
                message: resp.message,
            });
        }
        Ok(map_search_items(
            resp.data.and_then(|d| d.result).unwrap_or_default(),
        ))
    }

    pub async fn get_related_videos(
        &mut self,
        bvid: &str,
    ) -> Result<Vec<RelatedVideoItem>, BiliError> {
        let _ = self.init_fingerprint().await;
        let url = format!(
            "https://api.bilibili.com/x/web-interface/archive/related?bvid={}",
            url::form_urlencoded::byte_serialize(bvid.as_bytes()).collect::<String>()
        );
        let resp: BiliResponse<Vec<RelatedItemRaw>> =
            self.send_with_backoff(&url).await?.json().await?;
        if resp.code != 0 {
            return Err(BiliError::Api {
                code: resp.code,
                message: resp.message,
            });
        }
        Ok(resp
            .data
            .unwrap_or_default()
            .into_iter()
            .filter(|r| !r.bvid.is_empty())
            .map(|r| {
                let (owner_mid, owner_name) = r
                    .owner
                    .map(|o| (o.mid, o.name))
                    .unwrap_or((0, "未知UP主".into()));
                RelatedVideoItem {
                    bvid: r.bvid,
                    aid: r.aid,
                    cid: r.cid,
                    title: r.title,
                    owner_name,
                    owner_mid,
                    pic: normalize_bili_image_url(&r.pic),
                    duration_sec: r.duration,
                    tname: r.tname,
                }
            })
            .collect())
    }

    pub async fn get_dash_audio_streams(
        &mut self,
        bvid: &str,
        cid: u64,
    ) -> Result<Vec<AudioStreamCandidate>, BiliError> {
        let _ = self.init_fingerprint().await;
        let keys = self.fetch_wbi_keys().await?;

        let mut params = BTreeMap::new();
        params.insert("bvid".to_string(), bvid.to_string());
        params.insert("cid".to_string(), cid.to_string());
        params.insert("qn".to_string(), "120".to_string());
        params.insert("fnval".to_string(), "4048".to_string());
        params.insert("fnver".to_string(), "0".to_string());
        params.insert("fourk".to_string(), "1".to_string());

        let signed_qs = sign_wbi_params(params, &keys);
        let url = format!("https://api.bilibili.com/x/player/wbi/playurl?{signed_qs}");

        let resp: BiliResponse<PlayUrlData> = self.send_with_backoff(&url).await?.json().await?;
        if resp.code != 0 {
            return Err(BiliError::Api {
                code: resp.code,
                message: resp.message,
            });
        }

        let dash = resp
            .data
            .and_then(|d| d.dash)
            .ok_or(BiliError::MissingField("playurl.data.dash"))?;

        let mut out = Vec::new();
        if let Some(flac_stream) = dash.flac.and_then(|f| f.audio) {
            out.push(to_candidate(flac_stream));
        }

        let mut std_streams: Vec<AudioStreamCandidate> = dash
            .audio
            .into_iter()
            // Skip Dolby E-AC3 (30250) since symphonia does not decode E-AC3.
            .filter(|s| s.id != 30250)
            .map(to_candidate)
            .collect();

        // Priority: 30251 Hi-Res FLAC > 30280 (192K) > 30232 (132K) > 30216 (64K)
        std_streams.sort_by_key(|s| std::cmp::Reverse(quality_rank(s.id, s.bandwidth)));
        out.extend(std_streams);

        if out.is_empty() {
            return Err(BiliError::MissingField("dash.audio"));
        }
        Ok(out)
    }

    /// Fetches synchronized lyrics / CC subtitles + timed Bilibili danmaku waterfall for a track.
    pub async fn get_track_lyrics_bundle(
        &mut self,
        bvid: &str,
        cid_override: Option<u64>,
        title_hint: &str,
        artist_hint: &str,
    ) -> Result<TrackLyricsBundle, BiliError> {
        let detail = self.get_video_detail(bvid).await?;
        let target_cid = cid_override.filter(|&c| c > 0).unwrap_or(detail.cid);
        let target_page = detail.pages.iter().find(|p| p.cid == target_cid);
        let target_duration = target_page
            .map(|p| p.duration)
            .filter(|&d| d > 0)
            .unwrap_or(detail.duration_sec);

        let mut lines: Vec<LyricLineItem> = Vec::new();
        let mut source_label = String::new();

        // 1. Priority 1: Video's own original Bilibili subtitles (CC manual Chinese -> other manual -> AI zh -> others)
        let mut subtitle_metas = self.fetch_video_subtitles_meta(&detail.bvid, target_cid).await;
        subtitle_metas.sort_by_key(|m| subtitle_priority_rank(m));

        for item in subtitle_metas {
            let sub_url = normalize_bili_image_url(&item.subtitle_url);
            if sub_url.is_empty() {
                continue;
            }
            let Ok(sub_resp) = self
                .http
                .get(&sub_url)
                .header(REFERER, "https://www.bilibili.com/")
                .timeout(Duration::from_secs(6))
                .send()
                .await
            else {
                continue;
            };
            if !sub_resp.status().is_success() {
                continue;
            }
            let Ok(body_json) = sub_resp.json::<BiliSubtitleJson>().await else {
                continue;
            };
            let parsed: Vec<LyricLineItem> = body_json
                .body
                .into_iter()
                .filter(|b| !b.content.trim().is_empty())
                .map(|b| LyricLineItem {
                    time_sec: b.from,
                    end_sec: b.to.max(b.from + 1.2),
                    text: b.content.trim().to_string(),
                    sub_text: if item.lan_doc.is_empty() {
                        None
                    } else {
                        Some(item.lan_doc.clone())
                    },
                    kind: "subtitle".to_string(),
                })
                .collect();
            if !parsed.is_empty() {
                let kind_badge = if item.lan.starts_with("ai-") || item.ai_type != 0 {
                    "AI 原视频字幕"
                } else {
                    "原视频 CC 字幕"
                };
                source_label = format!(
                    "{kind_badge} ({})",
                    if item.lan_doc.is_empty() {
                        item.lan.as_str()
                    } else {
                        item.lan_doc.as_str()
                    }
                );
                lines = parsed;
                break;
            }
        }

        // 2. Priority 2: Search & align synced lyrics strictly matching the song title/artist/duration
        let part_hint = target_page.map(|p| p.part.as_str()).unwrap_or("");
        let (target_song, inferred_artist) =
            extract_song_and_artist_hint(&detail.title, title_hint, part_hint, artist_hint);
        let skip_lyrics_search = is_strict_instrumental(&target_song, part_hint, &detail.title);

        if lines.is_empty() && !target_song.is_empty() && !skip_lyrics_search {
            if let Some((matched_label, matched_lines)) = self
                .search_aligned_lyrics(&target_song, &inferred_artist, target_duration)
                .await
            {
                source_label = matched_label;
                lines = matched_lines;
            }
        }

        // 3. Always fetch genuine Bilibili timed Danmaku pool (`seg.so` protobuf -> `comment.bilibili.com/{cid}.xml`)
        let danmaku = self
            .fetch_danmaku_lines(detail.aid, target_cid, target_duration)
            .await
            .unwrap_or_default();

        if lines.is_empty() {
            source_label = if skip_lyrics_search {
                "纯音乐 / 器乐曲目（无原字幕）".to_string()
            } else {
                "暂无视频原字幕，未匹配到对齐歌词".to_string()
            };
        }
        if !danmaku.is_empty() {
            source_label = format!("{source_label} · 含 {} 条 B 站时间轴弹幕", danmaku.len());
        }

        Ok(TrackLyricsBundle {
            bvid: detail.bvid,
            cid: target_cid,
            title: detail.title,
            owner_name: detail.owner_name,
            duration_sec: target_duration,
            source_label,
            description: detail.desc,
            pages: detail.pages,
            lines,
            danmaku,
        })
    }

    async fn fetch_video_subtitles_meta(
        &mut self,
        bvid: &str,
        cid: u64,
    ) -> Vec<PlayerV2SubtitleMeta> {
        // Prefer WBI player/v2 (returns CC & AI subtitles when logged in)
        if let Ok(keys) = self.fetch_wbi_keys().await {
            let mut params = BTreeMap::new();
            params.insert("bvid".to_string(), bvid.to_string());
            params.insert("cid".to_string(), cid.to_string());
            let signed_qs = sign_wbi_params(params, &keys);
            let v2_url = format!("https://api.bilibili.com/x/player/wbi/v2?{signed_qs}");
            if let Ok(resp) = self.send_with_backoff(&v2_url).await {
                if let Ok(v2) = resp.json::<BiliResponse<PlayerV2Data>>().await {
                    let subs = v2
                        .data
                        .and_then(|d| d.subtitle)
                        .map(|s| s.subtitles)
                        .unwrap_or_default();
                    if !subs.is_empty() {
                        return subs;
                    }
                }
            }
        }

        // Fallback to non-WBI /x/player/v2 endpoint
        let fallback_url = format!("https://api.bilibili.com/x/player/v2?bvid={bvid}&cid={cid}");
        if let Ok(resp) = self.send_with_backoff(&fallback_url).await {
            if let Ok(v2) = resp.json::<BiliResponse<PlayerV2Data>>().await {
                return v2
                    .data
                    .and_then(|d| d.subtitle)
                    .map(|s| s.subtitles)
                    .unwrap_or_default();
            }
        }
        Vec::new()
    }

    async fn search_aligned_lyrics(
        &self,
        song_title: &str,
        artist: &str,
        target_duration: u64,
    ) -> Option<(String, Vec<LyricLineItem>)> {
        let mut best: Option<(i32, String, Vec<LyricLineItem>)> = None;

        // 1. Search LRCLIB (structured track_name + artist_name first, then keyword q fallback)
        let mut lrclib_urls = Vec::new();
        let enc_title: String =
            url::form_urlencoded::byte_serialize(song_title.as_bytes()).collect();
        if !artist.is_empty() {
            let enc_artist: String =
                url::form_urlencoded::byte_serialize(artist.as_bytes()).collect();
            lrclib_urls.push(format!(
                "https://lrclib.net/api/search?track_name={enc_title}&artist_name={enc_artist}"
            ));
            let combo: String = url::form_urlencoded::byte_serialize(
                format!("{song_title} {artist}").as_bytes(),
            )
            .collect();
            lrclib_urls.push(format!("https://lrclib.net/api/search?q={combo}"));
        }
        lrclib_urls.push(format!("https://lrclib.net/api/search?q={enc_title}"));

        for url in lrclib_urls {
            let Ok(resp) = self
                .http
                .get(&url)
                .timeout(Duration::from_millis(3500))
                .send()
                .await
            else {
                continue;
            };
            if !resp.status().is_success() {
                continue;
            }
            let Ok(items) = resp.json::<Vec<LrclibItem>>().await else {
                continue;
            };
            for hit in items {
                let Some(synced) = hit.synced_lyrics else {
                    continue;
                };
                let parsed = parse_lrc_lines(&synced, target_duration as f64);
                let cand_title = hit.track_name.unwrap_or_default();
                let cand_artist = hit.artist_name.unwrap_or_default();
                if let Some(score) = score_lyric_candidate(
                    song_title,
                    artist,
                    target_duration,
                    &cand_title,
                    &cand_artist,
                    hit.duration.unwrap_or(0.0),
                    &parsed,
                ) {
                    let label = if cand_artist.is_empty() {
                        format!("对齐歌词 · {cand_title} (LRCLIB)")
                    } else {
                        format!("对齐歌词 · {cand_title} - {cand_artist} (LRCLIB)")
                    };
                    let replace = best.as_ref().map(|b| score > b.0).unwrap_or(true);
                    if replace {
                        best = Some((score, label, parsed));
                    }
                }
            }
            if best.as_ref().map(|b| b.0 >= 120).unwrap_or(false) {
                break;
            }
        }

        // 2. Fallback to NetEase public lyrics search when LRCLIB had no high-confidence alignment
        if best.is_none() {
            let kw = if artist.is_empty() {
                song_title.to_string()
            } else {
                format!("{song_title} {artist}")
            };
            if let Some(ne_best) = self
                .search_netease_aligned_lyrics(&kw, song_title, artist, target_duration)
                .await
            {
                best = Some(ne_best);
            }
        }

        best.map(|(_, label, lines)| (label, lines))
    }

    async fn search_netease_aligned_lyrics(
        &self,
        query: &str,
        song_title: &str,
        artist: &str,
        target_duration: u64,
    ) -> Option<(i32, String, Vec<LyricLineItem>)> {
        let resp = self
            .http
            .post("https://music.163.com/api/search/get")
            .header(REFERER, "https://music.163.com/")
            .form(&[("s", query), ("type", "1"), ("limit", "5")])
            .timeout(Duration::from_millis(3500))
            .send()
            .await
            .ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let search_data = resp.json::<NeteaseSearchResp>().await.ok()?;
        let songs = search_data.result.map(|r| r.songs).unwrap_or_default();

        let mut best: Option<(i32, String, Vec<LyricLineItem>)> = None;
        for song in songs.into_iter().take(4) {
            let cand_artist = song
                .artists
                .into_iter()
                .map(|a| a.name)
                .filter(|n| !n.is_empty())
                .collect::<Vec<_>>()
                .join(" / ");
            let cand_dur_sec = (song.duration as f64) / 1000.0;
            // Quick title/duration pre-check before fetching individual lyric payload
            if score_title_and_duration_only(song_title, &song.name, target_duration, cand_dur_sec)
                .is_none()
            {
                continue;
            }

            let lrc_url = format!(
                "https://music.163.com/api/song/lyric?id={}&lv=1&kv=1&tv=-1",
                song.id
            );
            let Ok(lrc_resp) = self
                .http
                .get(&lrc_url)
                .header(REFERER, "https://music.163.com/")
                .timeout(Duration::from_millis(3000))
                .send()
                .await
            else {
                continue;
            };
            let Ok(lrc_json) = lrc_resp.json::<NeteaseLyricResp>().await else {
                continue;
            };
            let Some(raw_lrc) = lrc_json.lrc.map(|l| l.lyric).filter(|s| !s.is_empty()) else {
                continue;
            };
            let parsed = parse_lrc_lines(&raw_lrc, target_duration as f64);
            if let Some(score) = score_lyric_candidate(
                song_title,
                artist,
                target_duration,
                &song.name,
                &cand_artist,
                cand_dur_sec,
                &parsed,
            ) {
                let label = if cand_artist.is_empty() {
                    format!("对齐歌词 · {} (云音乐)", song.name)
                } else {
                    format!("对齐歌词 · {} - {} (云音乐)", song.name, cand_artist)
                };
                if best.as_ref().map(|b| score > b.0).unwrap_or(true) {
                    best = Some((score, label, parsed));
                }
            }
        }
        best
    }

    async fn fetch_danmaku_lines(
        &mut self,
        aid: u64,
        cid: u64,
        duration_sec: u64,
    ) -> Result<Vec<LyricLineItem>, BiliError> {
        let _ = self.init_fingerprint().await;

        // Primary: Bilibili Protobuf dm/web/seg.so (up to 3 segments x 6 minutes = 18 min coverage)
        if aid > 0 && cid > 0 {
            let max_seg = if duration_sec > 720 {
                3u32
            } else if duration_sec > 360 {
                2u32
            } else {
                1u32
            };
            let mut seg_items = Vec::new();
            for seg_idx in 1..=max_seg {
                let seg_url = format!(
                    "https://api.bilibili.com/x/v2/dm/web/seg.so?type=1&oid={cid}&pid={aid}&segment_index={seg_idx}"
                );
                if let Ok(resp) = self.send_with_backoff(&seg_url).await {
                    if resp.status().is_success() {
                        if let Ok(bytes) = resp.bytes().await {
                            seg_items.extend(parse_danmaku_seg_proto(&bytes));
                        }
                    }
                }
            }
            if !seg_items.is_empty() {
                return Ok(dedup_and_cap_danmaku(seg_items));
            }
        }

        // Secondary fallback: comment.bilibili.com/{cid}.xml (raw deflate / zlib / gzip / utf8 XML)
        let comment_xml_url = format!("https://comment.bilibili.com/{cid}.xml");
        if let Ok(resp) = self.send_with_backoff(&comment_xml_url).await {
            if resp.status().is_success() {
                if let Ok(bytes) = resp.bytes().await {
                    let xml_text = decode_danmaku_bytes(&bytes);
                    let items = parse_danmaku_xml(&xml_text);
                    if !items.is_empty() {
                        return Ok(items);
                    }
                }
            }
        }

        // Last resort: legacy list.so endpoint (only when returning HTTP 200)
        let legacy_url = format!("https://api.bilibili.com/x/v1/dm/list.so?oid={cid}");
        if let Ok(resp) = self.send_with_backoff(&legacy_url).await {
            if resp.status().is_success() {
                if let Ok(bytes) = resp.bytes().await {
                    let xml_text = decode_danmaku_bytes(&bytes);
                    let items = parse_danmaku_xml(&xml_text);
                    if !items.is_empty() {
                        return Ok(items);
                    }
                }
            }
        }

        Ok(Vec::new())
    }
}

pub fn normalize_bili_image_url(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.starts_with("//") {
        format!("https:{trimmed}")
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        format!("https://{rest}")
    } else {
        trimmed.to_string()
    }
}

fn map_search_items(raw: Vec<RawSearchVideo>) -> Vec<SearchVideoItem> {
    raw.into_iter()
        .filter(|item| !item.bvid.is_empty())
        .map(|item| SearchVideoItem {
            bvid: item.bvid,
            aid: item.aid,
            title: strip_search_highlight(&item.title),
            author: item.author,
            mid: item.mid,
            pic: normalize_bili_image_url(&item.pic),
            duration_sec: parse_duration_str(&item.duration),
            play: item.play.as_u64().unwrap_or(0),
            tag: item.tag,
        })
        .collect()
}

pub fn strip_search_highlight(s: &str) -> String {
    s.replace("<em class=\"keyword\">", "")
        .replace("</em>", "")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .trim()
        .to_string()
}

pub fn parse_duration_str(s: &str) -> u64 {
    let parts: Vec<u64> = s
        .trim()
        .split(':')
        .filter_map(|p| p.parse::<u64>().ok())
        .collect();
    match parts.as_slice() {
        [m, sec] => m * 60 + sec,
        [h, m, sec] => h * 3600 + m * 60 + sec,
        [sec] => *sec,
        _ => 0,
    }
}

/// Extracts BV id from either a raw BV string or a full bilibili.com video URL.
pub fn extract_bvid(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    for i in 0..bytes.len() {
        if i + 12 <= bytes.len() && &bytes[i..i + 2] == b"BV" {
            let candidate = &input[i..i + 12];
            if candidate.chars().all(|c| c.is_ascii_alphanumeric()) {
                return Some(candidate.to_string());
            }
        }
    }
    None
}

fn quality_rank(id: u32, bandwidth: u64) -> u64 {
    let tier = match id {
        30251 => 4,
        30280 => 3,
        30232 => 2,
        30216 => 1,
        _ => 0,
    };
    (tier << 40) | (bandwidth & ((1u64 << 40) - 1))
}

fn to_candidate(s: DashStream) -> AudioStreamCandidate {
    let label = match s.id {
        30251 => "Hi-Res FLAC".to_string(),
        30280 => "192K AAC".to_string(),
        30232 => "132K AAC".to_string(),
        30216 => "64K AAC".to_string(),
        other => format!("ID-{other}"),
    };
    let base_url = s
        .base_url_camel
        .or(s.base_url_snake)
        .unwrap_or_default();
    let backup_urls = s
        .backup_url_camel
        .or(s.backup_url_snake)
        .unwrap_or_default();
    let mime_type = s
        .mime_type_camel
        .or(s.mime_type_snake)
        .unwrap_or_default();
    AudioStreamCandidate {
        id: s.id,
        quality_label: label,
        codec: s.codecs,
        mime_type,
        bandwidth: s.bandwidth,
        base_url,
        backup_urls,
    }
}

fn extract_key_from_url(raw: &str) -> String {
    let file = raw.rsplit('/').next().unwrap_or("");
    file.split('.').next().unwrap_or("").to_string()
}

pub fn sign_wbi_params(params: BTreeMap<String, String>, keys: &WbiKeys) -> String {
    let wts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string();
    sign_wbi_params_with_ts(params, keys, &wts)
}

pub fn sign_wbi_params_with_ts(
    mut params: BTreeMap<String, String>,
    keys: &WbiKeys,
    wts: &str,
) -> String {
    params.insert("wts".to_string(), wts.to_string());
    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    for (k, v) in &params {
        let filtered: String = v
            .chars()
            .filter(|c| !matches!(c, '!' | '\'' | '(' | ')' | '*'))
            .collect();
        serializer.append_pair(k, &filtered);
    }
    let query = serializer.finish().replace('+', "%20");
    let mixin = keys.mixin_key();
    let mut hasher = Md5::new();
    hasher.update(format!("{query}{mixin}").as_bytes());
    let w_rid = format!("{:x}", hasher.finalize());
    format!("{query}&w_rid={w_rid}")
}

#[derive(Debug, Deserialize)]
struct PlayerV2Data {
    #[serde(default)]
    subtitle: Option<PlayerV2SubtitleWrap>,
}

#[derive(Debug, Deserialize)]
struct PlayerV2SubtitleWrap {
    #[serde(default)]
    subtitles: Vec<PlayerV2SubtitleMeta>,
}

#[derive(Debug, Deserialize)]
struct PlayerV2SubtitleMeta {
    #[serde(default)]
    lan: String,
    #[serde(default)]
    lan_doc: String,
    #[serde(default)]
    subtitle_url: String,
    #[serde(default)]
    ai_type: i32,
}

#[derive(Debug, Deserialize)]
struct BiliSubtitleJson {
    #[serde(default)]
    body: Vec<BiliSubtitleLine>,
}

#[derive(Debug, Deserialize)]
struct BiliSubtitleLine {
    #[serde(default)]
    from: f64,
    #[serde(default)]
    to: f64,
    #[serde(default)]
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LrclibItem {
    #[serde(default)]
    track_name: Option<String>,
    #[serde(default)]
    artist_name: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    synced_lyrics: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NeteaseSearchResp {
    #[serde(default)]
    result: Option<NeteaseSearchResult>,
}

#[derive(Debug, Deserialize)]
struct NeteaseSearchResult {
    #[serde(default)]
    songs: Vec<NeteaseSongItem>,
}

#[derive(Debug, Deserialize)]
struct NeteaseSongItem {
    id: u64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    duration: u64,
    #[serde(default)]
    artists: Vec<NeteaseArtist>,
}

#[derive(Debug, Deserialize)]
struct NeteaseArtist {
    #[serde(default)]
    name: String,
}

#[derive(Debug, Deserialize)]
struct NeteaseLyricResp {
    #[serde(default)]
    lrc: Option<NeteaseLrcBody>,
}

#[derive(Debug, Deserialize)]
struct NeteaseLrcBody {
    #[serde(default)]
    lyric: String,
}

fn subtitle_priority_rank(m: &PlayerV2SubtitleMeta) -> (u8, u8) {
    let lan = m.lan.to_lowercase();
    let is_ai = lan.starts_with("ai-") || m.ai_type != 0;
    let is_zh = lan.starts_with("zh") || lan.contains("-zh") || m.lan_doc.contains("中文");
    match (is_ai, is_zh) {
        (false, true) => (0, if lan == "zh-cn" || lan == "zh-hans" { 0 } else { 1 }),
        (false, false) => (1, 0),
        (true, true) => (2, 0),
        (true, false) => (3, 0),
    }
}

fn strip_page_suffix_and_index(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    // Strip trailing "(P12)" or "（P12）"
    for (open, close) in [("(", ")"), ("（", "）")] {
        if let Some(pos) = s.rfind(open) {
            if s.ends_with(close) {
                let inner = &s[pos + open.len()..s.len() - close.len()];
                if inner.trim().to_lowercase().starts_with('p')
                    && inner.trim()[1..].chars().all(|c| c.is_ascii_digit())
                {
                    s = s[..pos].trim().to_string();
                }
            }
        }
    }
    // Strip leading track numbering like "01 - ", "P2.", "EP03 "
    let lower = s.to_lowercase();
    for prefix in ["ep", "p"] {
        if let Some(after) = lower.strip_prefix(prefix) {
            let digits = after.chars().take_while(|c| c.is_ascii_digit()).count();
            if (1..=3).contains(&digits) {
                let rest = s[prefix.len() + digits..]
                    .trim_start_matches(|c: char| matches!(c, ':' | '：' | '.' | '、' | '-' | '–' | '—' | '_' | ' '));
                if !rest.is_empty() {
                    return rest.trim().to_string();
                }
            }
        }
    }
    let digits = s.chars().take_while(|c| c.is_ascii_digit()).count();
    if (1..=3).contains(&digits) {
        let rest = &s[digits..];
        let trim_r = rest.trim_start();
        if let Some(after_sep) = rest
            .strip_prefix('.')
            .or_else(|| rest.strip_prefix('、'))
            .or_else(|| rest.strip_prefix('_'))
            .or_else(|| trim_r.strip_prefix('-'))
            .or_else(|| trim_r.strip_prefix('–'))
            .or_else(|| trim_r.strip_prefix('—'))
        {
            if !after_sep.trim().is_empty() {
                return after_sep.trim().to_string();
            }
        }
    }
    s
}

fn extract_song_and_artist_hint(
    video_title: &str,
    title_hint: &str,
    part_hint: &str,
    artist_hint: &str,
) -> (String, String) {
    let hint_clean = strip_page_suffix_and_index(title_hint);
    let part_clean = strip_page_suffix_and_index(part_hint);
    let video_core = extract_core_song_title(&strip_page_suffix_and_index(video_title));

    let chosen_raw = if !hint_clean.is_empty() && hint_clean != video_title.trim() {
        hint_clean
    } else if !part_clean.is_empty() && part_clean != video_title.trim() {
        part_clean
    } else {
        video_title.trim().to_string()
    };

    let mut song = extract_core_song_title(&chosen_raw);
    let mut artist = if artist_hint.trim().chars().all(|c| c.is_ascii_digit()) {
        String::new()
    } else {
        artist_hint.trim().to_string()
    };

    // If extracted song still contains "Artist - Song" (and no explicit artist), split cleanly
    if let Some((left, right)) = song.split_once(" - ") {
        let l = left.trim();
        let r = right.trim();
        if !l.is_empty() && !r.is_empty() {
            if artist.is_empty() || normalize_match_key(&artist) == normalize_match_key(l) {
                artist = l.to_string();
                song = r.to_string();
            } else if normalize_match_key(&artist) == normalize_match_key(r) {
                song = l.to_string();
            }
        }
    }

    if song.is_empty() {
        song = video_core;
    }
    (song, artist)
}

fn is_strict_instrumental(song: &str, part_hint: &str, video_title: &str) -> bool {
    let song_lc = format!("{} {}", song, part_hint).to_lowercase();
    let strict_song_kw = [
        "纯音乐", "伴奏", "instrumental", "off vocal", "无人声",
        "钢琴曲", "吉他曲", "大笛", "纯享伴奏", "karaoke",
    ];
    if strict_song_kw.iter().any(|k| song_lc.contains(k)) {
        return true;
    }
    let vid_lc = video_title.to_lowercase();
    ["纯音乐合集", "纯享伴奏", "off vocal", "bgm合集"]
        .iter()
        .any(|k| vid_lc.contains(k))
}

fn normalize_match_key(raw: &str) -> String {
    let stripped = strip_paren_suffix(&strip_page_suffix_and_index(raw));
    stripped
        .chars()
        .filter(|c| !c.is_whitespace() && !matches!(c, '-' | '–' | '—' | '_' | '·' | '\'' | '"' | '《' | '》' | '「' | '」' | ',' | '.' | '!' | '?' | '，' | '。' | '！' | '？' | ':' | '：' | '/' | '｜' | '|'))
        .flat_map(|c| c.to_lowercase())
        .collect()
}

fn char_dice_similarity(a: &str, b: &str) -> f64 {
    let ca: Vec<char> = a.chars().collect();
    let cb: Vec<char> = b.chars().collect();
    if ca.is_empty() || cb.is_empty() {
        return 0.0;
    }
    if ca.len() == 1 || cb.len() == 1 {
        return if ca == cb { 1.0 } else { 0.0 };
    }
    let mut bigrams_a: Vec<(char, char)> = ca.windows(2).map(|w| (w[0], w[1])).collect();
    let bigrams_b: Vec<(char, char)> = cb.windows(2).map(|w| (w[0], w[1])).collect();
    let total = bigrams_a.len() + bigrams_b.len();
    let mut overlap = 0usize;
    for bg in &bigrams_b {
        if let Some(pos) = bigrams_a.iter().position(|x| x == bg) {
            overlap += 1;
            bigrams_a.swap_remove(pos);
        }
    }
    (2.0 * overlap as f64) / (total as f64)
}

fn score_title_and_duration_only(
    target_title: &str,
    cand_title: &str,
    target_duration: u64,
    cand_dur_sec: f64,
) -> Option<i32> {
    let kt = normalize_match_key(target_title);
    let kc = normalize_match_key(cand_title);
    if kt.is_empty() || kc.is_empty() {
        return None;
    }

    let title_score = if kt == kc {
        100
    } else if kc.contains(&kt) || kt.contains(&kc) {
        let min_len = kt.chars().count().min(kc.chars().count());
        let max_len = kt.chars().count().max(kc.chars().count());
        let ratio = (min_len as f64) / (max_len.max(1) as f64);
        if ratio >= 0.55 || (min_len >= 3 && ratio >= 0.45) {
            72
        } else {
            return None;
        }
    } else {
        let dice = char_dice_similarity(&kt, &kc);
        if dice >= 0.62 {
            (dice * 80.0).round() as i32
        } else {
            return None;
        }
    };

    let mut dur_bonus = 0;
    if target_duration > 0 && cand_dur_sec > 5.0 {
        let diff = (cand_dur_sec - target_duration as f64).abs();
        if (45..=600).contains(&target_duration) && diff > 75.0 {
            return None;
        }
        dur_bonus = if diff <= 4.0 {
            30
        } else if diff <= 12.0 {
            20
        } else if diff <= 25.0 {
            8
        } else if diff > 55.0 {
            -20
        } else {
            0
        };
    }

    Some(title_score + dur_bonus)
}

fn score_lyric_candidate(
    target_title: &str,
    target_artist: &str,
    target_duration: u64,
    cand_title: &str,
    cand_artist: &str,
    cand_dur_sec: f64,
    parsed: &[LyricLineItem],
) -> Option<i32> {
    // Require at least 3 meaningful non-credit lines
    let meaningful = parsed
        .iter()
        .filter(|l| {
            let t = l.text.trim();
            !t.is_empty()
                && !t.contains("纯音乐，请欣赏")
                && !t.contains("没有填词")
                && !t.starts_with("作词")
                && !t.starts_with("作曲")
                && !t.starts_with("编曲")
        })
        .count();
    if meaningful < 3 || parsed.len() < 3 {
        return None;
    }

    let mut score =
        score_title_and_duration_only(target_title, cand_title, target_duration, cand_dur_sec)?;

    let ka_t = normalize_match_key(target_artist);
    let ka_c = normalize_match_key(cand_artist);
    if !ka_t.is_empty() && !ka_c.is_empty() {
        if ka_t == ka_c || ka_t.contains(&ka_c) || ka_c.contains(&ka_t) {
            score += 25;
        }
    }

    if score >= 55 {
        Some(score)
    } else {
        None
    }
}

fn extract_core_song_title(raw: &str) -> String {
    let s = raw.trim();
    if let (Some(l), Some(r)) = (s.find('「'), s.find('」')) {
        if r > l + 3 {
            let inner = &s[l + '「'.len_utf8()..r];
            return strip_paren_suffix(inner);
        }
    }
    if let (Some(l), Some(r)) = (s.find('《'), s.find('》')) {
        if r > l + 3 {
            let inner = &s[l + '《'.len_utf8()..r];
            return strip_paren_suffix(inner);
        }
    }
    let first_seg = s.split('|').next().unwrap_or(s).trim();
    strip_paren_suffix(first_seg)
}

fn strip_paren_suffix(s: &str) -> String {
    let mut out = s.to_string();
    for (open, close) in [('（', '）'), ('(', ')'), ('【', '】'), ('[', ']')] {
        while let (Some(l), Some(r)) = (out.find(open), out.find(close)) {
            if r > l {
                out = format!("{}{}", &out[..l], &out[r + close.len_utf8()..]);
            } else {
                break;
            }
        }
    }
    out.trim().to_string()
}

pub fn parse_lrc_lines(lrc: &str, total_dur: f64) -> Vec<LyricLineItem> {
    let mut offset_sec = 0.0f64;
    let mut raw_items: Vec<(f64, String)> = Vec::new();

    for line in lrc.lines() {
        let mut rest = line.trim();
        if rest.is_empty() {
            continue;
        }
        // Check [offset:...] metadata tag
        if rest.starts_with("[offset:") && rest.ends_with(']') {
            if let Ok(ms) = rest[8..rest.len() - 1].trim().parse::<f64>() {
                offset_sec = ms / 1000.0;
            }
            continue;
        }

        // Collect all leading [mm:ss(.ff)] timestamps on the line
        let mut timestamps = Vec::new();
        while rest.starts_with('[') {
            let Some(close_idx) = rest.find(']') else {
                break;
            };
            let tag = &rest[1..close_idx];
            if let Some((mm_str, ss_str)) = tag.split_once(':') {
                if let (Ok(mm), Ok(ss)) = (
                    mm_str.trim().parse::<f64>(),
                    ss_str.trim().replace(':', ".").parse::<f64>(),
                ) {
                    timestamps.push((mm * 60.0 + ss + offset_sec).max(0.0));
                    rest = rest[close_idx + 1..].trim_start();
                    continue;
                }
            }
            break;
        }

        let text = rest.trim();
        if text.is_empty() || timestamps.is_empty() {
            continue;
        }
        for t in timestamps {
            raw_items.push((t, text.to_string()));
        }
    }

    raw_items.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let len = raw_items.len();
    let mut out = Vec::with_capacity(len);
    for idx in 0..len {
        let (t, ref text) = raw_items[idx];
        let next_t = if idx + 1 < len {
            raw_items[idx + 1].0
        } else {
            total_dur.max(t + 5.0)
        };
        let end_sec = if idx + 1 < len {
            next_t.max(t + 0.5).min(t + 15.0)
        } else {
            total_dur.max(t + 5.0)
        };
        out.push(LyricLineItem {
            time_sec: t,
            end_sec,
            text: text.clone(),
            sub_text: None,
            kind: "lrc".to_string(),
        });
    }
    out
}

fn decode_xml_entities(s: &str) -> String {
    let decoded = s
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ");
    strip_search_highlight(&decoded)
}

fn decode_danmaku_bytes(bytes: &[u8]) -> String {
    use std::io::Read;
    if bytes.starts_with(b"<?xml") || bytes.starts_with(b"<i>") {
        return String::from_utf8_lossy(bytes).into_owned();
    }
    let mut deflate = flate2::read::DeflateDecoder::new(bytes);
    let mut out_deflate = String::new();
    if deflate.read_to_string(&mut out_deflate).is_ok() && !out_deflate.is_empty() {
        return out_deflate;
    }
    let mut zlib = flate2::read::ZlibDecoder::new(bytes);
    let mut out_zlib = String::new();
    if zlib.read_to_string(&mut out_zlib).is_ok() && !out_zlib.is_empty() {
        return out_zlib;
    }
    let mut gz = flate2::read::GzDecoder::new(bytes);
    let mut out_gz = String::new();
    if gz.read_to_string(&mut out_gz).is_ok() && !out_gz.is_empty() {
        return out_gz;
    }
    String::from_utf8_lossy(bytes).into_owned()
}

fn read_proto_varint(buf: &[u8], pos: &mut usize) -> Option<u64> {
    let mut val = 0u64;
    let mut shift = 0u32;
    while *pos < buf.len() && shift < 64 {
        let b = buf[*pos];
        *pos += 1;
        val |= ((b & 0x7F) as u64) << shift;
        if (b & 0x80) == 0 {
            return Some(val);
        }
        shift += 7;
    }
    None
}

fn skip_proto_field(wire_type: u64, buf: &[u8], pos: &mut usize) -> bool {
    match wire_type {
        0 => read_proto_varint(buf, pos).is_some(),
        1 => {
            if *pos + 8 <= buf.len() {
                *pos += 8;
                true
            } else {
                false
            }
        }
        2 => {
            let Some(len) = read_proto_varint(buf, pos) else {
                return false;
            };
            let end = (*pos).saturating_add(len as usize);
            if end <= buf.len() {
                *pos = end;
                true
            } else {
                false
            }
        }
        5 => {
            if *pos + 4 <= buf.len() {
                *pos += 4;
                true
            } else {
                false
            }
        }
        _ => false,
    }
}

fn parse_danmaku_elem(elem: &[u8]) -> Option<LyricLineItem> {
    let mut pos = 0usize;
    let mut progress_ms = 0u64;
    let mut mode = 1u64;
    let mut content = String::new();

    while pos < elem.len() {
        let key = read_proto_varint(elem, &mut pos)?;
        let field_no = key >> 3;
        let wire_type = key & 0x07;
        match (field_no, wire_type) {
            (2, 0) => progress_ms = read_proto_varint(elem, &mut pos)?,
            (3, 0) => mode = read_proto_varint(elem, &mut pos)?,
            (7, 2) => {
                let len = read_proto_varint(elem, &mut pos)? as usize;
                let end = pos.saturating_add(len);
                if end > elem.len() {
                    return None;
                }
                content = String::from_utf8_lossy(&elem[pos..end]).into_owned();
                pos = end;
            }
            _ => {
                if !skip_proto_field(wire_type, elem, &mut pos) {
                    return None;
                }
            }
        }
    }

    // Skip special advanced/scripted danmaku modes (7, 8)
    if mode >= 7 {
        return None;
    }
    let clean = decode_xml_entities(&content).trim().to_string();
    if clean.chars().count() < 2 || clean.len() > 140 {
        return None;
    }
    let time_sec = (progress_ms as f64) / 1000.0;
    Some(LyricLineItem {
        time_sec,
        end_sec: time_sec + 4.0,
        text: clean,
        sub_text: Some("B站弹幕".to_string()),
        kind: "danmaku".to_string(),
    })
}

/// Decodes Bilibili `x/v2/dm/web/seg.so` protobuf (`DmSegMobileReply`) into sorted timed danmaku items.
pub fn parse_danmaku_seg_proto(bytes: &[u8]) -> Vec<LyricLineItem> {
    let mut out = Vec::new();
    let mut pos = 0usize;
    while pos < bytes.len() {
        let Some(key) = read_proto_varint(bytes, &mut pos) else {
            break;
        };
        let field_no = key >> 3;
        let wire_type = key & 0x07;
        if field_no == 1 && wire_type == 2 {
            let Some(len) = read_proto_varint(bytes, &mut pos) else {
                break;
            };
            let end = pos.saturating_add(len as usize);
            if end > bytes.len() {
                break;
            }
            if let Some(item) = parse_danmaku_elem(&bytes[pos..end]) {
                out.push(item);
            }
            pos = end;
        } else if !skip_proto_field(wire_type, bytes, &mut pos) {
            break;
        }
    }
    dedup_and_cap_danmaku(out)
}

fn dedup_and_cap_danmaku(mut out: Vec<LyricLineItem>) -> Vec<LyricLineItem> {
    out.sort_by(|a, b| {
        a.time_sec
            .partial_cmp(&b.time_sec)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut deduped: Vec<LyricLineItem> = Vec::with_capacity(out.len().min(220));
    for item in out {
        if deduped
            .iter()
            .rev()
            .take(8)
            .any(|prev| prev.text == item.text && (item.time_sec - prev.time_sec).abs() < 4.0)
        {
            continue;
        }
        deduped.push(item);
        if deduped.len() >= 220 {
            break;
        }
    }
    deduped
}

pub fn parse_danmaku_xml(xml: &str) -> Vec<LyricLineItem> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(d_start) = rest.find("<d p=\"") {
        let after_p = &rest[d_start + 6..];
        let Some(p_end) = after_p.find('"') else {
            break;
        };
        let p_attr = &after_p[..p_end];
        let after_quote = &after_p[p_end + 1..];
        let Some(gt_idx) = after_quote.find('>') else {
            break;
        };
        let content_start = &after_quote[gt_idx + 1..];
        let Some(close_d) = content_start.find("</d>") else {
            break;
        };
        let raw_text = &content_start[..close_d];
        rest = &content_start[close_d + 4..];

        let time_sec = p_attr
            .split(',')
            .next()
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0);
        let text = decode_xml_entities(raw_text).trim().to_string();
        if text.chars().count() < 2 || text.len() > 140 {
            continue;
        }
        out.push(LyricLineItem {
            time_sec,
            end_sec: time_sec + 4.0,
            text,
            sub_text: Some("B站弹幕".to_string()),
            kind: "danmaku".to_string(),
        });
    }
    dedup_and_cap_danmaku(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wbi_signing_deterministic() {
        let keys = WbiKeys {
            img_key: "7cd084941338484aae1ad9425b84077c".into(),
            sub_key: "4932caff0ff746eab6f01bf08b70ac45".into(),
        };
        assert_eq!(keys.mixin_key(), "ea1db124af3c7062474693fa704f4ff8");

        let mut params = BTreeMap::new();
        params.insert("foo".into(), "114".into());
        params.insert("bar".into(), "514".into());
        params.insert("zab".into(), "1919810".into());

        let qs = sign_wbi_params_with_ts(params, &keys, "1702204169");
        assert_eq!(
            qs,
            "bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4"
        );
    }

    #[test]
    fn test_helpers_bvid_duration_url() {
        assert_eq!(
            extract_bvid("https://www.bilibili.com/video/BV1GJ411x7h7/?spm_id_from=333"),
            Some("BV1GJ411x7h7".into())
        );
        assert_eq!(extract_bvid("BV1GJ411x7h7"), Some("BV1GJ411x7h7".into()));
        assert_eq!(extract_bvid("not a bv"), None);
        assert_eq!(parse_duration_str("04:28"), 268);
        assert_eq!(parse_duration_str("1:02:03"), 3723);
        assert_eq!(
            normalize_bili_image_url("//i0.hdslb.com/bfs/archive/abc.jpg"),
            "https://i0.hdslb.com/bfs/archive/abc.jpg"
        );
        assert_eq!(
            normalize_bili_image_url("http://i1.hdslb.com/bfs/face/xyz.jpg"),
            "https://i1.hdslb.com/bfs/face/xyz.jpg"
        );
        assert_eq!(
            strip_search_highlight("<em class=\"keyword\">晴天</em> - 周杰伦"),
            "晴天 - 周杰伦"
        );
    }

    #[test]
    fn test_proto_danmaku_and_lrc_alignment() {
        // Synthetic protobuf: DmSegMobileReply { elems: DanmakuElem { progress: 2537, mode: 1, content: "前方高能" } }
        let msg_content = "前方高能".as_bytes();
        let mut elem = vec![0x10, 0xe9, 0x13, 0x18, 0x01, 0x3a, msg_content.len() as u8];
        elem.extend_from_slice(msg_content);
        let mut packet = vec![0x0a, elem.len() as u8];
        packet.extend_from_slice(&elem);

        let items = parse_danmaku_seg_proto(&packet);
        assert_eq!(items.len(), 1);
        assert!((items[0].time_sec - 2.537).abs() < 0.001);
        assert_eq!(items[0].text, "前方高能");
        assert_eq!(items[0].kind, "danmaku");

        // Multi-timestamp + [offset:-500] LRC alignment
        let lrc = "[offset:-500]\n[00:10.00][01:00.00]副歌一句\n[00:14.50]下一句\n[01:04.00]结尾";
        let lines = parse_lrc_lines(lrc, 90.0);
        assert_eq!(lines.len(), 4);
        assert!((lines[0].time_sec - 9.5).abs() < 0.01);
        assert!((lines[0].end_sec - 14.0).abs() < 0.01);
        assert_eq!(lines[0].text, "副歌一句");
        assert!((lines[2].time_sec - 59.5).abs() < 0.01);
        assert!((lines[2].end_sec - 63.5).abs() < 0.01);

        // Song alignment validation & filtering
        let sample_lrc = vec![
            LyricLineItem { time_sec: 1.0, end_sec: 5.0, text: "line 1".into(), sub_text: None, kind: "lrc".into() },
            LyricLineItem { time_sec: 5.0, end_sec: 9.0, text: "line 2".into(), sub_text: None, kind: "lrc".into() },
            LyricLineItem { time_sec: 9.0, end_sec: 13.0, text: "line 3".into(), sub_text: None, kind: "lrc".into() },
        ];
        assert!(score_lyric_candidate("晴天", "周杰伦", 269, "晴天", "周杰伦", 270.0, &sample_lrc).is_some());
        assert!(score_lyric_candidate("Trigger", "", 210, "Chrono Trigger", "", 119.0, &sample_lrc).is_none());

        let (song, artist) = extract_song_and_artist_hint(
            "【周杰伦】晴天 (Live)",
            "02 - 晴天 (P2)",
            "02 - 晴天",
            "周杰伦",
        );
        assert_eq!(song, "晴天");
        assert_eq!(artist, "周杰伦");
    }

    #[tokio::test]
    async fn test_live_guest_search_and_related() {
        let mut client = BiliClient::new().expect("client");
        let items = client.search_videos("周杰伦 晴天", 1).await.expect("live search");
        assert!(!items.is_empty(), "expected non-empty Bilibili search results");
        assert!(items[0].pic.starts_with("https://") || items[0].pic.is_empty());

        let rel = client
            .get_related_videos("BV1GJ411x7h7")
            .await
            .expect("live related");
        assert!(!rel.is_empty(), "expected non-empty related videos");
    }
}
