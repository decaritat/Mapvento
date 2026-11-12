#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut context = tauri::generate_context!();
  for window in &mut context.config_mut().app.windows {
    window.user_agent = Some(format!(
      "Mapvento/{} (+https://github.com/decaritat/Mapvento)",
      env!("CARGO_PKG_VERSION")
    ));
  }
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .manage(ProjectPaths::default())
    .invoke_handler(tauri::generate_handler![search_places, save_text_file, open_project_file, save_project_file, exit_app])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(context)
    .expect("error while building tauri application");
}

#[derive(serde::Serialize)]
struct OpenedProject {
  path: String,
  content: String,
}

#[derive(Default)]
struct ProjectPaths(std::sync::Mutex<std::collections::HashSet<std::path::PathBuf>>);

#[tauri::command]
async fn open_project_file(app: tauri::AppHandle, paths: tauri::State<'_, ProjectPaths>) -> Result<Option<OpenedProject>, String> {
  use tauri_plugin_dialog::DialogExt;
  let (sender, receiver) = std::sync::mpsc::channel();
  app.dialog().file().add_filter("JSON", &["json"]).pick_file(move |path| {
    let _ = sender.send(path);
  });
  let selected = tauri::async_runtime::spawn_blocking(move || receiver.recv())
    .await.map_err(|error| format!("Dialog failed: {error}"))?
    .map_err(|error| format!("Dialog failed: {error}"))?;
  let Some(path) = selected else { return Ok(None) };
  let path = path.into_path().map_err(|error| format!("Invalid path: {error}"))?;
  let content = std::fs::read_to_string(&path).map_err(|error| format!("Could not read file: {error}"))?;
  paths.0.lock().map_err(|error| format!("Project paths unavailable: {error}"))?.insert(path.clone());
  Ok(Some(OpenedProject { path: path.to_string_lossy().into_owned(), content }))
}

#[tauri::command]
async fn save_project_file(app: tauri::AppHandle, paths: tauri::State<'_, ProjectPaths>, filename: String, content: String, path: Option<String>) -> Result<Option<String>, String> {
  use tauri_plugin_dialog::DialogExt;
  let path = if let Some(path) = path {
    let path = std::path::PathBuf::from(path);
    if !paths.0.lock().map_err(|error| format!("Project paths unavailable: {error}"))?.contains(&path) {
      return Err("Project path was not selected in a file dialog".to_string());
    }
    path
  } else {
    let (sender, receiver) = std::sync::mpsc::channel();
    app.dialog().file().set_file_name(&filename).add_filter("JSON", &["json"]).save_file(move |path| {
      let _ = sender.send(path);
    });
    let selected = tauri::async_runtime::spawn_blocking(move || receiver.recv())
      .await.map_err(|error| format!("Dialog failed: {error}"))?
      .map_err(|error| format!("Dialog failed: {error}"))?;
    let Some(path) = selected else { return Ok(None) };
    path.into_path().map_err(|error| format!("Invalid path: {error}"))?
  };
  std::fs::write(&path, content).map_err(|error| format!("Could not write file: {error}"))?;
  paths.0.lock().map_err(|error| format!("Project paths unavailable: {error}"))?.insert(path.clone());
  Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
  app.exit(0);
}

#[tauri::command]
async fn search_places(query: String) -> Result<String, String> {
  #[derive(serde::Deserialize)]
  #[serde(rename_all = "camelCase")]
  struct GeocodingProvider {
    endpoint: String,
    search_parameters: GeocodingSearchParameters,
  }

  #[derive(serde::Deserialize)]
  struct GeocodingSearchParameters {
    format: String,
    limit: String,
    #[serde(rename = "polygon_geojson")]
    polygon_geojson: String,
  }

  let query = query.trim();
  if query.is_empty() || query.chars().count() > 200 {
    return Err("Search query must contain between 1 and 200 characters".to_string());
  }

  let provider: GeocodingProvider = serde_json::from_str(include_str!("../../src/geocodingProvider.json"))
    .map_err(|error| format!("Could not load geocoding provider configuration: {error}"))?;

  reqwest::Client::builder()
    .user_agent(concat!("Mapvento/", env!("CARGO_PKG_VERSION")))
    .timeout(std::time::Duration::from_secs(15))
    .build()
    .map_err(|error| format!("Could not create geocoding client: {error}"))?
    .get(provider.endpoint)
    .query(&[
      ("q", query),
      ("format", provider.search_parameters.format.as_str()),
      ("limit", provider.search_parameters.limit.as_str()),
      ("polygon_geojson", provider.search_parameters.polygon_geojson.as_str()),
    ])
    .send()
    .await
    .map_err(|error| format!("Geocoding request failed: {error}"))?
    .error_for_status()
    .map_err(|error| format!("Geocoding service returned an error: {error}"))?
    .text()
    .await
    .map_err(|error| format!("Could not read geocoding response: {error}"))
}

#[tauri::command]
async fn save_text_file(app: tauri::AppHandle, filename: String, content: String) -> Result<bool, String> {
  use tauri_plugin_dialog::DialogExt;

  let extension = std::path::Path::new(&filename)
    .extension()
    .and_then(|value| value.to_str())
    .unwrap_or("txt")
    .to_string();
  let (sender, receiver) = std::sync::mpsc::channel();
  app
    .dialog()
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
  let path = path.into_path().map_err(|error| format!("Invalid path: {error}"))?;
  std::fs::write(&path, content).map_err(|error| format!("Could not write file: {error}"))?;
  Ok(true)
}
