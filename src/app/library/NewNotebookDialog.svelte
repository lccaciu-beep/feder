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
        paper: choiceToPaper($state.snapshot(choice)),
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
