# Design-Audit Mapvento

Stand: 20. November 2026 · Codebasis: `e704490` · Ziel: Windows und Ubuntu, Tauri 2 und Web-Oberfläche

## 1. Gesamtbeurteilung

Mapvento hat eine erkennbare, für einen Routenplaner passende Grundstruktur: Projekt und Routen links, Karte als Arbeitsfläche, Analyse darunter. Dunkle Bedienflächen, grüne Akzente und helle Kartenwerkzeuge bilden eine nachvollziehbare visuelle Hierarchie. Positiv sind unter anderem beschriftete Kartenwerkzeuge, Statusmeldungen, das per Tastatur bedienbare Hauptmenü, wiederverwendete POI-Symbole sowie explizite Zustände für Routing und schreibgeschützte Importe.

**Gesamturteil: gute Grundlage, aber noch nicht durchgängig bedienbar oder ausreichend gegen Fehlbedienung abgesichert.** Das größte Risiko ist der mögliche Verlust ungespeicherter Projektänderungen. Die wichtigsten UX-Lücken betreffen das Höhenprofil, den Fokus in Dialogen und zu geringe Textkontraste. Kleine Bedienelemente, uneinheitliche Dialog- und Menüinteraktionen und versteckte Einstiege erschweren zudem die Nutzung. Die Karten- und Routenbearbeitung ist für die PC-Nutzung mit Maus ausgelegt; diese bewusste Interaktionsform wird nicht als Mangel gewertet.

### Umfang und Grenzen

- Statische Prüfung der React-Oberfläche, der zugehörigen CSS-Dateien, der Leaflet-Interaktionen, ausgewählter Projektdatei-Abläufe und vorhandener UI-Tests. Betrachtet wurden Hauptmenü, Projekt- und Routenliste, Karte, Suche, Kartenlayer, OSM-Orte, POIs, Höhenprofil, Einstellungen, Cache, Info-, Update- und Beenden-Dialog.
- Ergänzend wurde die Web-App bei **1051 × 944 CSS-Pixeln** gestartet; Startansicht und Routeneigenschaften wurden visuell betrachtet. Die Laufzeitbeobachtung ersetzt keine vollständige Prüfung aller Zustände.
- Mapvento ist für die Nutzung am PC vorgesehen; Mausinteraktionen zur räumlichen Routen- und POI-Bearbeitung sind beabsichtigt und müssen nicht durch gleichwertige Tastatursteuerung ersetzt werden. Tastaturzugänglichkeit bleibt für reguläre Bedienelemente und Dialoge relevant.
- Keine systematische Prüfung mit Screenreader, Touchgerät, Tastatur-only, unterschiedlichen Skalierungen, Windows-WebView oder Ubuntu-WebView. Aussagen zu diesen Umgebungen sind Codebefunde beziehungsweise Prüfaufträge, keine behaupteten Laufzeitergebnisse.
- Kein Performance-Profiling und keine vollständige Kontrastmessung aller Zustände. Die unten genannten Kontrastwerte sind berechnete Beispiele für konkrete Farbkombinationen.
- Der automatische Design-Detektor meldete nur die Schriftfamilie Inter. Das ist eine subjektive Stilwarnung und **kein** belegter Produktfehler; ein Schriftaustausch wird nicht gefordert.

### Einordnung der Dimensionen

Die Bewertungen sind eine qualitative Momentaufnahme von 0 bis 4, keine WCAG-Zertifizierung.

| Dimension | Wert | Begründung |
|---|---:|---|
| Zugänglichkeit | 2/4 | Kontrast und Dialogfokus weisen konkrete Lücken auf; räumliche Kartenbearbeitung per Maus ist beabsichtigt. |
| Gestaltung und Konsistenz | 2/4 | Grundpalette und wiederverwendete POI-Symbole sind vorhanden; Zustände, Komponenten und Farbangaben sind nicht durchgängig vereinheitlicht. |
| Anpassungsfähigkeit | 2/4 | Desktop-Breakpoints existieren, aber das zweispaltige Grundlayout bleibt auch bei schmalen Fenstern bestehen. Ohne Messung keine Aussage über konkrete Mindestbreite. |
| Implementierungsintegrität | 2/4 | Produktbezogene Arbeitsfläche und Providergrenzen sind erkennbar; Interaktionsverträge und Schutz vor Datenverlust sind jedoch uneinheitlich. |
| Performance | nicht bewertet | Kein reproduzierbares Profiling durchgeführt; keine belastbare Punktzahl. |

