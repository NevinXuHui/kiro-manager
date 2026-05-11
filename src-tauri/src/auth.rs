// 账号验证模块
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

/// 全局共享的 HTTP 客户端，复用 TCP/TLS 连接，避免每次请求都重建连接
fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .pool_max_idle_per_host(64)
            .pool_idle_timeout(Duration::from_secs(90))
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .tcp_nodelay(true)
            .build()
            .expect("Failed to create HTTP client")
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VerifyCredentialsResponse {
    pub success: bool,
    pub data: Option<AccountData>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AccountData {
    pub email: String,
    pub user_id: String,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: Option<u64>,
    pub subscription_type: String,
    pub subscription_title: String,
    pub usage: UsageData,
    pub days_remaining: Option<u32>,
    pub expires_at: Option<u64>,
    pub raw_type: Option<String>,
    pub management_target: Option<String>,
    pub upgrade_capability: Option<String>,
    pub overage_capability: Option<String>,
    pub overage_status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UsageData {
    pub current: f64,
    pub limit: f64,
    #[serde(rename = "nextResetDate")]
    pub next_reset_date: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverageConfiguration {
    overage_status: Option<String>,
}

// AWS OIDC Token 响应
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OidcTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
}

// Kiro GetUserInfo 响应
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct UserInfoResponse {
    email: Option<String>,
    user_id: Option<String>,
    idp: Option<String>,
    status: Option<String>,
}

// Kiro Usage 响应
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageBreakdown {
    resource_type: Option<String>,
    display_name: Option<String>,
    current_usage: Option<f64>,
    current_usage_with_precision: Option<f64>,
    usage_limit: Option<f64>,
    usage_limit_with_precision: Option<f64>,
    free_trial_info: Option<FreeTrialInfo>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct FreeTrialInfo {
    free_trial_status: Option<String>,
    #[serde(deserialize_with = "deserialize_timestamp_or_string")]
    free_trial_expiry: Option<String>,
    current_usage: Option<f64>,
    current_usage_with_precision: Option<f64>,
    usage_limit: Option<f64>,
    usage_limit_with_precision: Option<f64>,
}

// 自定义反序列化函数：支持数字或字符串
fn deserialize_timestamp_or_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{self, Deserialize};
    
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum TimestampOrString {
        Timestamp(f64),
        String(String),
    }
    
    match Option::<TimestampOrString>::deserialize(deserializer)? {
        None => Ok(None),
        Some(TimestampOrString::Timestamp(ts)) => {
            // 将 Unix 时间戳（秒）转换为 ISO 字符串
            let datetime = chrono::DateTime::from_timestamp(ts as i64, (ts.fract() * 1_000_000_000.0) as u32)
                .ok_or_else(|| de::Error::custom("invalid timestamp"))?;
            Ok(Some(datetime.to_rfc3339()))
        }
        Some(TimestampOrString::String(s)) => Ok(Some(s)),
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageLimitsResponse {
    usage_breakdown_list: Option<Vec<UsageBreakdown>>,
    subscription_info: Option<SubscriptionInfo>,
    overage_configuration: Option<OverageConfiguration>,
    user_info: Option<UserInfo>,
    #[serde(deserialize_with = "deserialize_timestamp_or_string")]
    next_date_reset: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SubscriptionInfo {
    #[serde(alias = "type")]
    subscription_type: Option<String>,
    subscription_title: Option<String>,
    raw_type: Option<String>,
    #[serde(alias = "subscriptionManagementTarget")]
    management_target: Option<String>,
    upgrade_capability: Option<String>,
    overage_capability: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OverageResponse {
    pub success: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn get_latest_kiro_profile_arn() -> Result<Option<String>, String> {
    let appdata = std::env::var("APPDATA").map_err(|e| format!("读取 APPDATA 失败: {}", e))?;
    let kiro_dir = PathBuf::from(appdata).join("Kiro");
    let profile_path = kiro_dir
        .join("User")
        .join("globalStorage")
        .join("kiro.kiroagent")
        .join("profile.json");

    if let Some(profile_arn) = read_profile_arn_from_profile_json(&profile_path) {
        println!(
            "[ProfileArn] 已从 Kiro profile.json 读取: {}",
            mask_profile_arn(&profile_arn)
        );
        return Ok(Some(profile_arn));
    }

    let logs_dir = kiro_dir.join("logs");
    let profile_arn = find_latest_profile_arn(&logs_dir);
    if let Some(ref arn) = profile_arn {
        println!("[ProfileArn] 已从 Kiro 日志读取: {}", mask_profile_arn(arn));
    } else {
        println!("[ProfileArn] 未在 Kiro 日志中找到 profileArn");
    }
    Ok(profile_arn)
}

fn read_profile_arn_from_profile_json(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    let value = serde_json::from_str::<serde_json::Value>(&content).ok()?;
    let arn = value.get("arn").and_then(|v| v.as_str())?;
    if arn.starts_with("arn:aws:codewhisperer:") {
        Some(arn.to_string())
    } else {
        None
    }
}

fn find_latest_profile_arn(logs_dir: &Path) -> Option<String> {
    let mut log_files = Vec::new();
    collect_q_client_logs(logs_dir, &mut log_files);
    log_files.sort_by_key(|path| {
        fs::metadata(path)
            .and_then(|m| m.modified())
            .ok()
    });
    log_files.reverse();

    for path in log_files.into_iter().take(24) {
        if let Ok(content) = fs::read_to_string(path) {
            if let Some(profile_arn) = extract_profile_arn(&content) {
                return Some(profile_arn);
            }
        }
    }

    None
}

fn collect_q_client_logs(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_q_client_logs(&path, out);
        } else if path.file_name().and_then(|name| name.to_str()) == Some("q-client.log") {
            out.push(path);
        }
    }
}

fn extract_profile_arn(content: &str) -> Option<String> {
    let marker = "\"profileArn\":\"";
    content
        .match_indices(marker)
        .filter_map(|(start, _)| {
            let value_start = start + marker.len();
            let rest = &content[value_start..];
            let value_end = rest.find('"')?;
            let value = &rest[..value_end];
            if value.starts_with("arn:aws:codewhisperer:") {
                Some(value.to_string())
            } else {
                None
            }
        })
        .last()
}

fn mask_profile_arn(profile_arn: &str) -> String {
    let Some((prefix, suffix)) = profile_arn.rsplit_once('/') else {
        return profile_arn.to_string();
    };
    let visible = suffix.chars().take(4).collect::<String>();
    format!("{}/{}...", prefix, visible)
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct UserInfo {
    email: Option<String>,
    user_id: Option<String>,
}

async fn refresh_desktop_auth_token(refresh_token: &str) -> Result<OidcTokenResponse, String> {
    let url = "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken";
    let payload = json!({
        "refreshToken": refresh_token
    });

    println!("[验证] 使用 Kiro Desktop Auth refreshToken 接口");

    let response = http_client()
        .post(url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Kiro Desktop Auth 请求失败: {}", e))?;

    let status = response.status();
    let response_text = response.text().await.unwrap_or_default();
    println!("[验证] Kiro Desktop Auth 响应状态: {}", status);

    if !status.is_success() {
        let message = serde_json::from_str::<serde_json::Value>(&response_text)
            .ok()
            .and_then(|value| {
                value
                    .get("message")
                    .and_then(|m| m.as_str())
                    .or_else(|| value.get("error").and_then(|e| e.as_str()))
                    .map(|s| s.to_string())
            })
            .unwrap_or(response_text);

        return Err(if message.is_empty() {
            format!("Kiro Desktop Auth 刷新失败 ({})", status)
        } else {
            format!("Kiro Desktop Auth 刷新失败 ({}): {}", status, message)
        });
    }

    serde_json::from_str::<OidcTokenResponse>(&response_text)
        .map_err(|e| format!("解析 Kiro Desktop Auth 响应失败: {}", e))
}

// 核心验证函数
#[tauri::command]
pub async fn verify_account_credentials(
    refresh_token: String,
    client_id: String,
    client_secret: String,
    region: Option<String>,
) -> Result<VerifyCredentialsResponse, String> {
    let region = region.unwrap_or_else(|| "us-east-1".to_string());
    let refresh_token = refresh_token.trim().to_string();
    let client_id = client_id.trim().to_string();
    let client_secret = client_secret.trim().to_string();
    
    println!("[验证] 开始验证账号凭证");
    println!("[验证] Region: {}", region);
    if client_id.is_empty() {
        println!("[验证] Client ID: <empty>");
    } else {
        println!("[验证] Client ID: {}...", &client_id[..client_id.len().min(20)]);
    }
    
    // 步骤 1: 使用 refresh_token 获取 access_token
    let client = http_client();

    let oidc_data: OidcTokenResponse = if client_id.is_empty() || client_secret.is_empty() {
        match refresh_desktop_auth_token(&refresh_token).await {
            Ok(data) => data,
            Err(error) => {
                return Ok(VerifyCredentialsResponse {
                    success: false,
                    data: None,
                    error: Some(error),
                });
            }
        }
    } else {
        let oidc_url = format!("https://oidc.{}.amazonaws.com/token", region);
        // 备用 URL: sso-oidc 端点
        let sso_oidc_url = format!("https://sso-oidc.{}.amazonaws.com/token", region);
        println!("[验证] OIDC URL: {}", oidc_url);
        println!("[验证] SSO-OIDC URL (备用): {}", sso_oidc_url);

        let oidc_payload = json!({
            "clientId": &client_id,
            "clientSecret": &client_secret,
            "refreshToken": &refresh_token,
            "grantType": "refresh_token"
        });

        // 先尝试 oidc 端点，失败则回退到 sso-oidc 端点
        println!("[验证] 发送 OIDC 请求...");
        let oidc_response = {
            let resp = client
                .post(&oidc_url)
                .header("Content-Type", "application/json")
                .json(&oidc_payload)
                .send()
                .await;

            match resp {
                Ok(r) if r.status().is_success() => r,
                _ => {
                    println!("[验证] 主 OIDC 端点失败，尝试 sso-oidc 备用端点...");
                    client
                        .post(&sso_oidc_url)
                        .header("Content-Type", "application/json")
                        .json(&oidc_payload)
                        .send()
                        .await
                        .map_err(|e| format!("OIDC 请求失败: {}", e))?
                }
            }
        };

        println!("[验证] OIDC 响应状态: {}", oidc_response.status());

        if !oidc_response.status().is_success() {
            let status = oidc_response.status();
            let error_text = oidc_response.text().await.unwrap_or_default();
            return Ok(VerifyCredentialsResponse {
                success: false,
                data: None,
                error: Some(format!("OIDC 认证失败 ({}): {}", status, error_text)),
            });
        }

        oidc_response
            .json()
            .await
            .map_err(|e| format!("解析 OIDC 响应失败: {}", e))?
    };
    
    println!("[OIDC] Token 刷新成功");
    println!("[OIDC] Access Token 长度: {}", oidc_data.access_token.len());
    println!("[OIDC] Expires In: {} 秒", oidc_data.expires_in);
    
    let access_token = oidc_data.access_token;
    let new_refresh_token = oidc_data.refresh_token.unwrap_or(refresh_token);
    let expires_in = oidc_data.expires_in;
    
    // 步骤 2: 使用 access_token 获取用户信息和使用量
    let api_base = if region.starts_with("eu-") {
        "https://q.eu-central-1.amazonaws.com"
    } else {
        "https://q.us-east-1.amazonaws.com"
    };
    
    println!("[验证] API Base: {}", api_base);

    // 步骤 2: 并发发起 ListAvailableModels（封号检测）+ GetUsageLimits（用量数据）
    // 两个接口都用同一份 access_token，用 tokio::join! 并发执行可省去一次 RTT
    let models_url = format!("{}/ListAvailableModels?origin=AI_EDITOR", api_base);
    let usage_url = format!(
        "{}/getUsageLimits?origin=AI_EDITOR&resourceType=AGENTIC_REQUEST&isEmailRequired=true",
        api_base
    );
    let bearer = format!("Bearer {}", access_token);
    let user_agent = "aws-sdk-rust/1.3.9 os/windows lang/rust/1.87.0";
    let x_amz_ua = "aws-sdk-rust/1.3.9 ua/2.1 api/ssooidc/1.88.0 os/windows lang/rust/1.87.0 m/E app/KiroManager";

    println!("[验证] 并发发送 ListAvailableModels + GetUsageLimits 请求...");

    let models_future = client
        .get(&models_url)
        .header("Accept", "application/json")
        .header("Authorization", &bearer)
        .header("User-Agent", user_agent)
        .header("x-amz-user-agent", x_amz_ua)
        .send();

    let usage_future = client
        .get(&usage_url)
        .header("Accept", "application/json")
        .header("Authorization", &bearer)
        .header("User-Agent", user_agent)
        .header("x-amz-user-agent", x_amz_ua)
        .send();

    let (models_resp, usage_resp) = tokio::join!(models_future, usage_future);

    // 处理 ListAvailableModels：封号检测
    if let Ok(resp) = models_resp {
        let status = resp.status();
        println!("[验证] ListAvailableModels 响应状态: {}", status);

        if status.as_u16() == 403 {
            let error_text = resp.text().await.unwrap_or_default();
            println!("[API] ListAvailableModels 403 响应: {}", error_text);

            if let Ok(error_json) = serde_json::from_str::<serde_json::Value>(&error_text) {
                let reason = error_json.get("reason").and_then(|r| r.as_str());
                let message = error_json.get("message").and_then(|m| m.as_str());

                let suspended_error = match reason {
                    Some("TEMPORARILY_SUSPENDED") => Some("账号已被临时封禁".to_string()),
                    Some("PERMANENTLY_SUSPENDED") => Some("账号已被永久封禁".to_string()),
                    Some(other) => Some(format!("账号访问受限: {}", other)),
                    None => message.map(|m| m.to_string()),
                };

                if let Some(err) = suspended_error {
                    // 从 message 提取 user_id：格式为 "Your User ID (xxxxxxxx-xxxx-...)"
                    let extracted_user_id = message
                        .and_then(|msg| {
                            let start = msg.find('(')?;
                            let end = msg[start + 1..].find(')')?;
                            let id = msg[start + 1..start + 1 + end].trim();
                            if id.is_empty() { None } else { Some(id.to_string()) }
                        })
                        .unwrap_or_default();

                    println!("[验证] 检测到账号被封禁: {} (user_id={})", err, extracted_user_id);

                    // 即使被封禁，仍然返回已获取到的部分数据（access_token / refresh_token / user_id）
                    // 让前端能把封号账号存进列表，而不是丢弃
                    return Ok(VerifyCredentialsResponse {
                        success: false,
                        data: Some(AccountData {
                            email: String::new(),
                            user_id: extracted_user_id,
                            access_token: access_token.clone(),
                            refresh_token: new_refresh_token.clone(),
                            expires_in: Some(expires_in),
                            subscription_type: "FREE".to_string(),
                            subscription_title: "KIRO FREE".to_string(),
                            usage: UsageData {
                                current: 0.0,
                                limit: 0.0,
                                next_reset_date: None,
                            },
                            days_remaining: None,
                            expires_at: None,
                            raw_type: Some("FREE".to_string()),
                            management_target: None,
                            upgrade_capability: None,
                            overage_capability: None,
                            overage_status: None,
                        }),
                        error: Some(err),
                    });
                }
            }
        }
    } else if let Err(e) = &models_resp {
        println!("[验证] ListAvailableModels 请求出错（忽略，继续走 usage 流程）: {}", e);
    }

    // 处理 GetUsageLimits 响应（已并发完成）
    let usage_response = usage_resp.map_err(|e| format!("获取使用量失败: {}", e))?;

    println!("[验证] GetUsageLimits 响应状态: {}", usage_response.status());
    
    if !usage_response.status().is_success() {
        let status = usage_response.status();
        let error_text = usage_response.text().await.unwrap_or_default();
        println!("[API] GetUsageLimits 失败: {} - {}", status, error_text);

        // 解析错误响应，提取友好的错误信息
        let friendly_error = if status.as_u16() == 403 {
            if let Ok(error_json) = serde_json::from_str::<serde_json::Value>(&error_text) {
                // 优先使用 message 字段
                if let Some(message) = error_json.get("message").and_then(|m| m.as_str()) {
                    message.to_string()
                } else if let Some(reason) = error_json.get("reason").and_then(|r| r.as_str()) {
                    match reason {
                        "TEMPORARILY_SUSPENDED" => "账号已被临时封禁".to_string(),
                        "PERMANENTLY_SUSPENDED" => "账号已被永久封禁".to_string(),
                        _ => format!("账号访问受限: {}", reason)
                    }
                } else {
                    "账号访问被拒绝 (403)".to_string()
                }
            } else {
                "账号访问被拒绝 (403)".to_string()
            }
        } else {
            format!("获取使用量失败 ({})", status)
        };

        return Ok(VerifyCredentialsResponse {
            success: false,
            data: None,
            error: Some(friendly_error),
        });
    }
    
    // 读取原始响应文本
    let response_text = usage_response.text().await.map_err(|e| {
        println!("[API] 读取响应文本失败: {}", e);
        format!("读取响应文本失败: {}", e)
    })?;
    
    println!("[API] 原始响应: {}", &response_text[..response_text.len().min(500)]);
    
    let usage_data: UsageLimitsResponse = serde_json::from_str(&response_text).map_err(|e| {
        println!("[API] 解析 JSON 失败: {}", e);
        println!("[API] 完整响应: {}", response_text);
        format!("解析使用量响应失败: {}", e)
    })?;
    
    println!("[API] 使用量响应: {}", serde_json::to_string_pretty(&usage_data).unwrap_or_else(|e| format!("序列化失败: {}", e)));
    
    // 提取用户信息
    let email = usage_data
        .user_info
        .as_ref()
        .and_then(|u| u.email.clone())
        .unwrap_or_else(|| "unknown@example.com".to_string());
    
    let user_id = usage_data
        .user_info
        .as_ref()
        .and_then(|u| u.user_id.clone())
        .unwrap_or_else(|| "unknown".to_string());
    
    println!("[API] 用户邮箱: {}", email);
    println!("[API] 用户 ID: {}", user_id);
    
    // 提取订阅信息
    let subscription_type = usage_data
        .subscription_info
        .as_ref()
        .and_then(|s| s.subscription_type.clone())
        .unwrap_or_else(|| "FREE".to_string());
    
    let subscription_title = usage_data
        .subscription_info
        .as_ref()
        .and_then(|s| s.subscription_title.clone())
        .unwrap_or_else(|| "KIRO FREE".to_string());

    let raw_type = usage_data
        .subscription_info
        .as_ref()
        .and_then(|s| s.raw_type.clone())
        .or_else(|| Some(subscription_type.clone()));

    let management_target = usage_data
        .subscription_info
        .as_ref()
        .and_then(|s| s.management_target.clone());

    let upgrade_capability = usage_data
        .subscription_info
        .as_ref()
        .and_then(|s| s.upgrade_capability.clone());

    let overage_capability = usage_data
        .subscription_info
        .as_ref()
        .and_then(|s| s.overage_capability.clone());

    let overage_status = usage_data
        .overage_configuration
        .as_ref()
        .and_then(|config| config.overage_status.clone());
    
    println!("[API] 订阅类型: {}", subscription_type);
    println!("[API] 订阅标题: {}", subscription_title);
    
    // 提取使用量
    let (current_usage, usage_limit, days_remaining) = extract_usage_info(&usage_data);
    
    println!("[API] 最终总使用量: {} / {}", current_usage, usage_limit);
    if let Some(days) = days_remaining {
        println!("[API] 剩余天数: {} 天", days);
    }
    
    // 提取下次重置时间
    let next_reset_date = usage_data.next_date_reset.clone();
    if let Some(ref reset_date) = next_reset_date {
        println!("[API] 下次重置: {}", reset_date);
    }
    
    println!("[验证] 账号验证成功");
    
    Ok(VerifyCredentialsResponse {
        success: true,
        data: Some(AccountData {
            email,
            user_id,
            access_token,
            refresh_token: new_refresh_token,
            expires_in: Some(expires_in),
            subscription_type,
            subscription_title,
            usage: UsageData {
                current: current_usage,
                limit: usage_limit,
                next_reset_date,
            },
            days_remaining,
            expires_at: None,
            raw_type,
            management_target,
            upgrade_capability,
            overage_capability,
            overage_status,
        }),
        error: None,
    })
}

// 提取使用量信息的辅助函数
fn extract_usage_info(usage_data: &UsageLimitsResponse) -> (f64, f64, Option<u32>) {
    let mut current_usage = 0.0;
    let mut usage_limit = 50.0;
    let mut days_remaining: Option<u32> = None;
    
    println!("[API] 开始提取使用量信息...");
    
    if let Some(breakdowns) = &usage_data.usage_breakdown_list {
        println!("[API] 找到 {} 个使用量条目", breakdowns.len());
        
        for breakdown in breakdowns {
            if let Some(resource_type) = &breakdown.resource_type {
                println!("[API] 检查资源类型: {}", resource_type);
                
                // 支持 CREDIT 和 AGENT_INTERACTIONS 两种类型
                if resource_type == "CREDIT" || resource_type == "AGENT_INTERACTIONS" {
                    // 月度使用量（优先使用带精度的字段）
                    let monthly_current = breakdown.current_usage_with_precision
                        .or(breakdown.current_usage)
                        .unwrap_or(0.0);
                    let monthly_limit = breakdown.usage_limit_with_precision
                        .or(breakdown.usage_limit)
                        .unwrap_or(50.0);
                    
                    println!("[API] 资源类型匹配: {}", resource_type);
                    println!("[API] 月度使用量: {} / {}", monthly_current, monthly_limit);
                    
                    // 提取免费试用信息
                    if let Some(free_trial) = &breakdown.free_trial_info {
                        let trial_current = free_trial.current_usage_with_precision
                            .or(free_trial.current_usage)
                            .unwrap_or(0.0);
                        let trial_limit = free_trial.usage_limit_with_precision
                            .or(free_trial.usage_limit)
                            .unwrap_or(0.0);
                        
                        println!("[API] 找到免费试用信息");
                        println!("[API] 免费试用使用量: {} / {}", trial_current, trial_limit);
                        
                        // 总使用量 = 月度使用量 + 免费试用使用量
                        current_usage = monthly_current + trial_current;
                        usage_limit = monthly_limit + trial_limit;
                        
                        println!("[API] 计算总使用量: {} + {} = {}", monthly_current, trial_current, current_usage);
                        println!("[API] 计算总额度: {} + {} = {}", monthly_limit, trial_limit, usage_limit);
                        
                        // 提取免费试用到期时间
                        if let Some(expiry) = &free_trial.free_trial_expiry {
                            if let Ok(expiry_time) = chrono::DateTime::parse_from_rfc3339(expiry) {
                                let now = chrono::Utc::now();
                                let duration = expiry_time.signed_duration_since(now);
                                days_remaining = Some(duration.num_days().max(0) as u32);
                            }
                        }
                    } else {
                        println!("[API] 没有免费试用信息");
                        current_usage = monthly_current;
                        usage_limit = monthly_limit;
                    }
                    
                    break;
                }
            }
        }
    } else {
        println!("[API] 没有找到使用量列表");
    }
    
    (current_usage, usage_limit, days_remaining)
}

#[tauri::command]
pub async fn enable_overages(
    access_token: String,
    profile_arn: String,
    region: Option<String>,
) -> Result<OverageResponse, String> {
    if access_token.trim().is_empty() {
        return Ok(OverageResponse {
            success: false,
            error: Some("缺少 Access Token".to_string()),
        });
    }

    if profile_arn.trim().is_empty() {
        return Ok(OverageResponse {
            success: false,
            error: Some("缺少 profileArn".to_string()),
        });
    }

    if !profile_arn.starts_with("arn:aws:codewhisperer:") {
        return Ok(OverageResponse {
            success: false,
            error: Some("profileArn 格式不正确，请先打开 Kiro 登录一次后再试".to_string()),
        });
    }

    let region = region.unwrap_or_else(|| "us-east-1".to_string());
    let api_base = if region.starts_with("eu-") {
        "https://q.eu-central-1.amazonaws.com"
    } else {
        "https://q.us-east-1.amazonaws.com"
    };
    let url = format!("{}/setUserPreference", api_base);
    let payload = json!({
        "profileArn": profile_arn,
        "overageConfiguration": {
            "overageStatus": "ENABLED"
        }
    });

    println!("[Overages] 开始开通超额配置");
    println!("[Overages] API Base: {}", api_base);
    println!("[Overages] ProfileArn: {}", mask_profile_arn(&profile_arn));

    let response = http_client()
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .header("Authorization", format!("Bearer {}", access_token))
        .json(&payload)
        .send()
        .await
        .map_err(|e| {
            println!("[Overages] 请求发送失败: {}", e);
            format!("开通 Overages 请求失败: {}", e)
        })?;

    let status = response.status();
    let response_text = response.text().await.unwrap_or_default();
    println!("[Overages] 响应状态: {}", status);

    if status.is_success() {
        return Ok(OverageResponse {
            success: true,
            error: None,
        });
    }

    let friendly_error = serde_json::from_str::<serde_json::Value>(&response_text)
        .ok()
        .and_then(|value| {
            value
                .get("message")
                .and_then(|m| m.as_str())
                .or_else(|| value.get("reason").and_then(|r| r.as_str()))
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| {
            if response_text.is_empty() {
                format!("API 返回错误: {}", status)
            } else {
                format!("API 返回错误 ({}): {}", status, response_text)
            }
        });

    Ok(OverageResponse {
        success: false,
        error: Some(friendly_error),
    })
}
