# Feder – Umsetzungsplan

Stand: 17.10.2026 · Status: **Phasen 1–4 abgeschlossen**

> Bestätigt am 17.10.2026: E1 Svelte 5 · E2 alle Pakete aus §9 · E3 mkcert ·
> E4 öffentliches Repo `feder` mit GitHub Pages. E5–E7 gelten als Empfehlung, solange du nicht widersprichst.

Feder ist eine Offline-PWA für handschriftliche Notizen und PDF-Annotation auf dem
iPad A16 (Safari/WebKit, 60 Hz, Apple Pencil USB-C oder Pencil 1). Es gibt kein
Backend und keine Cloud. Alle Daten bleiben auf dem Gerät.

---

## 0. Offene Entscheidungen (bitte bestätigen oder ändern)

| # | Frage | Meine Empfehlung | Begründung |
|---|-------|------------------|------------|
| E1 | UI-Framework | **Svelte 5** (Runes) | Wird kompiliert und hat fast keine Laufzeit. CSS ist pro Komponente gekapselt, und es braucht weniger Code für Werkzeugleisten, Popover und Bibliothek. Preact + Signals wäre ähnlich klein, braucht aber mehr Boilerplate und kein Scoped CSS. Die Engine bleibt in beiden Fällen framework-frei. |
| E2 | Zusätzliche Abhängigkeiten (Liste siehe §9) | freigeben | Nur Build- und Test-Werkzeuge, dazu `fake-indexeddb` für Vitest. Alles andere (ZIP-Container, Perspektiv-Entzerrung, Formerkennung, Kompression) schreibe ich selbst. |
| E3 | HTTPS im WLAN | **mkcert** (CLI unter Windows, kein npm-Paket) + Vite `server.https` | Safari registriert Service Worker nur mit einem *vertrauenswürdigen* Zertifikat. `@vitejs/plugin-basic-ssl` erzeugt ein selbstsigniertes Zertifikat, damit funktioniert der SW auf dem iPad nicht. Die mkcert-Root-CA wird einmal als Profil auf dem iPad installiert und vertraut. |
| E4 | GitHub-Repo | neues **privates** Repo `feder` unter deinem Account, Pages aus Actions | Pages von privaten Repos braucht GitHub Pro. Ohne Pro muss das Repo öffentlich sein (der Code ist dann sichtbar, deine Daten nicht, die bleiben lokal). → **Bitte sag mir: öffentlich oder privat + Pro?** |
| E5 | Speicherung der Striche | **ein Datensatz pro Element** (Strich, Textbox, Bild …) in Dexie statt eines großen Blobs pro Seite | Autosave schreibt nur Änderungen (append/delete). Undo-Befehle lassen sich direkt als Transaktion abbilden. Das kostet etwas mehr Overhead beim Laden, der durch `bulkGet` über einen Index aber klein bleibt. |
| E6 | Seitenkoordinaten | **PDF-Punkte** (1/72 Zoll), Ursprung oben links | Der PDF-Export rechnet 1:1 ohne Umrechnung. A4 = 595,28 × 841,89 pt. |
| E7 | Backup-Format | eigene Datei `.feder` = **ZIP ohne Kompression (STORE)**, selbst implementiert (~150 Zeilen + CRC32) | Mit jedem ZIP-Tool lesbar, keine Abhängigkeit. PDFs, Bilder und Audio sind ohnehin schon komprimiert. |

Kleinere Entscheidungen treffe ich selbst und halte sie im Abschnitt „Entscheidungslog“ fest.

---

## 1. Architektur

```
┌──────────────────────────── UI (Svelte 5) ─────────────────────────────┐
│ Bibliothek · Editor-Shell · Werkzeugleiste · Seitenleiste · Dialoge    │
│ Einstellungen · Tabs                                                   │
└───────────────▲──────────────────────────────┬─────────────────────────┘
                │ Events / Zustand (Signale)   │ Befehle
┌───────────────┴──────────────────────────────▼─────────────────────────┐
│ Engine (reines TS, ohne DOM-Framework)                                 │
│  input/     Pointer-Pipeline, Palm Rejection, Gesten, Druck-Erkennung  │
│  view/      Kamera (Pan/Zoom), Layout (vertikal/horizontal/unendlich), │
│             Virtualisierung, Kachel-Auflösung                          │
│  render/    Hintergrund (Vorlage/PDF), Ink-Cache-Bitmap, Live-Layer    │
│  ink/       perfect-freehand-Wrapper, Pinsel-Typen, Strich-Glättung    │
│  tools/     Stift, Marker, Radierer, Lasso, Formen, Text, Tape …       │
│  geometry/  BBox, Hit-Tests, Raster-Index, Formerkennung, Homographie  │
│  history/   Befehle (do/undo) → Ops                                    │
└───────────────▲──────────────────────────────┬─────────────────────────┘
                │ geladene Daten               │ Ops (put/delete)
┌───────────────┴──────────────────────────────▼─────────────────────────┐
│ Daten                                                                  │
│  model/     Typen, Schema-Version, Migrationen, Validierung            │
│  storage/   Dexie-DB, Repositories, Autosave-Queue, BlobStore (OPFS)   │
│  pdf/       pdf.js-Worker (Render, Text), pdf-lib (Export)             │
│  io/        Backup/Restore, Export, Web Share, Import                  │
│  search/    Index (PDF-Text, Textboxen, Titel, Tags, Lesezeichen)      │
└────────────────────────────────────────────────────────────────────────┘
```

