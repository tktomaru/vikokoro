use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::PathBuf};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Workspace {
    tabs: Vec<TabRef>,
    active_doc_id: String,
    documents: HashMap<String, Document>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TabRef {
    doc_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Document {
    id: String,
    root_id: String,
    cursor_id: String,
    nodes: HashMap<String, Node>,
    undo_stack: Vec<DocumentState>,
    redo_stack: Vec<DocumentState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentState {
    root_id: String,
    cursor_id: String,
    nodes: HashMap<String, Node>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Node {
    id: String,
    text: String,
    parent_id: Option<String>,
    children_ids: Vec<String>,
}

fn workspace_json_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .resolve("workspace.json", tauri::path::BaseDirectory::AppData)
        .map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

#[tauri::command]
fn load_workspace(app: tauri::AppHandle) -> Result<Option<Workspace>, String> {
    let path = workspace_json_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let workspace = serde_json::from_str::<Workspace>(&text).map_err(|e| e.to_string())?;
    Ok(Some(workspace))
}

#[tauri::command]
fn save_workspace(app: tauri::AppHandle, workspace: Workspace) -> Result<(), String> {
    let path = workspace_json_path(&app)?;
    let text = serde_json::to_string(&workspace).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())?;
    Ok(())
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, load_workspace, save_workspace])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
