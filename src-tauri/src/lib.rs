mod proxy;
mod tls;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, State, WebviewWindow};
use tokio::io::AsyncWriteExt;

use proxy::ProxyInfo;
use tls::Clients;

const KEYRING_SERVICE: &str = "ch.benavo.ampli.desktop";

struct AppState {
    proxy: ProxyInfo,
    clients: Arc<Clients>,
    files: PathBuf,
    downloads: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// The window's size before the mini player, to go back to.
    full_size: Mutex<Option<LogicalSize<f64>>>,
}

#[derive(Clone, Serialize)]
struct Progress {
    id: String,
    received: u64,
    total: Option<u64>,
}

/// Only plain names: downloads never leave the downloads folder.
fn safe_name(name: &str) -> Result<&str, String> {
    let ok = !name.is_empty()
        && name.len() < 200
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_');
    if ok {
        Ok(name)
    } else {
        Err(format!("Bad file name {name}"))
    }
}

#[tauri::command]
fn proxy_info(state: State<'_, AppState>) -> ProxyInfo {
    state.proxy.clone()
}

/// Downloads `url` into the downloads folder as `file_name`, reporting `download-progress` events.
#[tauri::command]
async fn download_file(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    url: String,
    file_name: String,
    pin: Option<String>,
    headers: Option<HashMap<String, String>>,
) -> Result<u64, String> {
    let name = safe_name(&file_name)?.to_string();
    let cancel = Arc::new(AtomicBool::new(false));
    state.downloads.lock().unwrap().insert(id.clone(), cancel.clone());
    let result = run_download(&app, &state, &id, &url, &name, pin.as_deref(), headers.unwrap_or_default(), &cancel).await;
    state.downloads.lock().unwrap().remove(&id);
    if result.is_err() {
        let _ = tokio::fs::remove_file(state.files.join(format!("{name}.part"))).await;
    }
    result
}

#[allow(clippy::too_many_arguments)]
async fn run_download(
    app: &AppHandle,
    state: &AppState,
    id: &str,
    url: &str,
    name: &str,
    pin: Option<&str>,
    headers: HashMap<String, String>,
    cancel: &AtomicBool,
) -> Result<u64, String> {
    let mut request = state.clients.get(pin).get(url);
    for (key, value) in headers {
        request = request.header(key, value);
    }
    let response = request.send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("The server answered with error {}.", response.status().as_u16()));
    }
    let total = response.content_length();
    let part = state.files.join(format!("{name}.part"));
    let mut file = tokio::fs::File::create(&part).await.map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();
    let mut received = 0u64;
    let mut last = Instant::now() - Duration::from_secs(1);
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        if last.elapsed() > Duration::from_millis(250) {
            last = Instant::now();
            let _ = app.emit("download-progress", Progress { id: id.to_string(), received, total });
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    tokio::fs::rename(&part, state.files.join(name)).await.map_err(|e| e.to_string())?;
    let _ = app.emit("download-progress", Progress { id: id.to_string(), received, total: Some(received) });
    Ok(received)
}

#[tauri::command]
fn cancel_download(state: State<'_, AppState>, id: String) {
    if let Some(flag) = state.downloads.lock().unwrap().get(&id) {
        flag.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
async fn delete_file(state: State<'_, AppState>, file_name: String) -> Result<(), String> {
    let name = safe_name(&file_name)?;
    match tokio::fs::remove_file(state.files.join(name)).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Names and sizes of everything downloaded.
#[tauri::command]
async fn list_files(state: State<'_, AppState>) -> Result<HashMap<String, u64>, String> {
    let mut result = HashMap::new();
    let mut dir = tokio::fs::read_dir(&state.files).await.map_err(|e| e.to_string())?;
    while let Ok(Some(entry)) = dir.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".part") {
            continue;
        }
        if let Ok(meta) = entry.metadata().await {
            if meta.is_file() {
                result.insert(name, meta.len());
            }
        }
    }
    Ok(result)
}

#[tauri::command]
fn downloads_folder(state: State<'_, AppState>) -> String {
    state.files.to_string_lossy().to_string()
}

#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, &key).and_then(|e| e.set_password(&value)).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// The SHA-256 of a server's certificate, for the user to confirm before trusting it.
#[tauri::command]
async fn probe_certificate(url: String) -> Result<String, String> {
    tls::probe(&url).await
}

/// Shrinks the window to a small player that stays on top, or brings the full window back.
#[tauri::command]
fn set_mini_player(window: WebviewWindow, state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    if enabled {
        let size = window.inner_size().map_err(|e| e.to_string())?.to_logical::<f64>(scale);
        *state.full_size.lock().unwrap() = Some(size);
        let _ = window.unmaximize();
        let _ = window.set_resizable(false);
        window.set_size(LogicalSize::new(420.0, 156.0)).map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
    } else {
        let size = state.full_size.lock().unwrap().take().unwrap_or(LogicalSize::new(1280.0, 820.0));
        window.set_always_on_top(false).map_err(|e| e.to_string())?;
        let _ = window.set_resizable(true);
        window.set_size(size).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            let files = data.join("downloads");
            std::fs::create_dir_all(&files)?;
            let clients = Arc::new(Clients::new());
            let proxy = tauri::async_runtime::block_on(proxy::start(clients.clone(), files.clone()));
            app.manage(AppState { proxy, clients, files, downloads: Mutex::new(HashMap::new()), full_size: Mutex::new(None) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            proxy_info,
            download_file,
            cancel_download,
            delete_file,
            list_files,
            downloads_folder,
            secret_get,
            secret_set,
            secret_delete,
            probe_certificate,
            set_mini_player,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ampli");
}
