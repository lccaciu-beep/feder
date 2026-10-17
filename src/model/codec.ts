// Umwandlung von Punktdaten für JSON (Backup/Export). In IndexedDB liegen
// Float32Arrays direkt, für JSON werden sie als Base64 kodiert.

export function float32ToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function base64ToFloat32(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

/** Anzahl der Punkte eines Strichs. */
export function pointCount(points: Float32Array, stride: number): number {
  return Math.floor(points.length / stride);
}
