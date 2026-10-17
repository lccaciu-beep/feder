# Feder

Handschriftliche Notizen und PDF-Annotation als Progressive Web App für das iPad.
Feder läuft vollständig offline, alle Daten bleiben auf dem Gerät. Es gibt keinen
Server, keinen Login und keine Cloud.

Architektur, Datenformat und Fortschritt stehen in [PLAN.md](PLAN.md).

## Auf dem iPad installieren

1. Die veröffentlichte Version in **Safari** öffnen: <https://lccaciu-beep.github.io/feder/>
2. Teilen-Symbol → **Zum Home-Bildschirm** → Hinzufügen.
3. Feder über das neue Symbol auf dem Home-Bildschirm starten (nicht im Safari-Tab).
   Nur so läuft die App im Vollbild, und Safari löscht die Daten nicht automatisch.
4. Einmal online starten. Danach funktioniert Feder auch ohne Netz.

Unter **Einstellungen → Speicher** siehst du, ob der dauerhafte Speicher aktiv ist.

## Entwicklung

Voraussetzung: Node.js 24.

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

## Auf dem echten iPad im WLAN testen

Service Worker brauchen HTTPS mit einem Zertifikat, dem das iPad vertraut.

1. mkcert installieren: `winget install FiloSottile.mkcert`
2. Zertifikat erzeugen: `powershell -ExecutionPolicy Bypass -File scripts/lan-cert.ps1`
3. Server starten:
   - `npm run dev:lan` – mit Hot Reload, Port 5173
   - `npm run preview:lan` – Produktions-Build mit Offline-Modus, Port 4173
4. Beim ersten Start fragt die Windows-Firewall nach: Zugriff im **privaten** Netzwerk erlauben.
5. Auf dem iPad in Safari `https://<IP>:5173/__feder/rootCA.pem` öffnen (Warnung bestätigen),
   dann **Einstellungen → Profil geladen → Installieren** und
   **Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen → mkcert** aktivieren.
6. `https://<IP>:5173/` öffnen.

Gib die Datei `rootCA-key.pem` aus dem mkcert-Ordner niemals weiter.

## Veröffentlichen

Jeder Push auf `main` startet den Workflow `.github/workflows/deploy.yml`: Typprüfung,
Lint, Unit- und WebKit-Tests, danach Build und Veröffentlichung auf GitHub Pages.