## 2. Zusammenfassung und Priorisierung

**Priorität:** P0 = potenzieller Datenverlust; P1 = wesentliche Nutzungs- oder Barrierefreiheitslücke; P2 = deutliche Inkonsistenz oder Erschwernis; P3 = ergänzende Qualität. **Umfang:** S = lokal und begrenzt, M = mehrere zusammenhängende Komponenten, L = komponentenübergreifend oder neues Interaktionskonzept. Dies sind relative Größen, keine Zeitschätzungen.

| ID | Befund | Auswirkung | Priorität | Umfang |
|---|---|---|---|---|
| A01 | Projektwechsel ohne eindeutigen Schutz | Ungespeicherte Arbeit kann verloren gehen. | P0 | M |
| A02 | Höhenprofil nur per Maus untersuchbar | Punktgenaue Analyse und Kartenbezug fehlen ohne Maus. | P1 | M |
| A03 | Uneinheitlicher Dialogfokus | Tastatur- und Screenreader-Nutzer verlieren Kontext oder Einstieg. | P1 | M |
| A04 | Geringer Kontrast und sehr kleine Schrift | Informationen und Beschriftungen sind schwer lesbar. | P1 | M |
| A05 | Sprache und Eingabefokus | Deutsche Oberfläche wird als Englisch angekündigt; einzelne Eingaben haben schwache Fokusindikatoren. | P1 | S |
| A06 | Unklare Einstiege und Bearbeitungszustände | Neue Nutzer müssen Import, Routenbearbeitung und Einschränkungen erraten. | P2 | M |
| A07 | Menü-, Panel- und Fokusverhalten uneinheitlich | Gleiche Aktionen verhalten sich je nach Kontext unterschiedlich. | P2 | M |
| A08 | Kleine und dichte Bedienelemente | Präzise Mausbedienung ist erschwert. | P2 | M |
| A09 | Farben und Buttonvarianten uneinheitlich | Gleiche Bedeutung ist visuell nicht durchgehend erkennbar. | P2 | M |
| A10 | Icons und Farbauswahl nicht einheitlich kommuniziert | Symbole sind schwer unterscheidbar; Farbauswahl und ihr Zustand sind nicht ausreichend vermittelt. | P2 | M |
| A11 | Fehlende Messwerte wirken wie Messwerte | Leere Routen zeigen bereits Dauer und Höhenwerte. | P2 | M |
| A12 | Rückmeldung und Cache-Aktionen uneinheitlich | Fehler oder folgenreiche Aktionen können übersehen werden. | P2 | M |
| A13 | Fenstergröße und Textskalierung nicht durchgängig berücksichtigt | Karte, Seitenleiste und Dialoge können auf engem Raum schwer nutzbar werden. | P2 | M |
| A14 | Zahlenformat und Sprache gemischt | Deutsche Oberfläche zeigt englische Kennzeichnungen und Dezimalpunkte. | P3 | M |

## 3. Aufgaben für die Korrektur

Die Aufgaben sind unabhängig überprüfbare Arbeitspakete. P0 zuerst; A03 und A04/A05 vor einer breiten Vereinheitlichung der Komponenten umsetzen. Änderungen an Datenformat, Providergrenzen und Attributionen sind nicht Gegenstand dieses Audits.

### A01 – Ungespeicherte Arbeit bei Projektwechsel schützen

**Beleg:** `src/features/project-files/useProjectFiles.ts:107-135`: „Neues Projekt“ nutzt eine Ja/Nein-Abfrage zum Speichern; Nein führt direkt zum neuen Projekt und bietet keinen expliziten Abbruch. `src/features/project-files/useProjectFiles.ts:201-214`: „Projekt öffnen“ lädt ohne entsprechende Abfrage. `src/app/App.tsx:516-537,761`: Beim Beenden wird dagegen bereits ein dreistufiger Ablauf verwendet.

