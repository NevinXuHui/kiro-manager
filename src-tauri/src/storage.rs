// 本地存储管理模块
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

// 获取工程 data 目录路径
fn get_data_dir() -> Result<PathBuf, String> {
    let tauri_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let project_dir = tauri_dir
        .parent()
        .ok_or_else(|| "无法获取工程目录".to_string())?;
    let data_dir = project_dir.join("data");

    fs::create_dir_all(&data_dir).map_err(|e| format!("创建数据目录失败: {}", e))?;

    Ok(data_dir)
}

// 获取旧版本数据目录路径，用于自动迁移已有账号数据
fn get_legacy_data_dir() -> Result<PathBuf, String> {
    let home_dir = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "无法获取用户目录".to_string())?;

    Ok(PathBuf::from(home_dir).join("kiro manager"))
}

fn get_accounts_db_path(data_dir: &PathBuf) -> PathBuf {
    data_dir.join("accounts.sqlite")
}

fn current_timestamp_millis() -> Result<i64, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("生成时间戳失败: {}", e))?
        .as_millis();

    Ok(millis as i64)
}

fn open_accounts_db(data_dir: &PathBuf) -> Result<Connection, String> {
    let db_path = get_accounts_db_path(data_dir);
    let conn = Connection::open(db_path).map_err(|e| format!("打开账号数据库失败: {}", e))?;

    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS accounts (
            id TEXT PRIMARY KEY NOT NULL,
            data TEXT NOT NULL,
            sort_order INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_accounts_sort_order ON accounts(sort_order);

        CREATE TABLE IF NOT EXISTS storage_meta (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );
        "#,
    )
    .map_err(|e| format!("初始化账号数据库失败: {}", e))?;

    Ok(conn)
}

fn normalize_accounts_value(value: Value) -> Result<Vec<Value>, String> {
    match value {
        Value::Array(accounts) => Ok(accounts),
        Value::Object(mut object) => match object.remove("accounts") {
            Some(Value::Array(accounts)) => Ok(accounts),
            _ => Err("账号数据必须是数组或包含 accounts 数组".to_string()),
        },
        _ => Err("账号数据必须是数组".to_string()),
    }
}

fn parse_accounts_json_strict(data: &str) -> Result<Vec<Value>, String> {
    let value = serde_json::from_str::<Value>(data)
        .map_err(|e| format!("解析账号 JSON 失败: {}", e))?;

    normalize_accounts_value(value)
}

fn parse_accounts_json_for_migration(data: &str) -> Result<Vec<Value>, String> {
    match parse_accounts_json_strict(data) {
        Ok(accounts) => Ok(accounts),
        Err(strict_error) => {
            let mut deserializer = serde_json::Deserializer::from_str(data);
            let value = Value::deserialize(&mut deserializer)
                .map_err(|_| strict_error)?;

            normalize_accounts_value(value)
        }
    }
}

fn account_id_for_storage(account: &mut Value, index: usize, seen_ids: &mut HashSet<String>) -> String {
    let existing_id = account
        .get("id")
        .and_then(|id| id.as_str())
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(ToString::to_string);

    let mut id = existing_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    if seen_ids.contains(&id) {
        id = Uuid::new_v4().to_string();
    }
    seen_ids.insert(id.clone());

    if let Value::Object(object) = account {
        object.insert("id".to_string(), Value::String(id.clone()));
    }

    if id.is_empty() {
        format!("account-{}", index + 1)
    } else {
        id
    }
}

fn save_accounts_to_db(conn: &mut Connection, accounts: Vec<Value>) -> Result<(), String> {
    let updated_at = current_timestamp_millis()?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("创建账号保存事务失败: {}", e))?;

    tx.execute("DELETE FROM accounts", [])
        .map_err(|e| format!("清空旧账号数据失败: {}", e))?;

    let mut seen_ids = HashSet::new();
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO accounts (id, data, sort_order, updated_at) VALUES (?1, ?2, ?3, ?4)",
            )
            .map_err(|e| format!("准备账号写入语句失败: {}", e))?;

        for (index, account) in accounts.into_iter().enumerate() {
            let mut account = account;
            let id = account_id_for_storage(&mut account, index, &mut seen_ids);
            let data = serde_json::to_string(&account)
                .map_err(|e| format!("序列化账号数据失败: {}", e))?;

            stmt.execute(params![id, data, index as i64, updated_at])
                .map_err(|e| format!("写入账号数据失败: {}", e))?;
        }
    }

    tx.execute(
        "INSERT INTO storage_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params!["storage_version", "sqlite-v1"],
    )
    .map_err(|e| format!("写入存储版本失败: {}", e))?;

    tx.commit()
        .map_err(|e| format!("提交账号保存事务失败: {}", e))?;

    Ok(())
}

