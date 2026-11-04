#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut context = tauri::generate_context!();
  for window in &mut context.config_mut().app.windows {
    window.user_agent = Some(format!(
      "Trailforge/{} (+https://github.com/decaritat/Trailforge)",
      env!("CARGO_PKG_VERSION")
    ));
  }
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![search_places, save_text_file])
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

#[tauri::command]
async fn search_places(query: String) -> Result<String, String> {
  let query = query.trim();
  if query.is_empty() || query.chars().count() > 200 {
    return Err("Search query must contain between 1 and 200 characters".to_string());
  }

  reqwest::Client::builder()
    .user_agent(concat!("Trailforge/", env!("CARGO_PKG_VERSION")))
    .timeout(std::time::Duration::from_secs(15))
    .build()
    .map_err(|error| format!("Could not create geocoding client: {error}"))?
    .get("https://nominatim.openstreetmap.org/search")
    .query(&[
      ("q", query),
      ("format", "jsonv2"),
      ("limit", "5"),
      ("polygon_geojson", "1"),
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