**Aufgabe:** Einen gemeinsamen, verständlichen Schutz für Beenden, neues Projekt und Öffnen eines anderen Projekts schaffen. Auch noch nicht übernommene Projektentwürfe berücksichtigen. Keine Daten verwerfen, bevor der Nutzer dies ausdrücklich gewählt hat.

**Acceptance Criteria**
- Bei ungespeicherten Änderungen stehen **Speichern**, **Nicht speichern** und **Abbrechen** mit eindeutiger Konsequenz zur Verfügung; Escape entspricht Abbrechen.
- Abbrechen, ein abgebrochener oder fehlgeschlagener Speichervorgang und ein abgebrochener Dateidialog lassen das aktuelle Projekt und seine Entwürfe unverändert.
- Beim erfolgreichen Speichern wird der beabsichtigte Wechsel nur ausgeführt, wenn Projekt und relevanter Entwurf seit Beginn des Vorgangs nicht inzwischen verändert wurden.
- Öffnen über Desktop-Dateidialog und Browser-Fallback, neues Projekt und Beenden sind mit gezielten Tests für alle drei Entscheidungen und Fehlerfälle abgedeckt.
- Die Browser-Navigation beziehungsweise das Schließen des Browser-Tabs wird gesondert geprüft; soweit technisch unterstützt, warnt sie bei ungespeicherter Arbeit.

### A02 – Höhenprofil gleichwertig bedienen

**Beleg:** `src/components/elevation-profile/ElevationProfile.tsx:201-218,327-413` aktualisiert die Detailanzeige über `onMouseMove` und entfernt sie bei `onMouseLeave`; das SVG ist als Bild beschrieben, aber nicht als interaktives Bedienelement.

**Aufgabe:** Eine tastatur- und klickfähige Profilnavigation mit verständlicher Rückmeldung ergänzen.

**Acceptance Criteria**
- Profilpositionen einschließlich Start und Ende sind ohne Hover mit Tastatur und mit Klick auswählbar; die aktuelle Position, Höhe, Entfernung und Zeit sind sichtbar und zugänglich.
- Die Kartenmarkierung und Profilanzeige bleiben bei allen Eingabemethoden synchron; Escape beziehungsweise ein klarer Befehl entfernt die Auswahl.
- Bei leerem Profil oder fehlenden Höhenwerten erscheint ein erklärender Zustand statt einer funktionslosen Interaktion.
- Tests prüfen Anfang, Ende, Auswahlwechsel, Abbruch, fehlende Daten und Synchronisation ohne externe Dienste.

### A03 – Modal- und Fokusvertrag vereinheitlichen

**Beleg:** Einstellungen und Info setzen Fokus, behandeln Tab und stellen den Ausgangsfokus wieder her (`src/components/settings/SettingsDialog.tsx:21-60`, `src/components/about/AboutDialog.tsx:77-119`). Routen-, POI- und Neuer-Routen-Dialog behandeln dagegen nur Escape (`src/components/routes/RouteEditor.tsx:49-58`, `src/components/points/PointEditor.tsx:24-42`, `src/components/routes/RouteCreationDialog.tsx:11-19`); initialer Fokus ist nur für Teile davon gesetzt (`src/app/App.tsx:180-188`).

**Aufgabe:** Für alle modalen Dialoge denselben nachvollziehbaren Fokus- und Schließvertrag einführen, ohne das bestehende `inert`-Konzept und Portal-Verhalten zu brechen.

**Acceptance Criteria**
- Beim Öffnen erhält ein sinnvoller, auch bei schreibgeschütztem Inhalt verfügbarer Dialoginhalt Fokus; Tab und Shift+Tab bleiben innerhalb des aktiven Dialogs.
- Escape schließt nur die oberste Ebene; ein geöffneter POI-Symbolwähler wird vor dem umgebenden Dialog geschlossen.
- Nach Schließen durch Übernehmen, Abbrechen oder Escape wird der Fokus an den auslösenden Bedienpunkt zurückgegeben; wenn dieser nicht mehr existiert, an einen sinnvollen Ersatz.
- Mausinteraktionen außerhalb des Dialogs und das Verhalten bei ungespeicherten Entwürfen sind konsistent und ausdrücklich festgelegt; Dialogname und Modalzustand sind zugänglich.
- Tests decken Neuer-Routen-, Routen-, POI-, Info-, Cache-, Einstellungen-, Update- und Beenden-Dialog einschließlich schreibgeschützter Inhalte und verschachtelter Ebenen ab.

