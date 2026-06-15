// 机器码管理模块 - 跨平台版本
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct MachineIdResult {
    pub success: bool,
    pub machine_id: Option<String>,
    pub error: Option<String>,
}

// 获取当前机器码
#[tauri::command]
pub async fn get_current_machine_id() -> Result<MachineIdResult, String> {
    match get_platform_machine_id() {
        Ok(machine_id) => Ok(MachineIdResult {
            success: true,
            machine_id: Some(machine_id),
            error: None,
        }),
        Err(error) => Ok(MachineIdResult {
            success: false,
            machine_id: None,
            error: Some(error),
        }),
    }
}

// 设置新机器码
#[tauri::command]
pub async fn set_machine_id(new_machine_id: String) -> Result<MachineIdResult, String> {
    // 1. 首先检查管理员权限
    if !check_admin_privilege_internal() {
        return Ok(MachineIdResult {
            success: false,
            machine_id: None,
            error: Some("需要管理员权限".to_string()),
        });
    }

    // 2. 验证长度
    if new_machine_id.len() > 100 {
        return Ok(MachineIdResult {
            success: false,
            machine_id: None,
            error: Some("机器码长度超出限制".to_string()),
        });
    }

    // 3. 验证格式
    if !is_valid_machine_id(&new_machine_id) {
        return Ok(MachineIdResult {
            success: false,
            machine_id: None,
            error: Some("无效的机器码格式".to_string()),
        });
    }

    // 4. 尝试设置机器码
    match set_platform_machine_id(&new_machine_id) {
        Ok(_) => Ok(MachineIdResult {
            success: true,
            machine_id: Some(new_machine_id),
            error: None,
        }),
        Err(error) => Ok(MachineIdResult {
            success: false,
            machine_id: None,
            error: Some(error),
        }),
    }
}

// 检查是否有管理员权限
#[tauri::command]
pub async fn check_admin_privilege() -> Result<bool, String> {
    Ok(check_admin_privilege_internal())
}

// 生成随机机器码
#[tauri::command]
pub async fn generate_random_machine_id() -> Result<String, String> {
    Ok(uuid::Uuid::new_v4().to_string().to_lowercase())
}

// 验证机器码格式
fn is_valid_machine_id(machine_id: &str) -> bool {
    // 检查长度
    if machine_id.len() > 100 {
        return false;
    }

    // UUID 格式: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    let parts: Vec<&str> = machine_id.split('-').collect();
    if parts.len() != 5 {
        return false;
    }

    if parts[0].len() != 8 || parts[1].len() != 4 || parts[2].len() != 4
        || parts[3].len() != 4 || parts[4].len() != 12 {
        return false;
    }

    // 检查是否都是十六进制字符
    machine_id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

// ==================== Windows 平台实现 ====================
#[cfg(target_os = "windows")]
mod platform {
    use std::process::Command;
    use winreg::enums::*;
    use winreg::RegKey;

    pub fn get_machine_id() -> Result<String, String> {
        // 方法1: 使用 winreg 读取注册表
        if let Ok(machine_id) = get_machine_id_from_registry() {
            return Ok(machine_id);
        }

        // 方法2: 使用 reg query 命令
        get_machine_id_from_command()
    }

    pub fn set_machine_id(new_machine_id: &str) -> Result<(), String> {
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let key = hklm
            .open_subkey_with_flags("SOFTWARE\\Microsoft\\Cryptography", KEY_WRITE)
            .map_err(|_| "打开注册表失败".to_string())?;

        key.set_value("MachineGuid", &new_machine_id)
            .map_err(|_| "写入注册表失败".to_string())?;

        Ok(())
    }

    pub fn check_admin_privilege() -> bool {
        RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey_with_flags("SOFTWARE\\Microsoft\\Cryptography", KEY_WRITE)
            .is_ok()
    }

    fn get_machine_id_from_registry() -> Result<String, String> {
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let key = hklm
            .open_subkey("SOFTWARE\\Microsoft\\Cryptography")
            .map_err(|_| "读取注册表失败".to_string())?;

        let machine_guid: String = key
            .get_value("MachineGuid")
            .map_err(|_| "读取 MachineGuid 失败".to_string())?;

        Ok(machine_guid.to_lowercase())
    }

    fn get_machine_id_from_command() -> Result<String, String> {
        let output = Command::new("reg")
            .args(&[
                "query",
                "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography",
                "/v",
                "MachineGuid",
            ])
            .output()
            .map_err(|_| "执行 reg 命令失败".to_string())?;

        let stdout = String::from_utf8_lossy(&output.stdout);

        // 解析输出
        for line in stdout.lines() {
            if line.contains("MachineGuid") && line.contains("REG_SZ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if let Some(guid) = parts.last() {
                    return Ok(guid.to_lowercase());
                }
            }
        }

        Err("解析 reg 输出失败".to_string())
    }
}

