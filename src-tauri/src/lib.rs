mod file_operations;
mod geocoding;

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
    .manage(file_operations::ProjectPaths::default())
    .invoke_handler(tauri::generate_handler![
      geocoding::search_places,
      file_operations::save_text_file,
      file_operations::open_project_file,
      file_operations::save_project_file,
      exit_app
    ])
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
fn exit_app(app: tauri::AppHandle) {
  app.exit(0);
}