**Grundsätze**

- Die Engine kennt kein Svelte. Die UI spricht mit ihr über eine kleine Fassade
  (`Editor` mit `setTool()`, `undo()`, `on('selection', …)` usw.). So bleibt die
  Engine einzeln testbar.
- **Single Source of Truth im Speicher:** Das offene Notizbuch liegt als Modell im RAM.
  Jede Änderung ist ein `Command` mit `do()/undo()`. Er erzeugt `Ops`, die die
  Autosave-Queue gedrosselt und transaktional in IndexedDB schreibt.
- Schwere Arbeit läuft in Workern: pdf.js (eigener Worker), OPFS-Schreiben
  (`createSyncAccessHandle` im Worker), Backup-Erzeugung, Suchindex-Aufbau.

### 1.1 Eingabe-Pipeline (minimale Latenz)

1. `pointerdown/move/up/cancel` auf **einem** Viewport-Element mit
   `touch-action: none`. Pro Event `getCoalescedEvents()` (Safari ≥ 17), sonst das
   Event selbst. `getPredictedEvents()` nur, wenn vorhanden. Vorhergesagte Punkte
   werden nur im Live-Layer gezeichnet und nie gespeichert.
2. **Palm Rejection:** Sobald ein `pen`-Pointer aktiv ist oder vor < 300 ms aktiv war,
   werden alle `touch`-Pointer auf der Seite ignoriert. Laufende Finger-Gesten werden
   abgebrochen, wenn der Stift aufsetzt. Option „Mit dem Finger zeichnen“ behandelt
   `touch` wie `pen`. Gesten gehen dann nur mit zwei Fingern.
3. **Druck-Erkennung:** Die ersten ca. 40 Stift-Samples werden ausgewertet. Liegen die
   `pressure`-Werte alle auf einer Konstante (0, 0,5 oder 1) oder schwanken kaum, gilt
   der Stift als „ohne Druck“. Dann nutzt perfect-freehand `simulatePressure`
   (geschwindigkeitsbasiert). Das ist in den Einstellungen umschaltbar
   (Auto / Druck / Geschwindigkeit / konstant).
4. Neigung (`tiltX/tiltY` → Azimut/Altitude) wird gespeichert und von Bleistift und
   Pinsel genutzt (breiter und heller bei flachem Winkel).
5. Zeichnen im Live-Layer per `requestAnimationFrame`. Das Rendering läuft nie im
   Event-Handler selbst. Nur der neue Teil des Strichs wird gezeichnet. Weil
   perfect-freehand den Umriss neu berechnet, wird der aktuelle Strich im Live-Canvas
   komplett neu gezeichnet. Dieser Canvas ist klein (nur die BBox des Strichs), das ist
   günstig.
6. `pointerup` → Strich wird final berechnet, in den Ink-Cache gezeichnet, Live-Layer
   geleert, Command ausgeführt, Autosave angestoßen.

### 1.2 Rendering & Virtualisierung

- **Pro sichtbarer Seite:** `background`-Canvas (Vorlage als Vektor bzw. PDF-Seite),
  `ink`-Canvas (fertige Striche, gecacht) und ein DOM-Layer für Textboxen, Bilder und
  Links (Textboxen als echte `<textarea>`/`contenteditable`, damit **Scribble** dort
  funktioniert).
- **Ein Live-Canvas** liegt über der gerade beschriebenen Seite. Er wird pro
  Strichbeginn auf die Seite gesetzt. Das ist die „zweite Ebene“ aus der Spezifikation,
  aber nur einmal statt pro Seite, das spart Speicher.
- **Virtualisierung:** Nur Seiten im Viewport ± 1 Bildschirmhöhe haben Canvases.
  Canvases werden über einen Pool wiederverwendet.
- **iOS-Canvas-Limits beachten:** Safari begrenzt den gesamten Canvas-Speicher
  (bei 4 GB RAM ca. 384 MB) und die Fläche pro Canvas (~16,7 MP). Deshalb:
  - Auflösung = `min(zoom × devicePixelRatio, Limit)`, in Stufen quantisiert
    (1×, 1,5×, 2×, 3×, 4× …).
  - Ab hohem Zoom **Kachel-Rendering** (512 px-Kacheln) nur für den sichtbaren
    Ausschnitt.
  - Canvases außerhalb des Viewports werden auf 0×0 gesetzt (gibt Speicher in WebKit
    sofort frei).
- **Zoom-Geste:** Während des Pinch nur CSS-`transform` (schnell, kurz unscharf).
  150 ms nach Ende wird in der neuen Auflösungsstufe scharf neu gerendert.
