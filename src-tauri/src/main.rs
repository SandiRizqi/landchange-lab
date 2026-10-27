// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose, Engine as _};
use image::ImageFormat;
use std::fs::{self, OpenOptions};
use std::io::Cursor;
use std::io::Write;
use std::path::Path;
use tauri::command;

/// Load any image (TIFF, PNG, JPG, BMP) from disk and return as base64-encoded PNG.
/// The `image` crate handles GeoTIFF / multi-band TIFF natively via libtiff.
#[command]
fn load_image_as_png_b64(path: String) -> Result<String, String> {
    let img = image::open(&path).map_err(|e| format!("Gagal membaca gambar: {e}"))?;

    // Convert to RGBA8 — works for 8-bit and 16-bit TIFF (auto-normalised)
    let rgba = img.to_rgba8();

    let mut buf = Cursor::new(Vec::new());
    rgba.write_to(&mut buf, ImageFormat::Png)
        .map_err(|e| format!("Gagal encode PNG: {e}"))?;

    Ok(general_purpose::STANDARD.encode(buf.into_inner()))
}

/// Ensure the parent directory of `path` exists.
fn ensure_parent(path: &str) -> Result<(), String> {
    if let Some(parent) = Path::new(path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("Gagal membuat folder: {e}"))?;
        }
    }
    Ok(())
}

/// Write raw bytes (small files) to the given path. Creates parent dirs if needed.
#[command]
fn save_bytes_to_path(path: String, data: Vec<u8>) -> Result<(), String> {
    ensure_parent(&path)?;
    fs::write(&path, data).map_err(|e| format!("Gagal menyimpan file: {e}"))
}

/// Append a chunk of bytes to a file. When `first` is true the file is created/truncated.
/// Used to stream large ZIP exports in chunks so the JS side never has to build a
/// single gigantic array (which throws "RangeError: Invalid array length").
#[command]
fn append_bytes_to_path(path: String, data: Vec<u8>, first: bool) -> Result<(), String> {
    if first {
        ensure_parent(&path)?;
        fs::write(&path, &data).map_err(|e| format!("Gagal menulis file: {e}"))
    } else {
        let mut f = OpenOptions::new()
            .append(true)
            .open(&path)
            .map_err(|e| format!("Gagal membuka file untuk append: {e}"))?;
        f.write_all(&data)
            .map_err(|e| format!("Gagal menulis file: {e}"))
    }
}

/// Read raw bytes from a file path (used to load project/zip files).
#[command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Gagal membaca file: {e}"))
}

/// Check whether a path exists on disk (used to validate image paths before opening a project).
#[command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Delete a single file. Missing files are treated as success (idempotent QC delete).
#[command]
fn delete_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(());
    }
    fs::remove_file(p).map_err(|e| format!("Gagal menghapus file: {e}"))
}

/// List the file names (not sub-directories) directly inside a directory.
/// Used by Quality Control to read an exported dataset straight from a folder.
#[command]
fn list_dir(path: String) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let rd = fs::read_dir(&path).map_err(|e| format!("Gagal membaca folder: {e}"))?;
    for entry in rd {
        let entry = entry.map_err(|e| format!("Gagal membaca isi folder: {e}"))?;
        let p = entry.path();
        if p.is_file() {
            if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                out.push(name.to_string());
            }
        }
    }
    Ok(out)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            load_image_as_png_b64,
            save_bytes_to_path,
            append_bytes_to_path,
            read_file_bytes,
            path_exists,
            delete_file,
            list_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
