<script lang="ts">
  import { untrack } from 'svelte';
  import Sheet from '../components/Sheet.svelte';
  import NotebookCover from './NotebookCover.svelte';
  import CoverPicker from './CoverPicker.svelte';
  import type { Notebook } from '../../model/types';
  import { setCover } from '../../storage/library';

  let { notebook, onclose }: { notebook: Notebook; onclose: () => void } = $props();
  let cover = $state(untrack(() => structuredClone(notebook.cover)));

  async function save() {
    await setCover(notebook.id, $state.snapshot(cover));
    onclose();
  }
</script>

<Sheet title="Cover ändern" {onclose}>
  <div class="wrap">
    <NotebookCover title={notebook.title} {cover} width={120} />
    <CoverPicker bind:cover />
  </div>
  {#snippet footer()}
    <button class="btn" onclick={onclose}>Abbrechen</button>
    <button class="btn primary" onclick={save}>Cover sichern</button>
  {/snippet}
</Sheet>

<style>
  .wrap {
    display: flex;
    gap: 24px;
    align-items: flex-start;
    flex-wrap: wrap;
  }
</style>