- **Textmarker unter Tinte:** Im Ink-Cache zuerst alle Marker-Striche
  (`globalCompositeOperation = 'multiply'`, im Dunkelmodus `screen`), dann die Tinte.
  Während des Markierens zeigt der Live-Layer die Vorschau per CSS-`mix-blend-mode`.
- **Strich-Cache:** Pro Strich wird der Umriss als `Path2D` gemerkt (LRU). Bei Zoom
  ändert sich nur die Transform, der Pfad bleibt gleich.
- **Dunkelmodus:** Papierfarbe „dunkel“ ist eine Eigenschaft der Seite. Der App-Dunkel-
  modus betrifft die UI. Optional lassen sich helle Seiten invertiert anzeigen
  (Filter nur auf dem Hintergrund, Tintenfarben werden per Palette gespiegelt).

### 1.3 Speicher

- **Dexie/IndexedDB:** Alle strukturierten Daten (§3).
- **OPFS:** PDFs, Bilder, Audio, Scans. Schreiben im Worker per
  `createSyncAccessHandle`, Lesen per `getFile()`. **Fallback:** Blob in einer
  Dexie-Tabelle `blobData`, falls OPFS nicht geht (z. B. im Privatmodus).
- `navigator.storage.persist()` beim ersten Start (und erneut nach Installation auf dem
  Home-Bildschirm). Status und `estimate()` stehen in den Einstellungen.
- **Autosave:** Ops sammeln sich in einer Queue. Geschrieben wird 400 ms nach der
  letzten Änderung, spätestens alle 2 s, und sofort bei `visibilitychange → hidden`
  bzw. `pagehide`. Jede Flush-Runde ist **eine** Dexie-`rw`-Transaktion über alle
  betroffenen Tabellen. Schlägt sie fehl, bleibt die Queue erhalten und es gibt einen
  Hinweis in der UI.

### 1.4 Verlauf (Undo/Redo)

- Ein Stack pro Notizbuch, im RAM, maximal 200 Schritte.
- `Command { label, do(): Op[], undo(): Op[] }`. Zusammengesetzte Befehle
  (z. B. Lasso-Verschieben vieler Elemente) bilden einen Schritt.
- Gesten: Zwei-Finger-Tipp = Undo, Drei-Finger-Tipp = Redo (abschaltbar).
  Tastatur ⌘Z / ⇧⌘Z.

---

## 2. Ordnerstruktur

```
feder/
├─ .github/workflows/deploy.yml       # Build + Test + GitHub Pages
├─ certs/                             # mkcert-Zertifikate (gitignored)
├─ public/
│  ├─ icons/                          # eigene App-Icons (SVG → PNG)
│  └─ templates/                      # (leer, Vorlagen werden generiert)
├─ src/
│  ├─ main.ts                         # Bootstrap, SW-Registrierung, persist()
│  ├─ app/                            # Svelte-UI
│  │  ├─ App.svelte
│  │  ├─ library/                     # Bibliothek, Ordner, Papierkorb
│  │  ├─ editor/                      # Editor-Shell, Toolbar, Seitenleiste, Popover
│  │  ├─ settings/
│  │  ├─ components/                  # Buttons, Sheets, Farbwähler …
│  │  ├─ stores/                      # UI-Zustand (Runes)
│  │  └─ theme/                       # Design-Tokens, Hell/Dunkel
│  ├─ engine/
│  │  ├─ Editor.ts                    # Fassade
│  │  ├─ input/                       # PointerPipeline, PalmRejection, Gestures, PressureDetector
│  │  ├─ view/                        # Camera, PageLayout, Virtualizer, TilePlanner
│  │  ├─ render/                      # BackgroundRenderer, InkCache, LiveLayer, CanvasPool
│  │  ├─ ink/                         # brushes.ts, freehand.ts, dash.ts
│  │  ├─ tools/                       # pen, highlighter, eraser, lasso, shape, text, image, tape, laser …
│  │  ├─ geometry/                    # bbox, hit, spatialIndex, shapeRecognizer, homography
│  │  └─ history/                     # Command, History
│  ├─ model/
│  │  ├─ types.ts                     # alle Datentypen
│  │  ├─ paper.ts                     # Formate, Vorlagen-Definitionen
│  │  ├─ ids.ts                       # ULID-ähnliche IDs
│  │  ├─ codec.ts                     # Punkt-Kodierung (Float32Array)
│  │  └─ migrations/                  # v1 → v2 …
│  ├─ storage/
│  │  ├─ db.ts                        # Dexie-Schema mit Versionen
│  │  ├─ repos/                       # notebooks, pages, items, folders …
│  │  ├─ autosave.ts
│  │  └─ blobstore/                   # opfs.worker.ts, idbFallback.ts, index.ts
│  ├─ templates/                      # Vektor-Generatoren (liniert, kariert, Cornell …)
│  ├─ pdf/                            # import.ts, render.ts, text.ts, export.ts
│  ├─ io/                             # backup.ts, zip.ts, share.ts, imageExport.ts, scan/
│  ├─ search/
│  ├─ audio/
│  ├─ study/                          # Lernkarten
│  └─ platform/                       # Safari-Workarounds, Gesten-Unterdrückung, Tastatur
├─ tests/
│  ├─ unit/                           # Vitest
│  └─ e2e/                            # Playwright (WebKit)
├─ index.html
├─ vite.config.ts
├─ tsconfig.json
├─ PLAN.md
└─ README.md
```

