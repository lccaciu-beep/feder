// Undo/Redo. Jeder Befehl beschreibt Änderungen als Vorher/Nachher-Paare,
// daraus ergeben sich Ausführen und Rückgängigmachen symmetrisch.

import type { Item, Notebook, Page } from '../../model/types';

export interface Change<T> {
  before: T | null;
  after: T | null;
}

export interface Command {
  label: string;
  items: Change<Item>[];
  pages: Change<Page>[];
  notebook?: Change<Notebook>;
}

export function emptyCommand(label: string): Command {
  return { label, items: [], pages: [] };
}

export function isEmpty(cmd: Command): boolean {
  return !cmd.items.length && !cmd.pages.length && !cmd.notebook;
}

/** Gibt den umgekehrten Befehl zurück (vorher ↔ nachher). */
export function invert(cmd: Command): Command {
  const flip = <T>(c: Change<T>): Change<T> => ({ before: c.after, after: c.before });
  return {
    label: cmd.label,
    items: cmd.items.map(flip).reverse(),
    pages: cmd.pages.map(flip).reverse(),
    notebook: cmd.notebook && flip(cmd.notebook),
  };
}

export class History {
  private stack: Command[] = [];
  private index = 0;

  constructor(private readonly limit = 200) {}

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index < this.stack.length;
  }

  push(cmd: Command): void {
    this.stack.length = this.index;
    this.stack.push(cmd);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length;
  }

  /** Liefert den Befehl, der zum Rückgängigmachen ausgeführt werden muss. */
  undo(): Command | null {
    if (!this.canUndo) return null;
    return invert(this.stack[--this.index]!);
  }

  redo(): Command | null {
    if (!this.canRedo) return null;
    return this.stack[this.index++]!;
  }

  clear(): void {
    this.stack = [];
    this.index = 0;
  }
}
