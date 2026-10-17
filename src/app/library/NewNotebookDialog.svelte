<script lang="ts">
  import Sheet from '../components/Sheet.svelte';
  import NotebookCover from './NotebookCover.svelte';
  import CoverPicker from './CoverPicker.svelte';
  import PaperPicker from './PaperPicker.svelte';
  import { DEFAULT_PAPER } from '../../model/paper';
  import type { CoverSpec, Id } from '../../model/types';
  import { createNotebook } from '../../storage/library';
  import { choiceToPaper, paperToChoice } from './paperChoice';

  let {
    folderId,
    onclose,
    oncreated,
  }: { folderId: Id | null; onclose: () => void; oncreated: (id: Id) => void } = $props();

  const today = new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  let title = $state('');
  let kind = $state<'paged' | 'whiteboard'>('paged');
  let cover = $state<CoverSpec>({ color: '#1f2d4d', pattern: 'linen' });
  let choice = $state(paperToChoice(DEFAULT_PAPER));
  let busy = $state(false);

  async function create() {
    busy = true;
    try {
      const nb = await createNotebook({
        title: title.trim() || `Notizbuch vom ${today}`,
        folderId,
        cover: $state.snapshot(cover),
        kind,
        paper:
          kind === 'whiteboard'
            ? { ...choiceToPaper($state.snapshot(choice)), width: 4000, height: 3000 }
            : choiceToPaper($state.snapshot(choice)),
      });
      oncreated(nb.id);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet title="Neues Notizbuch" {onclose} wide>
  <div class="layout">
    <div class="left">
      <NotebookCover title={title || 'Notizbuch'} {cover} width={140} />
      <input
        class="field"
        placeholder="Titel"
        bind:value={title}
        onkeydown={(e) => e.key === 'Enter' && create()}
        aria-label="Titel"
      />
      <CoverPicker bind:cover />
      <div class="kind" role="radiogroup" aria-label="Art">
        <button
          role="radio"
          aria-checked={kind === 'paged'}
          class:on={kind === 'paged'}
          onclick={() => (kind = 'paged')}>Notizbuch</button
        >
        <button
          role="radio"
          aria-checked={kind === 'whiteboard'}
          class:on={kind === 'whiteboard'}
          onclick={() => (kind = 'whiteboard')}>Whiteboard</button
        >
      </div>
      {#if kind === 'whiteboard'}
        <p class="wb-hint">
          Eine große Fläche ohne Seiten, die beim Schreiben am Rand mitwächst. Die Vorlage bestimmt das
          Raster.
        </p>
      {/if}
    </div>
    <div class="right">
      <PaperPicker bind:choice />
    </div>
  </div>
  {#snippet footer()}
    <button class="btn" onclick={onclose}>Abbrechen</button>
    <button class="btn primary" onclick={create} disabled={busy}>Notizbuch anlegen</button>
  {/snippet}
</Sheet>

<style>
  .layout {
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: 28px;
  }
  .kind {
    display: inline-flex;
    padding: 3px;
    border-radius: 10px;
    background: var(--surface-2);
  }
  .kind button {
    min-height: 34px;
    padding: 0 12px;
    border-radius: 8px;
    font: 500 14px var(--font-ui);
  }
  .kind button.on {
    background: var(--surface);
    box-shadow: 0 1px 2px rgba(22, 32, 58, 0.15);
  }
  .wb-hint {
    margin: 0;
    font: 13px var(--font-ui);
    color: var(--muted);
  }
  .left {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 14px;
  }
  @media (max-width: 640px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>