---

## 3. Datenformat (Schema v1)

Alle IDs sind zeitsortierbare Strings (eigene ULID-Variante, 26 Zeichen).
Alle Zeiten sind `number` (ms seit Epoch). Längen sind in PDF-Punkten.

```ts
// ---- Bibliothek ----
interface Folder {
  id: string; parentId: string | null; name: string;
  createdAt: number; updatedAt: number; deletedAt: number | null;
}

interface Notebook {
  id: string; folderId: string | null; title: string;
  kind: 'paged' | 'whiteboard';
  cover: CoverSpec;                       // Farbe/Muster oder blobId
  favorite: boolean;
  pageIds: string[];                      // Reihenfolge
  defaultPaper: PaperSpec;
  createdAt: number; updatedAt: number; openedAt: number | null;
  deletedAt: number | null;               // Papierkorb
}

// ---- Seite & Papier ----
interface PaperSpec {
  width: number; height: number;          // pt; Whiteboard: Infinity-Marker
  color: 'white' | 'yellow' | 'dark' | string;
  template: TemplateRef;
}
type TemplateRef =
  | { kind: 'builtin'; id: 'blank'|'ruled'|'grid'|'dots'|'cornell'|'music'|'planner-week'|'planner-day';
      params: { spacing?: number; margin?: boolean; color?: string } }
  | { kind: 'custom'; templateId: string }          // eigene Vorlage (PDF/Bild)
  | { kind: 'pdf'; blobId: string; pageIndex: number };  // importierte PDF-Seite

interface Page {
  id: string; notebookId: string;
  paper: PaperSpec;
  tags: string[];                         // manuelle Stichworte
  createdAt: number; updatedAt: number;
  thumbBlobId: string | null;             // Miniatur-Cache
}

// ---- Inhalte (eine Tabelle, nach Typ unterschieden) ----
interface ItemBase {
  id: string; pageId: string; notebookId: string;
  z: number;                              // Zeichenreihenfolge (fraktional, sortierbar)
  bbox: [x: number, y: number, w: number, h: number];
  createdAt: number;                      // auch für Audio-Sync
}
interface StrokeItem extends ItemBase {
  type: 'stroke';
  tool: 'fountain' | 'ballpoint' | 'brush' | 'pencil' | 'highlighter';
  color: string; width: number; opacity: number;
  dash: null | 'dashed' | 'dotted';
  pressureMode: 'real' | 'velocity' | 'none';
  stride: 4 | 6;                          // Werte pro Punkt
  points: Float32Array;                   // x, y, pressure, dt[, azimuth, altitude]
  t0: number;                             // Startzeit absolut (Audio-Sync)
}
interface ShapeItem extends ItemBase {
  type: 'shape';
  shape: 'line'|'arrow'|'rect'|'ellipse'|'triangle'|'polygon';
  vertices: number[]; rotation: number;
  stroke: string; fill: string | null; width: number; dash: StrokeItem['dash'];
}
interface TextItem   extends ItemBase { type: 'text';  text: string; style: TextStyle; rotation: number; }
interface ImageItem  extends ItemBase { type: 'image'; blobId: string; crop: Rect; rotation: number; }
interface TapeItem   extends ItemBase { type: 'tape';  path: number[]; width: number; pattern: string; covered: boolean; }
interface StickerItem extends ItemBase { type: 'sticker'; elementId: string; transform: Mat2D; }
interface LinkItem   extends ItemBase { type: 'link'; target:
  { kind: 'url'; url: string } | { kind: 'page'; pageId: string } | { kind: 'notebook'; notebookId: string; pageId?: string } }
type Item = StrokeItem | ShapeItem | TextItem | ImageItem | TapeItem | StickerItem | LinkItem;

// ---- Struktur & Weiteres ----
interface Bookmark  { id: string; notebookId: string; pageId: string; label: string; createdAt: number; }
interface OutlineEntry { id: string; notebookId: string; pageId: string; title: string; parentId: string | null; order: number; }
interface Element   { id: string; name: string; items: Item[]; previewBlobId: string; }  // gespeicherte Lasso-Auswahl / Sticker
interface CustomTemplate { id: string; name: string; blobId: string; pageIndex: number; width: number; height: number; }
interface BlobMeta  { id: string; mime: string; size: number; store: 'opfs' | 'idb'; createdAt: number; refCount: number; }
interface AudioClip { id: string; notebookId: string; blobId: string; startedAt: number; duration: number; }
interface Flashcard { id: string; deckId: string; frontPageId: string; frontRect: Rect; backRect: Rect | null;
                      itemIds: string[]; box: number; due: number; }   // Leitner-System
interface TextIndexEntry { id: string; notebookId: string; pageId: string; source: 'pdf'|'text'|'title'|'tag'|'bookmark';
                           text: string; norm: string; }              // norm = kleingeschrieben, ohne Diakritika
interface Setting   { key: string; value: unknown; }
interface Meta      { key: 'schemaVersion' | 'lastBackupAt' | 'installId'; value: unknown; }
```

