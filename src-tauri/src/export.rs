// 导出和打包模块
use std::fs::{self, File};
use std::io::{Write, Read};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

/// 创建ZIP文件并添加多个文件
#[tauri::command]
pub async fn create_zip_archive(
    files: Vec<String>,
    output_path: String,
) -> Result<String, String> {
    println!("[导出] 开始创建 ZIP 文件: {}", output_path);
    println!("[导出] 待打包文件数量: {}", files.len());

    let output_path_buf = PathBuf::from(&output_path);
    let file = File::create(&output_path_buf)
        .map_err(|e| format!("创建 ZIP 文件失败: {}", e))?;

    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o755);

    for (index, file_path) in files.iter().enumerate() {
        let path = Path::new(file_path);
        if !path.exists() {
            println!("[导出] 警告: 文件不存在，跳过: {}", file_path);
            continue;
        }

        let file_name = path.file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| format!("无法获取文件名: {}", file_path))?;

        println!("[导出] 添加文件 {}/{}: {}", index + 1, files.len(), file_name);

        zip.start_file(file_name, options)
            .map_err(|e| format!("添加文件到 ZIP 失败: {}", e))?;

        let mut f = File::open(path)
            .map_err(|e| format!("打开文件失败: {}", e))?;

        let mut buffer = Vec::new();
        f.read_to_end(&mut buffer)
            .map_err(|e| format!("读取文件失败: {}", e))?;

        zip.write_all(&buffer)
            .map_err(|e| format!("写入 ZIP 失败: {}", e))?;
    }

    zip.finish()
        .map_err(|e| format!("完成 ZIP 文件失败: {}", e))?;

    println!("[导出] ZIP 文件创建成功: {}", output_path);
    Ok(output_path)
}

/// 删除临时文件
#[tauri::command]
pub async fn cleanup_temp_files(files: Vec<String>) -> Result<(), String> {
    println!("[导出] 清理临时文件，数量: {}", files.len());

    for file_path in files {
        if let Err(e) = fs::remove_file(&file_path) {
            println!("[导出] 删除临时文件失败: {} - {}", file_path, e);
        }
    }

    println!("[导出] 临时文件清理完成");
    Ok(())
}
