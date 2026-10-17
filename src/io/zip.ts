// Minimales ZIP ohne Kompression (STORE) zum Schreiben, Lesen auch mit
// Deflate (falls eine Datei extern neu gepackt wurde). Kein ZIP64: max. 4 GB.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array, crc = 0): number {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntryInput {
  name: string;
  data: Blob | Uint8Array | string;
}

const enc = new TextEncoder();
const LIMIT = 0xffffffff;

function dosDateTime(d: Date): [number, number] {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return [time, date];
}

/** Baut eine ZIP-Datei als Blob (Einträge werden nicht komprimiert). */
export async function createZip(entries: ZipEntryInput[], mime = 'application/zip'): Promise<Blob> {
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const [time, date] = dosDateTime(new Date());

  for (const e of entries) {
    const name = enc.encode(e.name);
    const bytes =
      typeof e.data === 'string'
        ? enc.encode(e.data)
        : e.data instanceof Uint8Array
          ? e.data
          : new Uint8Array(await e.data.arrayBuffer());
    if (bytes.length >= LIMIT || offset >= LIMIT) throw new Error('Backup ist größer als 4 GB.');
    const crc = crc32(bytes);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // Version
    local.setUint16(6, 0x0800, true); // UTF-8-Dateinamen
    local.setUint16(8, 0, true); // STORE
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, name as BlobPart, bytes as BlobPart);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, bytes.length, true);
    cd.setUint32(24, bytes.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    const cdBytes = new Uint8Array(46 + name.length);
    cdBytes.set(new Uint8Array(cd.buffer), 0);
    cdBytes.set(name, 46);
    central.push(cdBytes);
    offset += 30 + name.length + bytes.length;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...(central as BlobPart[]), end.buffer], { type: mime });
}

export interface ZipEntry {
  name: string;
  size: number;
  read(): Promise<Uint8Array>;
  blob(type?: string): Promise<Blob>;
}

/** Liest das Inhaltsverzeichnis einer ZIP-Datei; die Daten werden erst bei Bedarf geladen. */
export async function readZip(file: Blob): Promise<Map<string, ZipEntry>> {
  const tailSize = Math.min(file.size, 65_557);
  const tail = new DataView(await file.slice(file.size - tailSize).arrayBuffer());
  let eocd = -1;
  for (let i = tailSize - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Keine gültige Feder- bzw. ZIP-Datei.');
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const out = new Map<string, ZipEntry>();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50)
      throw new Error('Beschädigtes Inhaltsverzeichnis in der Datei.');
    const method = cd.getUint16(p + 10, true);
    const crc = cd.getUint32(p + 16, true);
    const compSize = cd.getUint32(p + 20, true);
    const size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const localOffset = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    const read = async (): Promise<Uint8Array> => {
      const lh = new DataView(await file.slice(localOffset, localOffset + 30).arrayBuffer());
      const start = localOffset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      const raw = file.slice(start, start + compSize);
      let bytes: Uint8Array;
      if (method === 0) bytes = new Uint8Array(await raw.arrayBuffer());
      else if (method === 8) {
        const stream = raw.stream().pipeThrough(new DecompressionStream('deflate-raw'));
        bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      } else throw new Error(`Nicht unterstützte Kompression in ${name}.`);
      if (crc32(bytes) !== crc) throw new Error(`Prüfsumme stimmt nicht: ${name}. Die Datei ist beschädigt.`);
      return bytes;
    };
    out.set(name, {
      name,
      size,
      read,
      blob: async (type = '') => new Blob([(await read()) as BlobPart], { type }),
    });
  }
  return out;
}
