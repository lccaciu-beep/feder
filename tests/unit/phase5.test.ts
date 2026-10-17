import { beforeEach, describe, expect, it } from 'vitest';
import { INTERVALS, addCard, answer, deckForNotebook, dueCards, reviewed } from '../../src/storage/study';
import { clipForTime, formatDuration } from '../../src/audio/recorder';
import type { AudioClip, Flashcard } from '../../src/model/types';
import { freshDb } from './helpers';

beforeEach(() => {
  freshDb();
});

const card = (box: number): Flashcard => ({
  id: 'c',
  deckId: 'd',
  front: '',
  back: null,
  backText: '',
  sourcePageId: null,
  box,
  due: 0,
  createdAt: 0,
});

describe('Lernkarten (Leitner)', () => {
  it('rückt bei richtiger Antwort ein Fach weiter, bei falscher zurück auf 1', () => {
    expect(reviewed(card(2), true, 1000)).toMatchObject({ box: 3, due: 1000 + INTERVALS[3]! });
    expect(reviewed(card(5), true, 0).box).toBe(5);
    expect(reviewed(card(4), false, 0)).toMatchObject({ box: 1, due: 0 });
  });

  it('liefert nur fällige Karten und legt Stapel pro Notizbuch einmal an', async () => {
    const d1 = await deckForNotebook('nb1', 'Mathe');
    const d2 = await deckForNotebook('nb1', 'Mathe');
    expect(d2.id).toBe(d1.id);
    const a = await addCard(d1.id, 'data:a', 'Antwort A', null);
    await addCard(d1.id, 'data:b', 'Antwort B', null);
    expect(await dueCards(d1.id)).toHaveLength(2);
    await answer(a, true); // Fach 1 → 2: sofort wieder fällig
    await answer({ ...a, box: 2 }, true); // Fach 2 → 3: erst morgen
    expect((await dueCards(d1.id)).map((c) => c.backText)).toEqual(['Antwort B']);
  });
});

describe('Audio', () => {
  const clips: AudioClip[] = [
    { id: '1', notebookId: 'n', blobId: 'b1', startedAt: 10_000, duration: 5_000, mime: 'audio/mp4' },
    { id: '2', notebookId: 'n', blobId: 'b2', startedAt: 60_000, duration: 2_000, mime: 'audio/mp4' },
  ];

  it('ordnet Strich-Zeitpunkte der passenden Aufnahme zu', () => {
    expect(clipForTime(clips, 12_000)?.id).toBe('1');
    expect(clipForTime(clips, 61_000)?.id).toBe('2');
    expect(clipForTime(clips, 30_000)).toBeNull();
  });

  it('formatiert Dauern', () => {
    expect(formatDuration(65_400)).toBe('1:05');
    expect(formatDuration(0)).toBe('0:00');
  });
});