**Dexie-Schema v1 (Indizes)**

```ts
db.version(1).stores({
  folders:   'id, parentId, deletedAt',
  notebooks: 'id, folderId, deletedAt, openedAt, favorite, updatedAt',
  pages:     'id, notebookId',
  items:     'id, pageId, notebookId, [pageId+z]',
  bookmarks: 'id, notebookId, pageId',
  outline:   'id, notebookId',
  elements:  'id',
  templates: 'id',
  blobs:     'id',
  blobData:  'id',              // nur OPFS-Fallback
  audio:     'id, notebookId',
  cards:     'id, deckId, due',
  decks:     'id',
  textIndex: 'id, pageId, notebookId, *tokens',
  settings:  'key',
  meta:      'key',
});
```

**Versionierung & Migrationen**

- `SCHEMA_VERSION` steht in `meta`. Dexie-Versionen ändern Indizes, und
  `upgrade()`-Funktionen in `model/migrations/` formen Daten um.
- Exportdateien (`.feder`) tragen `formatVersion`. Beim Import läuft dieselbe
  Migrationskette, bevor etwas in die DB geht.
- Jede Migration hat einen Vitest mit einer gespeicherten Beispieldatei der Vorversion.

**Backup-/Notizbuch-Datei `.feder`** (ZIP, STORE)

```
manifest.json      { app: 'feder', formatVersion, createdAt, kind: 'backup'|'notebook', counts }
data/*.json        Tabellen als JSON (Float32Array → Base64)
blobs/<id>         Rohdateien (PDF, Bilder, Audio)
```

Restore liest zuerst `manifest.json`, migriert, prüft Referenzen und schreibt dann in
**einer** Transaktion. Optionen: „ersetzen“ oder „zusammenführen (neue IDs)“.

---

## 4. Safari/iPad-Spezifika

| Thema | Umsetzung |
|-------|-----------|
| Systemgesten | `touch-action: none` auf dem Viewport; `user-select: none`, `-webkit-user-select: none`, `-webkit-touch-callout: none` global (außer in Textboxen); `gesturestart/gesturechange` → `preventDefault`; Viewport-Meta `maximum-scale=1, user-scalable=no` zusätzlich; `dblclick` unterdrücken; `contextmenu` unterdrücken. |
| Lupe / Long-Press | `-webkit-touch-callout: none` + `preventDefault` auf `touchstart` im Viewport (passive: false). |
| Scribble | Der Canvas ist kein editierbares Element, deshalb startet Scribble dort nicht. Textboxen sind echte editierbare Elemente, dort funktioniert Scribble. Während eines Strichs ist keine Textbox fokussiert. |
| Standalone | `display: standalone`, `apple-mobile-web-app-capable`, `env(safe-area-inset-*)`, Statusleiste `black-translucent`, eigene Splash-Farben. |
| Layout | Container Queries für Split-View-Breiten (⅓, ½, ⅔, voll). Kompakte Werkzeugleiste unter 700 px. |
| Speicher | Home-Screen-Web-Apps sind von Safaris 7-Tage-Löschung ausgenommen. Trotzdem `persist()` und Backup-Erinnerung. |
| Tastatur | ⌘Z/⇧⌘Z, P Stift, H Marker, E Radierer, L Lasso, S Formen, T Text, ⌘F Suche, ←/→ bzw. ⇞/⇟ Seiten, ⌘N neue Seite, ⌘W Tab schließen, ⌘1–9 Tabs. |
| Nicht eingebaut | Hover, Doppeltippen des Pencils, Squeeze (laut Spezifikation). |

---

## 5. Tests & Qualität

- **Vitest** (jsdom + `fake-indexeddb`): Datenmodell, Codec, Migrationen,
  Repositories, Autosave-Queue, Undo/Redo, Geometrie (Hit-Tests, Formerkennung,
  Homographie), ZIP-Writer/-Reader, Backup-Roundtrip, PDF-Export (Roundtrip mit
  pdf-lib: Seitenzahl, Maße, Annotationen vorhanden).
- **Playwright (WebKit):** Smoke-Tests: App startet offline (nach SW-Install),
  Notizbuch anlegen, Strich mit synthetischen `pointerType: 'pen'`-Events zeichnen
  (über `page.dispatchEvent` mit PointerEvent-Init), Reload → Strich ist noch da,
  Undo, Radierer, PDF-Import.
- **Performance-Budget:** Eingabe → Pixel < 1 Frame im Live-Layer.
  `pointermove`-Handler < 1 ms, Ink-Cache-Neuzeichnen einer vollen Seite < 16 ms.
  Ein Debug-Overlay (FPS, Frame-Zeiten, Samples/Frame) lässt sich in den
  Einstellungen einschalten.
- CI führt `typecheck`, `lint`, `vitest` und `playwright` vor dem Deployment aus.

