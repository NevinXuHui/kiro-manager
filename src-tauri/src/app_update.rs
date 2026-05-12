use futures::StreamExt;
use reqwest::header::{ACCEPT, USER_AGENT};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::io::AsyncWriteExt;

const REPO_OWNER: &str = "NeuraLabHQ";
const REPO_NAME: &str = "kiro-manager";
const FALLBACK_ASSET_NAME: &str = "kiro-manager-update";

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
    published_at: Option<String>,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAsset {
    name: String,
    download_url: String,
    size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current_version: String,
    latest_version: String,
    has_update: bool,
    release_name: String,
    release_notes: String,
    release_url: String,
    published_at: Option<String>,
    assets: Vec<UpdateAsset>,
}

fn update_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("创建更新客户端失败: {}", e))
}

pub(crate) fn is_newer_version(current: &str, latest: &str) -> bool {
    let current_parts = parse_version_parts(current);
    let latest_parts = parse_version_parts(latest);

    for index in 0..3 {
        let current_part = *current_parts.get(index).unwrap_or(&0);
        let latest_part = *latest_parts.get(index).unwrap_or(&0);

        if latest_part > current_part {
            return true;
        }

        if latest_part < current_part {
            return false;
        }
    }

    false
}

fn parse_version_parts(version: &str) -> Vec<u64> {
    version
        .trim()
        .trim_start_matches('v')
        .trim_start_matches('V')
        .split('.')
        .take(3)
        .map(|part| {
            part.chars()
                .take_while(|ch| ch.is_ascii_digit())
                .collect::<String>()
                .parse::<u64>()
                .unwrap_or(0)
        })
        .collect()
}

pub(crate) fn sanitize_asset_name(name: &str) -> String {
    let cleaned = name
        .replace('\\', "/")
        .split('/')
        .filter(|part| !part.is_empty() && *part != "." && *part != "..")
        .last()
        .unwrap_or(FALLBACK_ASSET_NAME)
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '|' | '?' | '*' => '-',
            _ => ch,
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();

    if cleaned.is_empty() {
        FALLBACK_ASSET_NAME.to_string()
    } else {
        cleaned
    }
}

fn update_download_dir() -> PathBuf {
    dirs::download_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("Kiro Manager Updates")
}

fn validate_download_url(download_url: &str) -> Result<(), String> {
    let expected_prefix = format!(
        "https://github.com/{}/{}/releases/download/",
        REPO_OWNER, REPO_NAME
    );

    if download_url.starts_with(&expected_prefix) {
        Ok(())
    } else {
        Err("下载地址不是官方 GitHub Release 资产".to_string())
    }
}

#[tauri::command]
pub async fn check_for_updates() -> Result<UpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let releases_url = format!(
        "https://api.github.com/repos/{}/{}/releases/latest",
        REPO_OWNER, REPO_NAME
    );

    let release = update_client()?
        .get(&releases_url)
        .header(USER_AGENT, format!("{}/{}", REPO_NAME, current_version))
        .header(ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("检查更新失败: {}", e))?;

    if !release.status().is_success() {
        return Err(format!("检查更新失败: GitHub 返回 {}", release.status()));
    }

    let release = release
        .json::<GitHubRelease>()
        .await
        .map_err(|e| format!("解析更新信息失败: {}", e))?;

    let latest_version = release.tag_name.trim_start_matches(['v', 'V']).to_string();
    let assets = release
        .assets
        .into_iter()
        .map(|asset| UpdateAsset {
            name: asset.name,
            download_url: asset.browser_download_url,
            size: asset.size,
        })
        .collect();

    Ok(UpdateInfo {
        has_update: is_newer_version(&current_version, &release.tag_name),
        current_version,
        latest_version,
        release_name: release.name.unwrap_or(release.tag_name),
        release_notes: release.body.unwrap_or_default(),
        release_url: release.html_url,
        published_at: release.published_at,
        assets,
    })
}

#[tauri::command]
pub async fn download_update_asset(download_url: String, file_name: String) -> Result<String, String> {
    validate_download_url(&download_url)?;

    let file_name = sanitize_asset_name(&file_name);
    let update_dir = update_download_dir();
    tokio::fs::create_dir_all(&update_dir)
        .await
        .map_err(|e| format!("创建更新下载目录失败: {}", e))?;

    let file_path = update_dir.join(file_name);
    let response = update_client()?
        .get(&download_url)
        .header(USER_AGENT, REPO_NAME)
        .send()
        .await
        .map_err(|e| format!("下载更新失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("下载更新失败: GitHub 返回 {}", response.status()));
    }

    let mut file = tokio::fs::File::create(&file_path)
        .await
        .map_err(|e| format!("创建安装包文件失败: {}", e))?;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("写入更新文件失败: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入更新文件失败: {}", e))?;
    }

    file.flush()
        .await
        .map_err(|e| format!("保存更新文件失败: {}", e))?;

    opener::open(&file_path).map_err(|e| format!("启动安装包失败: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::{is_newer_version, sanitize_asset_name};

    #[test]
    fn detects_newer_semver_with_optional_v_prefix() {
        assert!(is_newer_version("2.0.5", "v2.0.6"));
        assert!(is_newer_version("2.0.5", "2.1.0"));
        assert!(!is_newer_version("2.0.5", "v2.0.5"));
        assert!(!is_newer_version("2.0.5", "v2.0.4"));
    }

    #[test]
    fn sanitizes_download_asset_names() {
        assert_eq!(sanitize_asset_name("../Kiro Manager Setup.exe"), "Kiro Manager Setup.exe");
        assert_eq!(sanitize_asset_name(""), "kiro-manager-update");
    }
}
