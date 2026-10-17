// Lernkarten nach dem Leitner-System (5 Fächer).

import { newId } from '../model/ids';
import type { Deck, Flashcard, Id } from '../model/types';
import { getDb } from './db';

const DAY = 86_400_000;
/** Wartezeit je Fach: Fach 1 sofort wieder, dann 1, 3, 7, 21 Tage. */
export const INTERVALS = [0, 0, DAY, 3 * DAY, 7 * DAY, 21 * DAY];

/** Stapel für ein Notizbuch (wird bei Bedarf angelegt). */
export async function deckForNotebook(notebookId: Id, name: string): Promise<Deck> {
  const db = getDb();
  const existing = await db.decks.where('notebookId').equals(notebookId).first();
  if (existing) return existing;
  const deck: Deck = { id: newId(), name, notebookId, createdAt: Date.now() };
  await db.decks.add(deck);
  return deck;
}

export async function addCard(
  deckId: Id,
  front: string,
  backText: string,
  sourcePageId: Id | null,
  back: string | null = null,
): Promise<Flashcard> {
  const card: Flashcard = {
    id: newId(),
    deckId,
    front,
    back,
    backText,
    sourcePageId,
    box: 1,
    due: Date.now(),
    createdAt: Date.now(),
  };
  await getDb().cards.add(card);
  return card;
}

/** Nächster Zustand einer Karte nach der Antwort. */
export function reviewed(card: Flashcard, known: boolean, now = Date.now()): Flashcard {
  const box = known ? Math.min(5, card.box + 1) : 1;
  return { ...card, box, due: now + INTERVALS[box]! };
}

export async function answer(card: Flashcard, known: boolean): Promise<Flashcard> {
  const next = reviewed(card, known);
  await getDb().cards.put(next);
  return next;
}

export async function deleteCard(id: Id): Promise<void> {
  await getDb().cards.delete(id);
}

export async function deleteDeck(id: Id): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.decks, db.cards, async () => {
    await db.cards.where('deckId').equals(id).delete();
    await db.decks.delete(id);
  });
}

export async function renameDeck(id: Id, name: string): Promise<void> {
  await getDb().decks.update(id, { name });
}

/** Fällige Karten eines Stapels, gemischt. */
export async function dueCards(deckId: Id, now = Date.now()): Promise<Flashcard[]> {
  const cards = await getDb()
    .cards.where('deckId')
    .equals(deckId)
    .filter((c) => c.due <= now)
    .toArray();
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j]!, cards[i]!];
  }
  return cards;
}
