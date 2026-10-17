// Hilfen für eingefügte und gescannte Bilder.

/** Verkleinert große Fotos und liefert die Pixelmaße. */
export async function prepareImage(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(file);
  const MAX = 2400;
  const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  if (k >= 1 && (file.type === 'image/png' || file.type === 'image/jpeg')) {
    const out = { blob: file, width: bmp.width, height: bmp.height };
    bmp.close();
    return out;
  }
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const png = file.type === 'image/png';
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.9));
  const out = { blob: blob ?? file, width: c.width, height: c.height };
  c.width = c.height = 0;
  return out;
}
