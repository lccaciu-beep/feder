<script lang="ts">
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import { exportNotebookPdf } from '../../pdf/export';
  import { exportNotebookFile, safeFileName } from '../../io/backup';
  import { exportPageImage } from '../../io/exportImage';
  import { shareOrDownload } from '../../io/share';
  import { toasts } from '../stores/toast.svelte';
  import type { Id, Notebook } from '../../model/types';

  let {
    notebook,
    currentPageId = null,
    currentPageNumber = 0,
    onclose,
  }: {
    notebook: Notebook;
    currentPageId?: Id | null;
    currentPageNumber?: number;
    onclose: () => void;
  } = $props();

  type Format = 'pdf' | 'image' | 'feder';
  let format = $state<Format>('pdf');
  let scope = $state<'all' | 'page'>('all');
  let withTemplate = $state(true);
  let busy = $state(false);
  let result = $state<{ blob: Blob; name: string } | null>(null);

  const formats: { id: Format; label: string; hint: string }[] = [
    {
      id: 'pdf',
      label: 'PDF',
      hint: 'Zum Lesen, Drucken und Weitergeben. Handschrift bleibt gestochen scharf.',
    },
    { id: 'image', label: 'Bild', hint: 'Die aktuelle Seite als PNG.' },
    {
      id: 'feder',
      label: 'Feder-Datei',
      hint: 'Das komplette Notizbuch zum späteren Wiederimportieren – alles bleibt bearbeitbar.',
    },
  ];

  const visibleFormats = $derived(formats.filter((f) => f.id !== 'image' || currentPageId));

  function reset() {
    result = null;
  }

  async function create() {
    busy = true;
    result = null;
    try {
      if (format === 'pdf') {
        const pageIds = scope === 'page' && currentPageId ? [currentPageId] : undefined;
        const blob = await exportNotebookPdf(notebook.id, { withTemplate, pageIds });
        const suffix = pageIds ? ` – Seite ${currentPageNumber}` : '';
        result = { blob, name: safeFileName(notebook.title + suffix, 'pdf') };
      } else if (format === 'image' && currentPageId) {
        const blob = await exportPageImage(currentPageId);
        result = { blob, name: safeFileName(`${notebook.title} – Seite ${currentPageNumber}`, 'png') };
      } else {
        const blob = await exportNotebookFile(notebook.id);
        result = { blob, name: safeFileName(notebook.title, 'feder') };
      }
    } catch (err) {
      toasts.show(`Export fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`, { ms: 6000 });
    } finally {
      busy = false;
    }
  }

  async function share() {
    if (!result) return;
    const r = await shareOrDownload(result.blob, result.name);
    if (r === 'downloaded') toasts.show('Datei wurde heruntergeladen.');
    if (r !== 'cancelled') onclose();
  }

  function size(n: number) {
    return n > 1024 * 1024
      ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
      : `${Math.max(1, Math.round(n / 1024))} KB`;
  }
</script>

<Sheet title="„{notebook.title}“ exportieren" {onclose}>
  <div class="formats" role="radiogroup" aria-label="Format">
    {#each visibleFormats as f (f.id)}
      <button
        class="fmt"
        class:on={format === f.id}
        role="radio"
        aria-checked={format === f.id}
        onclick={() => {
          format = f.id;
          reset();
        }}
      >
        <strong>{f.label}</strong>
        <span>{f.hint}</span>
      </button>
    {/each}
  </div>

  {#if format === 'pdf'}
    <div class="opts">
      {#if currentPageId}
        <div class="seg">
          <button class:on={scope === 'all'} onclick={() => ((scope = 'all'), reset())}>Alle Seiten</button>
          <button class:on={scope === 'page'} onclick={() => ((scope = 'page'), reset())}
            >Nur Seite {currentPageNumber}</button
          >
        </div>
      {/if}
      <label class="check">
        <input type="checkbox" bind:checked={withTemplate} onchange={reset} />
        Linien und Raster mit exportieren
      </label>
    </div>
  {/if}

  {#if result}
    <p class="done"><Icon name="check" size={18} /> {result.name}, {size(result.blob.size)}</p>
  {/if}

  {#snippet footer()}
    <button class="btn" onclick={onclose}>Abbrechen</button>
    {#if result}
      <button class="btn primary" onclick={share}>Teilen oder sichern</button>
    {:else}
      <button class="btn primary" onclick={create} disabled={busy}
        >{busy ? 'Wird erstellt …' : 'Datei erstellen'}</button
      >
    {/if}
  {/snippet}
</Sheet>

<style>
  .formats {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .fmt {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    text-align: left;
  }
  .fmt.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .fmt span {
    font: 14px var(--font-ui);
    color: var(--muted);
  }
  .opts {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 16px;
  }
  .seg {
    display: inline-flex;
    align-self: flex-start;
    padding: 3px;
    border-radius: 10px;
    background: var(--surface-2);
  }
  .seg button {
    min-height: 34px;
    padding: 0 12px;
    border-radius: 8px;
    font: 500 14px var(--font-ui);
  }
  .seg button.on {
    background: var(--surface);
    box-shadow: 0 1px 2px rgba(22, 32, 58, 0.15);
  }
  .check {
    display: flex;
    align-items: center;
    gap: 10px;
    font: 15px var(--font-ui);
  }
  .check input {
    width: 22px;
    height: 22px;
    accent-color: var(--accent);
  }
  .done {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 16px 0 0;
    font: 500 14px var(--font-ui);
    color: var(--accent);
    overflow-wrap: anywhere;
  }
</style>
