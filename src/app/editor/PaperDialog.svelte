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
  <PaperPicker bind:choice />
  {#snippet footer()}
    <button class="btn" onclick={() => apply('all')}>Für alle Seiten</button>
    <button class="btn primary" onclick={() => apply('page')}>Für diese Seite</button>
  {/snippet}
</Sheet>
