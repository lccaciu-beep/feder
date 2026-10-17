// Dateien über das Teilen-Menü des iPads weitergeben (AirDrop, Dateien, Mail …).
// Fällt auf einen normalen Download zurück, wenn Teilen nicht verfügbar ist.
//
// Safari verlangt für navigator.share eine frische Nutzeraktion. Darum wird
// die Datei erst erzeugt und dann über einen zweiten Tipp geteilt.

export type ShareResult = 'shared' | 'downloaded' | 'cancelled';

export function canShareFiles(): boolean {
  try {
    const probe = new File([''], 'probe.pdf', { type: 'application/pdf' });
    return !!navigator.canShare?.({ files: [probe] });
  } catch {
    return false;
  }
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function shareOrDownload(blob: Blob, filename: string): Promise<ShareResult> {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return 'cancelled';
      // z. B. NotAllowedError – dann wenigstens herunterladen
    }
  }
  download(blob, filename);
  return 'downloaded';
}