### A04 – Textkontrast und Lesbarkeit verbessern

**Beleg:** `src/app/base.css:9-10,250-257` und `src/components/routes/RouteList.css:118-121` verwenden `--faint: #60727d` für kleine Texte. Rechnerisch ergibt dies auf `#17232a` **3,21:1** und auf `#121b21` **3,49:1**, unter 4,5:1 für normalen Text. In `src/components/routes/RouteEditor.css:125-130,175-180` und `src/components/elevation-profile/ElevationProfile.css:207-212` stehen Labels teils bei 9–10 px.

**Aufgabe:** Semantische Textfarben und Typografiestufen so überarbeiten, dass wichtige Informationen auf allen tatsächlichen Flächen lesbar sind.

**Acceptance Criteria**
- Normaler Text und Platzhalter mit Informationsfunktion erreichen mindestens 4,5:1; großer Text mindestens 3:1. Deaktivierte Elemente werden nicht mit verfügbaren Informationen verwechselt.
- Projekt-/Routenmetadaten, Editorlabels, Profilachsen, Status und Read-only-Kennzeichnungen sind bei 100 % sowie 200 % Textskalierung lesbar und bleiben funktionsfähig.
- Kontraste werden für tatsächliche Vorder- und Hintergründe inklusive Transparenz, Fokus, Hover und Fehlerzuständen geprüft; Ergebnisse und Ausnahmen sind nachvollziehbar.
- Visuelle Anpassungen erhalten die Unterscheidung zwischen dunkler App-Oberfläche und heller Karte.

### A05 – Dokumentsprache und Fokusindikatoren korrigieren

**Beleg:** `index.html:2` setzt `lang="en"`, obwohl die Oberfläche überwiegend deutsch ist. `src/components/routes/RouteEditor.css:78-87` entfernt bei Editorfeldern die Outline; `src/app/base.css:169-172` ändert beim Fokus nur die Rahmenfarbe.

**Aufgabe:** Sprachkennzeichnung und sichtbaren Tastaturfokus für alle Eingaben und Aktionen systematisch korrigieren.

**Acceptance Criteria**
- Die tatsächliche Oberflächensprache ist am Dokument angegeben; ausdrücklich anderssprachige Inhalte sind bei Bedarf lokal gekennzeichnet.
- Jedes per Tastatur erreichbare Element einschließlich Textfeldern, Dropdowns, Farbauswahl, Kartenwerkzeugen und Dialogaktionen besitzt einen klar sichtbaren Fokusindikator, der nicht allein von einer schwachen Rahmenfarbänderung abhängt.
- Der Fokus ist auf hellen und dunklen Flächen sowie bei 200 % Skalierung sichtbar und wird nicht von Overlays verdeckt.
- Ein gezielter Test prüft die Dokumentsprache; eine dokumentierte Tastaturprüfung prüft Fokusreihenfolge und Sichtbarkeit.

### A06 – Aufgaben und Zustände besser auffindbar machen

**Beleg:** `src/app/App.tsx:851-855` bündelt „Neue Route erstellen oder GPX importieren“ hinter einem Plus; die Wahl folgt erst in `src/components/routes/RouteCreationDialog.tsx:20-45`. `src/components/map/MapToolbar.tsx:150-194` verwendet überwiegend reine Icons. Hinweise zum aktiven Werkzeug werden in `src/app/App.tsx:264-274` temporär angezeigt.

**Aufgabe:** Die ersten Schritte und zentralen Aktionen im bestehenden Layout klarer vermitteln; ein vollständiges Redesign ist nicht erforderlich.

