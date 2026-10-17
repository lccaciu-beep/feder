// Audioaufnahme mit MediaRecorder. Striche tragen ihre Entstehungszeit (t0),
// darüber werden sie bei der Wiedergabe der Aufnahme zugeordnet.

import { newId } from '../model/ids';
import type { AudioClip, Id } from '../model/types';
import { getBlobStore } from '../storage/blobstore';
import { getDb } from '../storage/db';
import { deleteUnusedBlobs } from '../storage/library';

const MIME_CANDIDATES = ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm'];

export function recordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export class AudioRecorder {
  private rec: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  startedAt = 0;

  get recording(): boolean {
    return !!this.rec && this.rec.state === 'recording';
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m));
    this.rec = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.rec.start(1000);
    this.startedAt = Date.now();
  }

  /** Beendet die Aufnahme und speichert sie zum Notizbuch. */
  async stop(notebookId: Id): Promise<AudioClip | null> {
    const rec = this.rec;
    if (!rec) return null;
    const done = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.stop();
    await done;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.rec = null;
    const mime = rec.mimeType || this.chunks[0]?.type || 'audio/mp4';
    const blob = new Blob(this.chunks, { type: mime });
    this.chunks = [];
    if (!blob.size) return null;
    const meta = await (await getBlobStore()).put(blob);
    const clip: AudioClip = {
      id: newId(),
      notebookId,
      blobId: meta.id,
      startedAt: this.startedAt,
      duration: Date.now() - this.startedAt,
      mime,
    };
    await getDb().audio.add(clip);
    return clip;
  }

  cancel() {
    try {
      this.rec?.stop();
    } catch {
      /* schon gestoppt */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.rec = null;
    this.stream = null;
    this.chunks = [];
  }
}

export async function deleteClip(clip: AudioClip): Promise<void> {
  await getDb().audio.delete(clip.id);
  await deleteUnusedBlobs([clip.blobId]);
}

/** Die Aufnahme, in deren Zeitraum `t` (ms seit Epoch) fällt. */
export function clipForTime(clips: readonly AudioClip[], t: number): AudioClip | null {
  return clips.find((c) => t >= c.startedAt - 500 && t <= c.startedAt + c.duration + 500) ?? null;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
