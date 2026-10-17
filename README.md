# Feder

Handschriftliche Notizen und PDF-Annotation als Progressive Web App für das iPad.
Feder läuft vollständig offline, alle Daten bleiben auf dem Gerät. Es gibt keinen
Server, keinen Login und keine Cloud.

Architektur, Datenformat und Entscheidungen stehen in [PLAN.md](PLAN.md).

## Auf dem iPad installieren

1. Die veröffentlichte Version in **Safari** öffnen: <https://lccaciu-beep.github.io/feder/>
2. Teilen-Symbol → **Zum Home-Bildschirm** → Hinzufügen.
3. Feder ab jetzt **über das Symbol auf dem Home-Bildschirm** starten, nicht im Safari-Tab.
   Safari-Tab und installierte App haben getrennte Speicher; nur die installierte App läuft
   im Vollbild, und nur dort löscht Safari die Daten nicht automatisch.
4. Einmal online starten. Unten erscheint „Feder funktioniert jetzt auch offline“.
5. Neue Versionen kündigen sich mit „Neu laden“ an.

Unter **Einstellungen → Speicher** siehst du, ob der dauerhafte Speicher aktiv ist und wie
viel Platz belegt ist.

## Was Feder kann

**Bibliothek** – Ordner und Unterordner, Raster/Liste, Sortierung, Favoriten, Zuletzt
geöffnet, Papierkorb, Mehrfachauswahl, Ziehen und Ablegen, Suche in Titeln und Inhalten,
Lernkarten.

**Notizbücher** – A4, A5, Letter oder eigenes Maß, Hoch/Quer, Papier weiß/gelb/dunkel,
Vorlagen (blanko, liniert, kariert, gepunktet, Cornell, Notenlinien, Planer), eigene
Vorlagen aus PDF oder Bild, Whiteboard als mitwachsende Fläche.

**Werkzeuge** – Füller, Kugelschreiber, Pinsel, Bleistift (Druck oder Geschwindigkeit,
Neigung), Textmarker, Radierer (ganzer Strich, präzise, nur Textmarker, Durchkritzeln),
Lasso (verschieben, skalieren, drehen, umfärben, kopieren, als Bild teilen, als Element
oder Lernkarte speichern), Formen mit Erkennung, Text (auch Scribble), Bilder (zuschneiden,
drehen), Tape, Elemente, Laserpointer, Zoom-Fenster, Audioaufnahme mit synchroner
Wiedergabe.

**PDF** – Import, Beschriften, Links und Inhaltsverzeichnis werden übernommen, Volltextsuche
mit Markierung, Export als PDF (Handschrift als Vektor), Bild oder Feder-Datei, Kamera-Scan
mit Entzerrung.

**Struktur** – Seitenleiste mit Miniaturen, Gliederung, Lesezeichen, Stichworte, Links,
Tabs, Lesemodus.

## Bedienung

| Geste | Wirkung |
|---|---|
| Pencil | schreibt mit dem aktiven Werkzeug |
| ein Finger ziehen | blättern/verschieben |
| zwei Finger | zoomen und verschieben |
| zwei Finger tippen / drei Finger tippen | rückgängig / wiederholen |
| Finger tippen | Tape auf-/zudecken, Links öffnen, Textfeld setzen (Text-Werkzeug) |
| zeichnen und halten | gerade Linie bzw. erkannte Form |
| Kreis um Inhalt mit dem Stift | „Auswählen“ erscheint |
| Zickzack über Striche | löscht sie |
| Wellenlinie quer durch Text | löscht den durchgestrichenen Text (abschaltbar) |

Mit „Mit dem Finger zeichnen“ (Einstellungen) schreibt der Finger, und gescrollt wird mit
zwei Fingern.

**Tastatur:** P Stift · H Textmarker · E Radierer · L Lasso · S Formen · T Text · B Tape ·
X Laser · ⌘Z / ⇧⌘Z · ⌘F Suche · ⌘B Lesezeichen · ⌘N neue Seite · ⌘A/⌘C/⌘X/⌘V/⌘D ·
Entf löscht die Auswahl · ←/→ Seiten · ⌘+ / ⌘− / ⌘0 Zoom.

## Daten sichern

- **Vollbackup:** Einstellungen → Backup → *Erstellen* → *Teilen oder sichern* (z. B. in
  iCloud Drive). *Backup wiederherstellen* ersetzt den kompletten Stand. Eine Erinnerung
  meldet sich, wenn das letzte Backup zu alt ist.
- **Einzelnes Notizbuch:** lange auf das Cover drücken → *Exportieren …* (PDF, Bild der
  Seite oder Feder-Datei). Feder-Dateien lassen sich über *Neu → Feder-Datei importieren*
  wieder einlesen – als Kopie.
- **App-Sperre:** Einstellungen → App-Sperre. Das ist ein Sichtschutz, keine Verschlüsselung.
  Wer den Code vergisst, kommt nur durch Löschen der Website-Daten wieder hinein.

## Handschrifterkennung

Handschrift wird (noch) nicht in Text umgewandelt. Durchsuchbar sind PDF-Text, Textfelder,
Stichworte, Lesezeichen und die Gliederung. Der Bericht mit Optionen steht in
[docs/handschrifterkennung.md](docs/handschrifterkennung.md).

## Entwicklung

Voraussetzung: Node.js 24. `npm install` kopiert zusätzlich die pdf.js-Dateien nach
`public/pdfjs/`.

```bash
npm install
npm run dev
```

| Befehl | Zweck |
|--------|-------|
| `npm run dev` | Dev-Server auf <http://localhost:5173> |
| `npm run check` | Typprüfung (TypeScript + Svelte) |
| `npm run lint` | ESLint |
| `npm test` | Unit-Tests (Vitest) |
| `npm run test:e2e` | Smoke-Tests in WebKit (Playwright) |
| `npm run build` | Produktions-Build nach `dist/` |
| `npm run icons` | App-Icons aus `public/icons/icon.svg` erzeugen |

Für die E2E-Tests einmalig den WebKit-Browser installieren: `npx playwright install webkit`.

### Auf dem echten iPad im WLAN testen

Service Worker brauchen HTTPS mit einem Zertifikat, dem das iPad vertraut.

1. mkcert installieren: `winget install FiloSottile.mkcert`
2. Zertifikat erzeugen: `powershell -ExecutionPolicy Bypass -File scripts/lan-cert.ps1`
3. Server starten: `npm run dev:lan` (Port 5173, Hot Reload) oder `npm run preview:lan`
   (Port 4173, Produktions-Build mit Offline-Modus).
4. Beim ersten Start fragt die Windows-Firewall: Zugriff im **privaten** Netzwerk erlauben.
5. Auf dem iPad `https://<IP>:5173/__feder/rootCA.pem` öffnen (Warnung bestätigen), dann
   **Einstellungen → Profil geladen → Installieren** und **Einstellungen → Allgemein → Info →
   Zertifikatsvertrauenseinstellungen → mkcert** aktivieren.
6. `https://<IP>:5173/` öffnen.

Die Datei `rootCA-key.pem` aus dem mkcert-Ordner nie weitergeben.

### Veröffentlichen

Jeder Push auf `main` startet `.github/workflows/deploy.yml`: Typprüfung, Lint, Unit- und
WebKit-Tests, danach Build und Veröffentlichung auf GitHub Pages.
