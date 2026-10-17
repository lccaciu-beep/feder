// Importiert ausgewählte oder hereingezogene Dateien (PDF oder .feder).

import { importNotebookFile, readFederFile } from '../../io/backup';
import { importPdfAsNotebook, isPdfFile } from '../../pdf/import';
import type { Id, Notebook } from '../../model/types';
import { toasts } from '../stores/toast.svelte';

export function isFederFile(f: File): boolean {
  return /\.feder$/i.test(f.name);
}

export async function importFiles(files: File[], folderId: Id | null): Promise<Notebook[]> {
  const created: Notebook[] = [];
  const busy = toasts.show(
    files.length === 1 ? `Importiere „${files[0]!.name}“ …` : `Importiere ${files.length} Dateien …`,
    {
      sticky: true,
    },
  );
  try {
    for (const file of files) {
      try {
        if (isPdfFile(file)) created.push(await importPdfAsNotebook(file, folderId));
        else if (isFederFile(file))
          created.push(await importNotebookFile(await readFederFile(file), folderId));
        else toasts.show(`„${file.name}“ ist weder ein PDF noch eine Feder-Datei.`);
      } catch (err) {
        toasts.show(`„${file.name}“: ${err instanceof Error ? err.message : String(err)}`, { ms: 6000 });
      }
    }
  } finally {
    toasts.dismiss(busy);
  }
  if (created.length) {
    toasts.show(
      created.length === 1 ? `„${created[0]!.title}“ importiert` : `${created.length} Notizbücher importiert`,
    );
  }
  return created;
}