---

## 6. Deployment & Testen auf dem iPad

1. **GitHub Pages:** Workflow `deploy.yml` baut bei Push auf `main`, testet und
   deployt. Vite `base` = `/<repo>/`. Der Service Worker nutzt den `scope` passend
   dazu. URL: `https://<user>.github.io/feder/`.
2. **Lokal im WLAN (HTTPS):**
   - `winget install FiloSottile.mkcert` → `mkcert -install` →
     `mkcert -cert-file certs/dev.pem -key-file certs/dev-key.pem <LAN-IP> localhost`
   - `rootCA.pem` (Pfad über `mkcert -CAROOT`) per AirDrop/Mail aufs iPad, als Profil
     installieren, dann **Einstellungen → Allgemein → Info → Zertifikatsvertrauen** →
     aktivieren.
   - `npm run dev:lan` startet Vite auf `0.0.0.0:5173` mit HTTPS. Im Dev-Modus ist der
     SW über `devOptions` aktiv.
   - Ich lege dafür ein Skript `scripts/lan-cert.ps1` an, das die IP findet und das
     Zertifikat erzeugt.
3. **Remote-Debugging:** Safari am Mac (Entwickler → iPad) wäre ideal. Unter Windows
   gibt es das nicht. Dafür baue ich ein **In-App-Log-Panel** (Fehler, Pointer-Statistik)
   ein, das man in den Einstellungen öffnet.

---

## 7. Handschrifterkennung – Prüfauftrag (Phase 4)

Ich recherchiere und berichte **vor** dem Einbau. Kandidaten, die ich prüfe:
ONNX-Runtime-Web/WebGPU mit einem kleinen Online-HWR-Modell (Striche statt Pixel),
TrOCR-small (offline, Bildbasiert), Tesseract (kein echtes Handschriftmodell) und
die W3C Handwriting Recognition API (bisher nur Chromium). Kriterien: Download-Größe
(Ziel < 30 MB), Qualität für DE/EN, Laufzeit auf dem A16, Lizenz. Bis dahin gibt es
manuelle Tags.

---

## 8. Phasen-Checklisten

Nach jeder Phase: `npm run build`, alle Tests, Git-Commit, Checkliste aktualisieren,
iPad-Prüfliste an dich.

### Phase 1 – Fundament ✅
- [x] Git-Repo, Vite + TS strict + Svelte 5, ESLint/Prettier-Config, Ordnerstruktur
- [x] vite-plugin-pwa: Manifest, eigene Icons, Precache, Offline-Fallback, Update-Hinweis
- [x] GitHub-Actions-Workflow → Pages; mkcert-Skript + `dev:lan`/`preview:lan`
- [x] Dexie-Schema v1, Repositories, Migrations-Gerüst, `persist()` + `estimate()`
- [x] BlobStore (OPFS-Worker + IDB-Fallback)
- [x] Bibliothek: Ordner/Unterordner, Raster/Liste, Sortierung, Favoriten, Zuletzt, Papierkorb, Umbenennen, Duplizieren, Verschieben (Drag & Drop + Dialog), Mehrfachauswahl, Titel-Suche, Cover ändern
- [x] Notizbuch anlegen: A4/A5/Letter/eigenes Maß, Hoch/Quer, Papierfarbe, Cover
- [x] Vektor-Vorlagen: blanko, liniert (3 Abstände, Randlinie), kariert, gepunktet, Cornell, Notenlinien, Wochen-/Tagesplaner; Vorlage pro Seite oder für alle Seiten ändern
- [x] Editor-Shell: Werkzeugleiste oben, vertikal/horizontal blättern (seitlich mit Einrasten), Seitenleiste mit Miniaturen, Seiten hinzufügen/duplizieren/löschen/umsortieren
- [x] Engine: Pointer-Pipeline (coalesced/predicted mit Fallback), Palm Rejection (inkl. Zurücknehmen von Handballen-Scrollen), Druck-Erkennung, Finger-Zeichnen-Option
- [x] Rendering: Hintergrund + Ink-Cache + Live-Layer, Virtualisierung, Auflösungsstufen, Detail-Canvas bei starkem Zoom
- [x] Stift: Füller, Kugelschreiber, Pinsel, Bleistift (Körnung, Neigung); Schnellfarben, Palette, Stärken-Presets, gestrichelt/gepunktet, „zeichnen und halten“ → gerade Linie (rastet bei 0°/45°/90° ein)
- [x] Textmarker (unter Tinte, optional gerade)
- [x] Radierer: ganzer Strich, Präzision (Strich-Split), 3 Größen, „nur Textmarker“, Zickzack-Löschen
- [x] Zwei-Finger-Pan/Zoom mit Schwung und scharfem Neu-Rendern; Mausrad/Trackpad
- [x] Undo/Redo (Buttons, ⌘Z/⇧⌘Z, vorgezogen: 2-/3-Finger-Tipp), Autosave-Queue
- [x] Safari-Gesten-Unterdrückung, Safe Areas, schmale Breiten (Split View)
- [x] Tests: 52 Unit-Tests (Modell, Codec, Bibliothek, Autosave, Verlauf, Geometrie, Eingabe, Kamera, BlobStore), 8 WebKit-Smoke-Tests (Stift-Eingabe simuliert)

