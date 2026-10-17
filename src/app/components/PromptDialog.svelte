<script lang="ts">
  import { untrack } from 'svelte';
  import Sheet from './Sheet.svelte';

  let {
    title,
    value = '',
    confirm = 'Sichern',
    onclose,
    onsubmit,
  }: {
    title: string;
    value?: string;
    confirm?: string;
    onclose: () => void;
    onsubmit: (v: string) => void;
  } = $props();

  let text = $state(untrack(() => value));
  let input = $state<HTMLInputElement>();

  $effect(() => {
    input?.focus();
    input?.select();
  });

  function submit() {
    const v = text.trim();
    if (!v) return;
    onsubmit(v);
    onclose();
  }
</script>

<Sheet {title} {onclose}>
  <input
    class="field"
    bind:this={input}
    bind:value={text}
    onkeydown={(e) => e.key === 'Enter' && submit()}
    aria-label={title}
  />
  {#snippet footer()}
    <button class="btn" onclick={onclose}>Abbrechen</button>
    <button class="btn primary" onclick={submit} disabled={!text.trim()}>{confirm}</button>
  {/snippet}
</Sheet>