// ==================== macOS 平台实现 ====================
#[cfg(target_os = "macos")]
mod platform {
    use std::process::Command;

    pub fn get_machine_id() -> Result<String, String> {
        // macOS 使用 IOPlatformUUID
        let output = Command::new("ioreg")
            .args(&["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
            .map_err(|_| "执行 ioreg 命令失败".to_string())?;

        let stdout = String::from_utf8_lossy(&output.stdout);

        // 查找 IOPlatformUUID
        for line in stdout.lines() {
            if line.contains("IOPlatformUUID") {
                if let Some(uuid_part) = line.split('"').nth(3) {
                    return Ok(uuid_part.to_lowercase());
                }
            }
        }

        Err("无法获取 IOPlatformUUID".to_string())
    }

    pub fn set_machine_id(_new_machine_id: &str) -> Result<(), String> {
        // macOS 上无法直接修改系统的 IOPlatformUUID
        Err("macOS 不支持修改系统机器码".to_string())
    }

    pub fn check_admin_privilege() -> bool {
        // 检查是否以 root 权限运行
        use std::process::Command;
        if let Ok(output) = Command::new("id").arg("-u").output() {
            if let Ok(uid) = String::from_utf8_lossy(&output.stdout).trim().parse::<u32>() {
                return uid == 0;
            }
        }
        false
    }
}

// ==================== Linux 平台实现 ====================
#[cfg(target_os = "linux")]
mod platform {
    use std::fs;

    pub fn get_machine_id() -> Result<String, String> {
        // 尝试读取 /etc/machine-id
        if let Ok(content) = fs::read_to_string("/etc/machine-id") {
            return Ok(content.trim().to_lowercase());
        }

        // 尝试读取 /var/lib/dbus/machine-id
        if let Ok(content) = fs::read_to_string("/var/lib/dbus/machine-id") {
            return Ok(content.trim().to_lowercase());
        }

        Err("无法读取机器码".to_string())
    }

    pub fn set_machine_id(new_machine_id: &str) -> Result<(), String> {
        // 需要 root 权限写入
        fs::write("/etc/machine-id", format!("{}\n", new_machine_id))
            .map_err(|_| "写入 /etc/machine-id 失败（需要 root 权限）".to_string())
    }

    pub fn check_admin_privilege() -> bool {
        // 检查是否以 root 权限运行
        use std::process::Command;
        if let Ok(output) = Command::new("id").arg("-u").output() {
            if let Ok(uid) = String::from_utf8_lossy(&output.stdout).trim().parse::<u32>() {
                return uid == 0;
            }
        }
        false
    }
}

// ==================== 其他平台实现 ====================
#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
mod platform {
    pub fn get_machine_id() -> Result<String, String> {
        Err("当前操作系统不支持".to_string())
    }

    pub fn set_machine_id(_new_machine_id: &str) -> Result<(), String> {
        Err("当前操作系统不支持".to_string())
    }

    pub fn check_admin_privilege() -> bool {
        false
    }
}

// 平台适配层
fn get_platform_machine_id() -> Result<String, String> {
    platform::get_machine_id()
}

fn set_platform_machine_id(new_machine_id: &str) -> Result<(), String> {
    platform::set_machine_id(new_machine_id)
}

fn check_admin_privilege_internal() -> bool {
    platform::check_admin_privilege()
}