### Phase 2 – Werkzeuge ✅
- [x] Lasso: Freihand, Rechteck, Kreis-um-Inhalt bietet Auswahl an; verschieben, skalieren, drehen (mit Einrasten), umfärben, kopieren/ausschneiden/einfügen, duplizieren, löschen, als Bild teilen, als Element speichern; Auswahl auch mit dem Finger bewegen
- [x] Formen: eigenes Werkzeug und „zeichnen und halten“ beim Stift; Linie, Pfeil, Rechteck, Ellipse/Kreis, Dreieck, Polygon; Füllung, Strichart; Eckpunkte nachträglich verschiebbar
- [x] Textboxen: echtes Textfeld (Tastatur, Diktat, Scribble), Schriftart, Größe, Farbe, fett/kursiv, Ausrichtung; Antippen bearbeitet vorhandenen Text
- [x] Bilder: einfügen (Datei/Fotos, ⌘V), große Fotos werden auf 2400 px verkleinert, zuschneiden, um 90° drehen, frei drehen/skalieren per Lasso
- [x] Tape: ziehen legt Streifen, Antippen (Stift oder Finger) deckt auf/zu
- [x] Elemente: Auswahl speichern, Bibliothek mit Vorschau, einfügen, löschen
- [x] Laserpointer (leuchtende Spur, verblasst)
- [x] Zoom-Fenster am unteren Rand: Schreiben vergrößert, automatischer Vorschub, „Neue Zeile“, Rahmen per Finger-Tipp versetzen
- [x] Radierer entfernt auch Formen und Tape
- [x] Gesten: 2-Finger-Tipp Undo, 3-Finger-Tipp Redo; Tastaturkürzel P H E L S T B X, ⌘A/⌘C/⌘X/⌘V/⌘D, Entf, Esc
- [x] PDF-Export enthält Formen, Text (Standardschriften), Bilder (inkl. Zuschnitt/Drehung) und Tape
- [x] Tests: Formerkennung, Transformationen, Treffertests, Export aller Typen; E2E: Formen, Lasso, Kreis-Auswahl, Text, Tape, Bild, Zoom-Fenster

### Phase 3 – PDF & Daten ✅
- [x] PDF-Import (Datei + Drag & Drop) → OPFS, Seiten als `pdf`-Vorlage; PDF in bestehendes Notizbuch einfügen
- [x] pdf.js im Worker, scharfes Ausschnitt-Rendering beim Zoomen, Offline-Zusatzdateien (CMaps, Schriften, WASM)
- [x] Links in PDFs: Web-Links öffnen, interne Links springen zur Seite (Finger-Tipp)
- [x] PDF-Text wird beim Import für die Suche indexiert
- [x] Eigene Vorlagen aus PDF (eine pro Seite, max. 20) oder Bild; Vorlagen verwalten/löschen
- [x] Kamera-Scan: Foto oder Bild, vier Ecken setzen, perspektivische Entzerrung (eigene Homographie), Filter Farbe/Graustufen/Schwarzweiß (lokaler Schwellwert); als Seite oder neues Notizbuch
- [x] Export PDF/PNG/.feder, Teilen, Vollbackup + Restore, Backup-Erinnerung
- [x] Bild-Hintergründe (Scans, Vorlagen) in Ansicht, Zoom-Fenster, Miniaturen und PDF-Export
- [ ] Große PDFs (500+ Seiten): Import liest Größen/Links/Text sequenziell – auf dem iPad messen
- [x] Tests: Homographie, Entzerrung, Suchtext, Routen; E2E: PDF-Link, Scan, eigene Vorlage

### Phase 4 – Suche & Struktur ✅
- [x] Suchindex: PDF-Text (beim Import), Textfelder (automatisch, auch bei Undo), Titel; normalisiert (Umlaute/ß/Akzente), Wortanfänge
- [x] Suche in der Bibliothek (Titel + Inhalte, gruppiert nach Notizbuch) und im Notizbuch (⌘F) mit Trefferliste
- [x] Trefferhervorhebung auf PDF-Seiten (Textpositionen aus pdf.js) und in Textfeldern
- [x] Gliederung: PDF-Inhaltsverzeichnis wird übernommen, eigene Einträge, einrücken/ausrücken, umbenennen
- [x] Lesezeichen (Leiste ⌘B, Seitenmenü), Liste in der Seitenleiste
- [x] Hyperlinks: Webseite, Seite, anderes Notizbuch – über einer Lasso-Auswahl; Finger-Tipp öffnet
- [x] Stichworte pro Seite, in Suche und Seitenleiste sichtbar, als Filter-Chips in der Notizbuchsuche
- [x] **Bericht Handschrifterkennung** → [docs/handschrifterkennung.md](docs/handschrifterkennung.md) – **Entscheidung offen**
- [x] Tests: Suche (Phrase, Wortanfang, Umlaute), Index für Textfelder inkl. Undo; E2E: Notizbuchsuche, Bibliothekssuche, Lesezeichen, Link

