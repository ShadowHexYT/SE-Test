use arboard::{Clipboard, ImageData};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{ImageBuffer, ImageFormat, RgbaImage};
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::fs;
use std::io::Cursor;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::models::{ClipboardSnapshot, ClipboardType};

fn now_iso_string() -> String {
    let milliseconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();

    milliseconds.to_string()
}

fn hash_bytes(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("{digest:x}")
}

fn read_text_snapshot(clipboard: &mut Clipboard) -> Result<Option<ClipboardSnapshot>, String> {
    let text = match clipboard.get_text() {
        Ok(text) if !text.trim().is_empty() => text,
        Ok(_) => return Ok(None),
        Err(_) => return Ok(None),
    };

    Ok(Some(ClipboardSnapshot {
        signature: hash_bytes(text.as_bytes()),
        item_type: ClipboardType::Text,
        text: Some(text),
        image_data_url: None,
        width: None,
        height: None,
        captured_at: now_iso_string(),
    }))
}

fn read_image_snapshot(clipboard: &mut Clipboard) -> Result<Option<ClipboardSnapshot>, String> {
    let image = match clipboard.get_image() {
        Ok(image) => image,
        Err(_) => return Ok(None),
    };

    let rgba = image.bytes.into_owned();
    let buffer: RgbaImage = ImageBuffer::from_raw(image.width as u32, image.height as u32, rgba)
        .ok_or_else(|| "Clipboard image could not be normalized.".to_string())?;
    let dynamic = image::DynamicImage::ImageRgba8(buffer);
    let mut cursor = Cursor::new(Vec::new());

    dynamic
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|error| error.to_string())?;

    let png_bytes = cursor.into_inner();
    let encoded = STANDARD.encode(&png_bytes);
    let signature = hash_bytes(&png_bytes);

    Ok(Some(ClipboardSnapshot {
        signature,
        item_type: ClipboardType::Image,
        text: None,
        image_data_url: Some(format!("data:image/png;base64,{encoded}")),
        width: Some(image.width),
        height: Some(image.height),
        captured_at: now_iso_string(),
    }))
}

pub fn read_clipboard_snapshot() -> Result<Option<ClipboardSnapshot>, String> {
    let mut clipboard = Clipboard::new().map_err(|error| error.to_string())?;

    if let Some(image_snapshot) = read_image_snapshot(&mut clipboard)? {
        return Ok(Some(image_snapshot));
    }

    read_text_snapshot(&mut clipboard)
}

pub fn copy_text_to_clipboard(text: &str) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|error| error.to_string())?;
    clipboard
        .set_text(text.to_string())
        .map_err(|error| error.to_string())
}

pub fn copy_image_to_clipboard(image_data_url: &str) -> Result<(), String> {
    let png_bytes = decode_png_bytes(image_data_url)?;
    let image = image::load_from_memory_with_format(&png_bytes, ImageFormat::Png)
        .map_err(|error| error.to_string())?
        .to_rgba8();

    let width = usize::try_from(image.width()).map_err(|error| error.to_string())?;
    let height = usize::try_from(image.height()).map_err(|error| error.to_string())?;

    let mut clipboard = Clipboard::new().map_err(|error| error.to_string())?;

    clipboard
        .set_image(ImageData {
            width,
            height,
            bytes: Cow::Owned(image.into_raw()),
        })
        .map_err(|error| error.to_string())
}

fn decode_png_bytes(image_data_url: &str) -> Result<Vec<u8>, String> {
    let encoded = image_data_url
        .split(',')
        .nth(1)
        .ok_or_else(|| "Clipboard image payload was not a valid data URL.".to_string())?;

    STANDARD
        .decode(encoded)
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
pub fn open_image_in_preview(image_data_url: &str) -> Result<(), String> {
    let png_bytes = decode_png_bytes(image_data_url)?;
    let signature = hash_bytes(&png_bytes);
    let mut output_path: PathBuf = std::env::temp_dir();
    output_path.push(format!("glint-preview-{signature}.png"));

    fs::write(&output_path, png_bytes).map_err(|error| error.to_string())?;

    Command::new("open")
        .arg("-a")
        .arg("Preview")
        .arg(&output_path)
        .status()
        .map_err(|error| error.to_string())
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err("Glint could not open Preview.".to_string())
            }
        })
}

#[cfg(not(target_os = "macos"))]
pub fn open_image_in_preview(_image_data_url: &str) -> Result<(), String> {
    Err("Native Preview open is only available on macOS.".to_string())
}