**Acceptance Criteria**
- Nutzer können ohne Rätselraten eine neue Route anlegen, GPX importieren, den aktiven Bearbeitungsmodus erkennen und zu dessen nächstem Schritt gelangen.
- Leere Routenliste, leere Route und schreibgeschützter Import besitzen hilfreiche, zum jeweiligen Zustand passende Hinweise und nächste Schritte.
- Aktionen, die wegen Modus oder Zustand nicht verfügbar sind, machen den Grund und einen möglichen nächsten Schritt verständlich.
- Platzierung und Beschriftung der Projekt-, Import-, Export-, Karten- und Diagnosefunktionen werden auf Aufgabenbezug geprüft; bestehende Funktionen und Attributionen bleiben zugänglich.

### A07 – Menü- und Panelbedienung harmonisieren

**Beleg:** Das Hauptmenü unterstützt Pfeiltasten, Home und End (`src/components/project/ProjectHeader.tsx:65-82`); das Routenmenü hat ebenfalls `role="menu"`, behandelt aber nur Escape (`src/components/routes/RouteList.tsx:120-128`). Suche, Layer und OSM-Orte haben unterschiedliche Fokus- und Schließabläufe (`src/components/map/MapToolbar.tsx:87-133`, `src/components/map/layers/LayerControl.tsx:15-35`, `src/components/map/PlacesControl.tsx:112-133`).

**Aufgabe:** Für Menüs und nichtmodale Kartenpanels jeweils einen konsistenten Interaktionsvertrag festlegen und implementieren.

**Acceptance Criteria**
- Menüs mit Menüsemantik unterstützen Öffnen, Pfeiltasten, Home/End, Escape und Fokusübergabe entsprechend ihrem gewählten Muster; alternativ wird bewusst eine einfachere passende Semantik verwendet.
- Suche, Layer und Orte lassen sich mit Tastatur öffnen, bedienen und schließen; Escape und explizites Schließen führen vorhersehbar zum auslösenden Element zurück.
- Klick außerhalb schließt nur das passende Panel, ohne den Fokus vom tatsächlich angeklickten Ziel wegzunehmen.
- Automatisierte Interaktionstests prüfen die Verträge einschließlich Wechsel zwischen Panels.

### A08 – Trefferflächen und Dichte verbessern

**Beleg:** Kartenwerkzeuge sind `30 × 30 px` (`src/app/Map.css:46-50`), das Routenmenü `26 × 26 px` (`src/components/routes/RouteList.css:141-145`) und Farbfelder `17 × 17 px` (`src/components/routes/RouteEditor.css:197-200`).

**Aufgabe:** Trefferflächen vergrößern, ohne die Karte unnötig zu verdecken oder lediglich die Grafik aufzublasen.

**Acceptance Criteria**
- Häufige Aktionen erreichen mindestens 44 × 44 CSS-Pixel nutzbare Trefferfläche oder erhalten bei räumlich begründeten Ausnahmen eine gleichwertige, dokumentierte Alternative; die sichtbaren Symbole dürfen kleiner bleiben.
- Benachbarte Trefferflächen überlappen nicht und sind mit Maus und, soweit vom Gerät unterstützt, Touch eindeutig auslösbar.
- Zoom, Kartenwerkzeuge, Routenmenü, Farbauswahl, Schließen und Projektaktionen werden bei normaler und erhöhter Skalierung überprüft.

### A09 – Design-Tokens und Buttonhierarchie konsolidieren

**Beleg:** Grundtokens existieren in `src/app/base.css:1-14`; Kartenflächen und Zustände enthalten daneben viele direkte Farbwerte (`src/app/Map.css:46-88,508-519`). Dialoge definieren unterschiedliche Buttonstile, etwa `src/components/settings/SettingsDialog.css:66-82`, `src/components/update/UpdateDialog.css:38-46` und `src/components/routes/RouteEditor.css`.

**Aufgabe:** Vorhandene Gestaltung in ein kleines semantisches System für Flächen, Text, Rahmen, Fokus und Aktionen überführen. Helle Kartenoberflächen bleiben eine eigene, bewusst definierte Variante.