### Phase 5 – Erweiterungen
- [ ] Audio: Aufnahme (MediaRecorder, `audio/mp4`), Striche mit `t0`, synchrones Hervorheben bei Wiedergabe, Strich antippen → Sprung
- [ ] Whiteboard: unendliche Leinwand mit Kachel-Virtualisierung
- [ ] Tabs für mehrere offene Notizbücher, Lesemodus
- [ ] Lernkarten aus Lasso-Auswahl, Lernmodus (Leitner, 5 Boxen)
- [ ] Tests: Audio-Zeitzuordnung, Leitner-Logik, Whiteboard-Koordinaten

### Phase 6 – Feinschliff
- [ ] Einstellungen komplett (Eingabe, Druckmodus, Gesten, Darstellung, Speicher, Backup)
- [ ] App-Sperre per Code (PBKDF2-Hash lokal, Sichtschutz, Sperre bei Hintergrund)
- [ ] Performance-Pass auf dem A16 (Profiling-Overlay, Speicher, Kaltstart)
- [ ] Barrierefreiheit: Labels, Fokus-Reihenfolge, Kontrast, Reduced Motion, Dynamic Type
- [ ] README mit Installationsanleitung („Zum Home-Bildschirm“), mkcert-Anleitung, Backup-Hinweise

---

## 9. Abhängigkeiten

**Laut Spezifikation vorgegeben**
`typescript`, `vite`, `vite-plugin-pwa` (inkl. Workbox), `perfect-freehand`,
`pdfjs-dist`, `pdf-lib`, `dexie`, `vitest`, `@playwright/test`

**Neu – brauche ich deine Freigabe (E2)**

| Paket | Art | Wofür |
|-------|-----|-------|
| `svelte`, `@sveltejs/vite-plugin-svelte`, `svelte-check` | dep/dev | UI-Framework (E1) |
| `fake-indexeddb` | dev | IndexedDB in Vitest |
| `@types/node` | dev | Typen für `vite.config.ts` |
| `workbox-window` | dep | Peer-Abhängigkeit von vite-plugin-pwa (Update-Hinweis) |
| `pdfjs-dist` 6.4, `pdf-lib` 1.17 | dep | laut Spezifikation (PDF-Darstellung bzw. -Export) |
| `jsdom` | dev | DOM-Umgebung für Vitest |
| `eslint`, `typescript-eslint`, `eslint-plugin-svelte`, `prettier`, `prettier-plugin-svelte` | dev | Codequalität (optional, kann auch weg) |

Keine Laufzeitabhängigkeiten über die Vorgaben hinaus.

---

## 10. Entscheidungslog

| Datum | Entscheidung |
|-------|--------------|
| 17.10.2026 | Svelte 5, mkcert, öffentliches Repo `feder` (vom Nutzer bestätigt) |
| 17.10.2026 | Ein globaler Live-Canvas statt einem pro Seite (Speicher-Limit von iOS) |
| 17.10.2026 | Präzisionsradierer teilt Striche in neue Striche auf (keine Masken) |
| 17.10.2026 | TypeScript 6.0 statt 7.0: svelte-check und typescript-eslint unterstützen 7 noch nicht |
| 17.10.2026 | Canvas-Obergrenze 8 MP pro Seite; darüber zeigt ein Detail-Canvas nur den sichtbaren Ausschnitt scharf |
| 17.10.2026 | IDB-Fallback speichert ArrayBuffer statt Blob (Safari-Blob-Probleme in IndexedDB) |
| 17.10.2026 | Simulierter Druck wird beim Schreiben berechnet und gespeichert → Striche sehen beim Neuzeichnen immer gleich aus |
| 17.10.2026 | Auf Wunsch vorgezogen: PDF-Import/Annotation, PDF-/Bild-/Feder-Export, Teilen, Vollbackup (Teile von Phase 3) |
| 17.10.2026 | Wiederherstellen eines Vollbackups ersetzt alles (kein Zusammenführen, damit nichts unbemerkt überschrieben wird) |
| 17.10.2026 | Teilen in zwei Schritten („Datei erstellen“ → „Teilen oder sichern“), weil Safari navigator.share nur direkt nach einem Tipp erlaubt |
| 17.10.2026 | Schema v2: Tabellen für Elemente, Lesezeichen, Outline, Suchindex, Vorlagen, Audio, Lernkarten auf einmal angelegt; Formen bekommen fillOpacity/opacity |
| 17.10.2026 | Text wird auf dem Canvas gezeichnet (gleich wie im Export); bearbeitet wird in einem echten Textfeld darüber (Scribble) |
| 17.10.2026 | Transformationen nur als Ähnlichkeit (Verschieben, gleichmäßig Skalieren, Drehen) – kein Verzerren |
| 17.10.2026 | Design: Löschblatt-Blaugrau, Tinte Blauschwarz, Akzent Königsblau, Schrift Avenir Next (auf dem iPad vorhanden, offline) |
