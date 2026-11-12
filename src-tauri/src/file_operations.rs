use tauri_plugin_dialog::DialogExt;

#[derive(serde::Serialize)]
pub struct OpenedProject {
    path: String,
    content: String,
}

#[derive(Default)]
pub struct ProjectPaths(std::sync::Mutex<std::collections::HashSet<std::path::PathBuf>>);

#[tauri::command]
pub async fn open_project_file(
    app: tauri::AppHandle,
    paths: tauri::State<'_, ProjectPaths>,
) -> Result<Option<OpenedProject>, String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .add_filter("JSON", &["json"])
        .pick_file(move |path| {
            let _ = sender.send(path);
        });
    let selected = tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|error| format!("Dialog failed: {error}"))?
        .map_err(|error| format!("Dialog failed: {error}"))?;
    let Some(path) = selected else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|error| format!("Invalid path: {error}"))?;
    let content =
        std::fs::read_to_string(&path).map_err(|error| format!("Could not read file: {error}"))?;
    paths
        .0
        .lock()
        .map_err(|error| format!("Project paths unavailable: {error}"))?
        .insert(path.clone());
    Ok(Some(OpenedProject {
        path: path.to_string_lossy().into_owned(),
        content,
    }))
}

#[tauri::command]
pub async fn save_project_file(
    app: tauri::AppHandle,
    paths: tauri::State<'_, ProjectPaths>,
    filename: String,
    content: String,
    path: Option<String>,
) -> Result<Option<String>, String> {
    let path = if let Some(path) = path {
        let path = std::path::PathBuf::from(path);
        if !paths
            .0
            .lock()
            .map_err(|error| format!("Project paths unavailable: {error}"))?
            .contains(&path)
        {
            return Err("Project path was not selected in a file dialog".to_string());
        }
        path
    } else {
        let (sender, receiver) = std::sync::mpsc::channel();
        app.dialog()
            .file()
            .set_file_name(&filename)
            .add_filter("JSON", &["json"])
            .save_file(move |path| {
                let _ = sender.send(path);
            });
        let selected = tauri::async_runtime::spawn_blocking(move || receiver.recv())
            .await
            .map_err(|error| format!("Dialog failed: {error}"))?
            .map_err(|error| format!("Dialog failed: {error}"))?;
        let Some(path) = selected else {
            return Ok(None);
        };
        path.into_path()
            .map_err(|error| format!("Invalid path: {error}"))?
    };
    std::fs::write(&path, content).map_err(|error| format!("Could not write file: {error}"))?;
    paths
        .0
        .lock()
        .map_err(|error| format!("Project paths unavailable: {error}"))?
        .insert(path.clone());
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn save_text_file(
    app: tauri::AppHandle,
    filename: String,
    content: String,
) -> Result<bool, String> {
    let extension = std::path::Path::new(&filename)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("txt")
        .to_string();
    let (sender, receiver) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_file_name(&filename)
        .add_filter(extension.to_uppercase(), &[extension.as_str()])
        .save_file(move |path| {
            let _ = sender.send(path);
        });
    let selected = tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|error| format!("Dialog failed: {error}"))?
        .map_err(|error| format!("Dialog failed: {error}"))?;
    let Some(path) = selected else {
        return Ok(false);
    };
    let path = path
        .into_path()
        .map_err(|error| format!("Invalid path: {error}"))?;
    std::fs::write(&path, content).map_err(|error| format!("Could not write file: {error}"))?;
    Ok(true)
}
