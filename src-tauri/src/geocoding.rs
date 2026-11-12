#[tauri::command]
pub async fn search_places(query: String) -> Result<String, String> {
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

    let provider: GeocodingProvider = serde_json::from_str(include_str!(
        "../../src/features/geocoding/geocodingProvider.json"
    ))
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
            (
                "polygon_geojson",
                provider.search_parameters.polygon_geojson.as_str(),
            ),
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