**Acceptance Criteria**
- Primär-, Sekundär-, Gefahr-, Icon- und deaktivierte Aktionen haben dokumentierte, über alle Dialoge und Panels konsistente Zustände für Standard, Hover, Fokus und Aktivierung.
- Die visuellen Unterschiede zwischen „Übernehmen“, „Abbrechen“ und destruktiven Aktionen sind verständlich; Reihenfolge und Bezeichnungen sind innerhalb gleichartiger Dialoge konsistent.
- Wiederkehrende Farben und Zustände verwenden gemeinsame semantische Tokens; Routenfarben, Karteninhalte und Provider-Attributionen bleiben fachlich unverändert.
- Bestehende Funktionalität und Kontraste werden bei der Umstellung überprüft; kein unnötiger Theme-Wechsel oder Schriftaustausch.

### A10 – Icon-System und Farbauswahl verständlich machen

**Beleg:** Kartenwerkzeuge verwenden eigene SVGs (`src/components/map/MapToolbar.tsx:12-49`); POI-Symbole kombinieren eigene und Carto-Symbole über eine gemeinsame Registry (`src/integrations/map/poiIcons.ts:10-29,31-130`). Farbfelder sind kleine, nur durch Hexwert betitelte Buttons ohne expliziten Auswahlzustand (`src/components/routes/RouteEditor.tsx:128-138`). `×` steht je nach Kontext für Schließen, Abbrechen oder Löschen (`src/components/points/PointEditor.tsx:129-155`).

**Aufgabe:** Eine knappe Icon-Konvention für Bedeutung, Zeichenfläche, Strichstärke, Zustand und Zugänglichkeit festlegen; vorhandene POI-IDs und Herkunft erhalten.

**Acceptance Criteria**
- Unterschiedliche Aktionen wie Schließen, Abbrechen und Löschen sind durch Text, Kontext oder eindeutig unterschiedene Symbole unterscheidbar; reine Iconbuttons haben verständliche zugängliche Namen.
- Kartenwerkzeuge und POI-Auswahl verwenden ein konsistentes visuelles Raster und gut erkennbare aktive, inaktive und fokussierte Zustände; bestehende OSM-/Carto-Lizenzen und Attributionspflichten bleiben erhalten.
- Farbfelder haben verständliche Namen und einen programmatisch ermittelbaren Auswahlzustand; die aktuelle beziehungsweise Standardfarbe ist auch ohne Farbwahrnehmung erkennbar.
- Die Auswahl ist mit Tastatur bedienbar; Tests prüfen Namen, Auswahlzustand, Standardfarbe und benutzerdefinierte Farbe.

### A11 – Fehlende Messwerte und Datenqualität klar ausweisen

**Beleg:** In der Startansicht zeigt die leere Route bereits `0.0 km`, `1 min` und `0 m` für Höhenwerte; `src/components/elevation-profile/ElevationProfile.tsx:112-128,167-191` ersetzt fehlende Werte teilweise durch Null. Höhenwerte können aus einem Ersatzprovider stammen (`src/domain/routeMetrics.ts:1-6,99-120`).

**Aufgabe:** Nicht verfügbare, berechnete und gegebenenfalls synthetische Informationen für Nutzer unterscheidbar darstellen, ohne Fachlogik oder Providergrenze zu verfälschen.

**Acceptance Criteria**
- Ohne ausreichende Routengeometrie oder Höhendaten zeigt die UI einen erklärten Platzhalter statt scheinbar gemessener Werte und vermeidet ein irreführendes interaktives Profil.
- Geschätzte Dauer und Höhe beziehungsweise Fallback-Daten sind dort erkennbar, wo die zugrunde liegende Datenquelle diese Aussage zuverlässig ermöglicht; unbekannte Herkunft wird nicht erfunden.
- Routenliste und Profil verwenden dieselbe Bedeutung für fehlende Werte und Einheiten.
- Tests decken leere Route, einen Punkt, vorhandene Werte und Fallback-Zustände ab.

### A12 – Rückmeldungen und Cache-Aktionen angleichen

**Beleg:** Projekt-/GPX-Fehler werden über `setNotice` gemeldet (`src/features/project-files/useProjectFiles.ts:43-50,166-188`), und Hinweise verschwinden nach vier Sekunden (`src/app/App.tsx:190-194`). OSM-Cache-Löschung fragt nach (`src/components/map/PlacesControl.tsx:168-170`), Kachelcache-Löschung unmittelbar nicht (`src/components/map/cache/TileCacheControl.tsx:83-97`).

