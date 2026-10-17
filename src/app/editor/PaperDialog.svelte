<script lang="ts">
  import { untrack } from 'svelte';
  import Sheet from '../components/Sheet.svelte';
  import PaperPicker from '../library/PaperPicker.svelte';
  import { choiceToPaper, paperToChoice } from '../library/paperChoice';
  import type { PaperSpec } from '../../model/types';

  let {
    paper,
    onclose,
    onapply,
  }: { paper: PaperSpec; onclose: () => void; onapply: (paper: PaperSpec, scope: 'page' | 'all') => void } =
    $props();

  let choice = $state(untrack(() => paperToChoice(paper)));

  function apply(scope: 'page' | 'all') {
    onapply(choiceToPaper($state.snapshot(choice)), scope);
    onclose();
  }
</script>

<Sheet title="Vorlage ändern" {onclose} wide>
  {#if paper.template.kind === 'pdf'}
    <p class="note">
      Diese Seite stammt aus einem PDF. „Für diese Seite“ ersetzt den PDF-Inhalt durch die gewählte Vorlage,
      „Für alle Seiten“ ändert nur die eigenen Seiten.
    </p>
  {/if}
  <PaperPicker bind:choice />
  {#snippet footer()}
    <button class="btn" onclick={() => apply('all')}>Für alle Seiten</button>
    <button class="btn primary" onclick={() => apply('page')}>Für diese Seite</button>
  {/snippet}
</Sheet>

<style>
  .note {
    margin: 0 0 14px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--accent-soft);
    font: 14px var(--font-ui);
  }
</style>
