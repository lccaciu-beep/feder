# Bericht: Lokale Handschrifterkennung im Browser (Stand 17.10.2026)

Auftrag aus der Spezifikation: prüfen, ob eine lokale Handschrifterkennung für Deutsch und
Englisch mit vertretbarer Größe und Qualität im Browser machbar ist – **berichten, bevor
etwas eingebaut wird.** Es ist nichts davon eingebaut.

## Was es gibt

| Option | Läuft auf dem iPad (Safari)? | Größe | Deutsch | Bemerkung |
|---|---|---|---|---|
| **W3C Handwriting Recognition API** (`navigator.createHandwritingRecognizer`) | Nein – nur Chromium-Browser (ab Chrome 99) | 0 (vom System) | ja, wo vom System angeboten | Für Safari nicht nutzbar. Quelle: [Chrome-Doku](https://developer.chrome.com/docs/web-platform/handwriting-recognition) |
| **DE·HTR** (CTC-Erkenner für moderne deutsche Handschrift) über ONNX Runtime Web | wahrscheinlich ja (WASM) | Modell ca. 10 MB (int8) + ONNX-Laufzeit | ja | Erkennt nur **einzelne, vorher ausgeschnittene Zeilen**; Englisch nicht belegt; Lizenz vor Einsatz prüfen. Quelle: [Hugging Face](https://huggingface.co/naeyn/de-htr-web) |
| **TrOCR small handwritten** (Microsoft, Transformers.js-Version von Xenova) | wahrscheinlich ja (WASM), langsam | mehrere Dutzend MB (genaue Größe nicht ermittelt) | nein – trainiert auf englischem IAM-Datensatz | Bild-basiert, zeilenweise. Quelle: [Xenova/trocr-small-handwritten](https://huggingface.co/Xenova/trocr-small-handwritten) |
| **ONNX Runtime Web** als Laufzeit | WASM ja; WebGPU-Backend gilt noch als experimentell, Safari laut Doku nicht unterstützt | Laufzeit + WASM einige MB | – | Quellen: [ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html), [npm](https://www.npmjs.com/package/onnxruntime-web), [Transformers.js WebGPU](https://huggingface.co/docs/transformers.js/guides/webgpu) |
| **Scribble von iPadOS** in Textfeldern | ja | 0 | ja | Funktioniert bereits in Feder: Text-Werkzeug antippen und mit dem Pencil ins Feld schreiben – das System wandelt in Text um. |

Ein fertiges, offenes **Online-Ink-Modell** (Strichfolgen statt Bild) für Deutsch+Englisch,
das direkt im Browser läuft, habe ich nicht gefunden.

## Was ein Einbau bedeuten würde

1. Neue Abhängigkeit `onnxruntime-web` (bräuchte deine Freigabe) und ein Modell im
   Offline-Cache: grob 15–25 MB zusätzlich.
2. Eigene Zeilenerkennung: Striche einer Seite zu Zeilen gruppieren, jede Zeile als Bild
   rendern, Zeile für Zeile erkennen (im Worker, im Hintergrund nach dem Schreiben).
3. Ergebnis als zusätzlicher Suchtext (`textIndex`, Quelle „Handschrift“) – die Suche ist
   dafür schon vorbereitet.
4. Qualität: Für deutsche Schrift gibt es mit DE·HTR einen Kandidaten, für Englisch nur TrOCR
   (andere Architektur, groß, langsam). Wie gut beides mit deiner Handschrift auf dem A16
   funktioniert, lässt sich nur auf dem Gerät messen.

## Empfehlung

- **Jetzt:** manuelle Stichworte (eingebaut) und Scribble in Textfeldern nutzen.
- **Optional als nächster Schritt:** ein Prototyp mit DE·HTR + ONNX Runtime Web als
  **abschaltbarer Zusatz-Download** in den Einstellungen (nicht im Grundpaket), zuerst nur
  Deutsch. Vorher Lizenz des Modells prüfen und auf deinem iPad Geschwindigkeit und
  Trefferquote an echten Notizen messen. Englisch erst, wenn sich ein kleines, gutes Modell
  findet.

**Entscheidung nötig:** Soll ich den Prototyp bauen (neue Abhängigkeit `onnxruntime-web`,
~20 MB optionaler Download)?