**Aufgabe:** Erfolg, Fortschritt, Fehler und folgenreiche Cache-Aktionen nach einem gemeinsamen Muster behandeln.

**Acceptance Criteria**
- Fehler und Warnungen bleiben ausreichend lange sichtbar oder sind dauerhaft erneut auffindbar, enthalten verständliche nächste Schritte und werden zugänglich angekündigt; flüchtige Erfolgsmeldungen bleiben unterscheidbar.
- Das Löschen einzelner oder aller Kachelcache-Daten erläutert die Folgen und erfordert eine ausdrückliche Bestätigung oder bietet eine echte Wiederherstellung; OSM- und Kachelcache bleiben klar unterscheidbar.
- Abbruch, laufende Aktion und Fehler werden sichtbar behandelt; Tests prüfen die Zustandsübergänge und verhindern versehentliches Löschen.

### A13 – Fenstergrößen und Skalierung absichern

**Beleg:** `src/app/Responsive.css:25-45` behält unter 979 px eine Seitenleiste mit mindestens 240 px neben der Karte bei. `src/components/routes/RouteEditor.css:10-14,67-69` begrenzt die Editorhöhe, setzt beim POI-Editor aber `overflow: visible`. Tauri definiert ein größenveränderbares Fenster ohne explizite Mindestgröße (`src-tauri/tauri.conf.json`, `app.windows`).

**Aufgabe:** Ein sinnvolles Mindestfenster und/oder ein adaptives Layout für kleine Fenster und hohe Textskalierung festlegen und implementieren.

**Acceptance Criteria**
- Bei der festgelegten unterstützten Mindestgröße, bei 200 % Textskalierung und bei niedriger Fensterhöhe bleiben Karte, Navigation und Dialogaktionen erreichbar; es gibt keine ungewollte horizontale Überdeckung oder abgeschnittene Fokusziele.
- POI-Symbolauswahl und lange Dialoginhalte sind scrollbar beziehungsweise anderweitig vollständig erreichbar.
- Fenstergrößen und Skalierung in Web sowie Windows- und Ubuntu-Tauri-WebViews werden ausdrücklich geprüft; falls eine Plattform nicht verfügbar ist, wird dies dokumentiert.
- Die gewählte minimale Fenstergröße und das Verhalten darunter werden dokumentiert; mobile Unterstützung wird nicht behauptet, falls sie nicht zum Produktumfang gehört.

### A14 – Sprach- und Zahlenkonventionen vereinheitlichen

**Beleg:** `src/components/routes/RouteList.tsx:57-59,67-70` mischt `READ-ONLY` und deutsche Texte und formatiert Distanzen mit `toFixed`; weitere Zahlenformate befinden sich unter anderem in `src/components/elevation-profile/ElevationProfile.tsx:113-128`.

**Aufgabe:** Begriffe und Zahlenformate für die bestehende deutsche Oberfläche vereinheitlichen, ohne ein vollständiges Übersetzungssystem vorauszusetzen.

**Acceptance Criteria**
- Schreibgeschützte Inhalte werden in Liste, Editor und Hinweisen gleich benannt und nicht nur durch Farbe oder Englisch gekennzeichnet.
- Sichtbare Zahlen verwenden ein einheitliches, zur Oberflächensprache passendes Dezimal- und Einheitenformat; interne Werte und serialisierte Projekt-/GPX-Formate bleiben unverändert.
- Beispiele für Distanzen, Höhen, Dauer und manuelle Eingaben sind durch Tests für relevante Einheiten und Dezimalwerte abgedeckt.

## Abschlussprüfung nach Umsetzung

Für jedes Arbeitspaket passende bestehende Interaktionstests ergänzen; Karten- und Providerfälle ohne externe Netzdienste testen. Anschließend die betroffenen Nutzerabläufe mit Maus und Tastatur, sichtbarem Fokus und Screenreader sowie bei Fenstergrößen und Skalierung nach A14 prüfen. `npm run build` und `npm run lint` für die Web-Oberfläche ausführen; Tauri auf den verfügbaren Zielplattformen getrennt prüfen. Architektur-, Interaktions- und Nutzeränderungen in der bestehenden Dokumentation und im Changelog nach den Repository-Regeln festhalten.