fn load_accounts_from_db(conn: &Connection) -> Result<String, String> {
    let mut stmt = conn
        .prepare("SELECT data FROM accounts ORDER BY sort_order ASC, rowid ASC")
        .map_err(|e| format!("准备读取账号语句失败: {}", e))?;

    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("读取账号数据失败: {}", e))?;

    let mut accounts = Vec::new();
    for row in rows {
        let data = row.map_err(|e| format!("读取账号行失败: {}", e))?;
        let account = serde_json::from_str::<Value>(&data)
            .map_err(|e| format!("数据库账号 JSON 损坏: {}", e))?;
        accounts.push(account);
    }

    serde_json::to_string(&accounts).map_err(|e| format!("序列化账号列表失败: {}", e))
}

fn accounts_count(conn: &Connection) -> Result<i64, String> {
    conn.query_row("SELECT COUNT(*) FROM accounts", [], |row| row.get(0))
        .map_err(|e| format!("统计账号数量失败: {}", e))
}

// 首次切换到 SQLite 时，从旧 JSON 文件导入已有账号数据，避免看起来像数据丢失
fn migrate_legacy_accounts_if_needed(data_dir: &PathBuf, conn: &mut Connection) -> Result<(), String> {
    if accounts_count(conn)? > 0 {
        return Ok(());
    }

    let mut candidates = vec![
        data_dir.join("accounts.json"),
        data_dir.join("accounts.repaired.json"),
        data_dir.join("accounts.backup.json"),
    ];
    candidates.push(get_legacy_data_dir()?.join("accounts.json"));

    for accounts_file in candidates {
        if !accounts_file.exists() {
            continue;
        }

        let data = fs::read_to_string(&accounts_file)
            .map_err(|e| format!("读取旧账号数据失败: {}", e))?;
        match parse_accounts_json_for_migration(&data) {
            Ok(accounts) => {
                save_accounts_to_db(conn, accounts)?;
                conn.execute(
                    "INSERT INTO storage_meta (key, value) VALUES (?1, ?2)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    params!["migrated_from", accounts_file.to_string_lossy().to_string()],
                )
                .map_err(|e| format!("记录账号迁移来源失败: {}", e))?;
                return Ok(());
            }
            Err(error) => {
                eprintln!("[存储] 跳过无法迁移的账号文件 {:?}: {}", accounts_file, error);
            }
        }
    }

    Ok(())
}

// 保存自定义 Logo
#[tauri::command]
pub async fn save_custom_logo(source_path: String) -> Result<String, String> {
    let data_dir = get_data_dir()?;
    
    // 获取文件扩展名
    let source = PathBuf::from(&source_path);
    let extension = source.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    
    // 目标文件路径
    let target_path = data_dir.join(format!("custom-logo.{}", extension));
    
    // 复制文件
    fs::copy(&source, &target_path)
        .map_err(|e| format!("复制文件失败: {}", e))?;
    
    // 返回目标文件的绝对路径
    target_path.to_str()
        .ok_or_else(|| "路径转换失败".to_string())
        .map(|s| s.to_string())
}

// 删除自定义 Logo
#[tauri::command]
pub async fn delete_custom_logo() -> Result<(), String> {
    let data_dir = get_data_dir()?;
    
    // 尝试删除所有可能的扩展名
    for ext in &["png", "jpg", "jpeg", "svg", "webp"] {
        let logo_path = data_dir.join(format!("custom-logo.{}", ext));
        if logo_path.exists() {
            fs::remove_file(logo_path)
                .map_err(|e| format!("删除文件失败: {}", e))?;
        }
    }
    
    Ok(())
}

// 加载账号数据
#[tauri::command]
pub async fn load_accounts() -> Result<String, String> {
    println!("[存储] 开始加载账号数据");
    let data_dir = get_data_dir()?;
    println!("[存储] 数据目录: {:?}", data_dir);

    let mut conn = open_accounts_db(&data_dir)?;
    println!("[存储] SQLite 数据库连接成功");

    migrate_legacy_accounts_if_needed(&data_dir, &mut conn)?;

    let result = load_accounts_from_db(&conn)?;
    let count = accounts_count(&conn)?;
    println!("[存储] 成功从 SQLite 加载 {} 个账号", count);

    Ok(result)
}

// 保存账号数据
#[tauri::command]
pub async fn save_accounts(data: String) -> Result<(), String> {
    // 先严格验证 JSON，避免把无效内容写入数据库
    let accounts = parse_accounts_json_strict(&data)?;
    println!("[存储] 开始保存 {} 个账号到 SQLite", accounts.len());

    let data_dir = get_data_dir()?;
    let mut conn = open_accounts_db(&data_dir)?;

    save_accounts_to_db(&mut conn, accounts)?;
    println!("[存储] 账号数据已成功保存到 SQLite");

    Ok(())
}

// 本地活跃账号数据结构
#[derive(Debug, Serialize, Deserialize)]
pub struct LocalActiveAccountResponse {
    pub success: bool,
    pub data: Option<LocalActiveAccountData>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalActiveAccountData {
    pub refresh_token: String,
    pub client_id: String,
    pub client_secret: String,
    pub region: String,
    pub profile_arn: Option<String>,
}

// 读取本地活跃账号
#[tauri::command]
pub async fn get_local_active_account() -> Result<LocalActiveAccountResponse, String> {
    println!("[本地账号] 开始读取本地 SSO 缓存");
    
    // 获取用户主目录
    let home_dir = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "无法获取用户主目录".to_string())?;
    
    let token_path = PathBuf::from(&home_dir)
        .join(".aws")
        .join("sso")
        .join("cache")
        .join("kiro-auth-token.json");
    
    println!("[本地账号] Token 路径: {:?}", token_path);
    
    // 检查文件是否存在
    if !token_path.exists() {
        return Ok(LocalActiveAccountResponse {
            success: false,
            data: None,
            error: Some("找不到 kiro-auth-token.json 文件，请先在 Kiro IDE 中登录".to_string()),
        });
    }
    
    // 读取文件内容
    let token_content = fs::read_to_string(&token_path)
        .map_err(|e| format!("读取 token 文件失败: {}", e))?;
    
    println!("[本地账号] 成功读取 token 文件");
    
    // 解析 JSON
    let token_data: serde_json::Value = serde_json::from_str(&token_content)
        .map_err(|e| format!("解析 token 文件失败: {}", e))?;
    
    // 提取必要字段
    let refresh_token = token_data.get("refreshToken")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "token 文件中缺少 refreshToken".to_string())?
        .to_string();

    let profile_arn = token_data
        .get("profileArn")
        .and_then(|v| v.as_str())
        .filter(|arn| arn.starts_with("arn:aws:codewhisperer:"))
        .map(|arn| arn.to_string());
    
    // 从 ~/.aws/sso/cache/ 目录查找 client credentials
    let cache_dir = PathBuf::from(&home_dir)
        .join(".aws")
        .join("sso")
        .join("cache");
    
    println!("[本地账号] 搜索 cache 目录: {:?}", cache_dir);
    
    let mut client_id = String::new();
    let mut client_secret = String::new();
    let mut region = "us-east-1".to_string();
    
    // 遍历 cache 目录查找包含 clientId 和 clientSecret 的文件
    if let Ok(entries) = fs::read_dir(&cache_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(data) = serde_json::from_str::<serde_json::Value>(&content) {
                        // 检查是否包含 clientId 和 clientSecret
                        if let (Some(cid), Some(csec)) = (
                            data.get("clientId").and_then(|v| v.as_str()),
                            data.get("clientSecret").and_then(|v| v.as_str())
                        ) {
                            client_id = cid.to_string();
                            client_secret = csec.to_string();
                            
                            // 尝试获取 region
                            if let Some(reg) = data.get("region").and_then(|v| v.as_str()) {
                                region = reg.to_string();
                            }
                            
                            println!("[本地账号] 找到 client credentials 文件: {:?}", path);
                            break;
                        }
                    }
                }
            }
        }
    }
    
    // 如果没有找到 client credentials，返回错误
    if client_id.is_empty() || client_secret.is_empty() {
        return Ok(LocalActiveAccountResponse {
            success: false,
            data: None,
            error: Some("找不到 client credentials，请确保已在 Kiro IDE 中完成登录".to_string()),
        });
    }
    
    println!("[本地账号] 成功提取凭证信息");
    println!("[本地账号] Region: {}", region);
    println!("[本地账号] Client ID: {}...", &client_id[..client_id.len().min(20)]);
    
    Ok(LocalActiveAccountResponse {
        success: true,
        data: Some(LocalActiveAccountData {
            refresh_token,
            client_id,
            client_secret,
            region,
            profile_arn,
        }),
        error: None,
    })
}
