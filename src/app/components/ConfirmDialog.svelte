<script lang="ts">
  import Sheet from './Sheet.svelte';

  let {
    title,
    text,
    confirm,
    danger = false,
    onclose,
    onconfirm,
  }: {
    title: string;
    text: string;
    confirm: string;
    danger?: boolean;
    onclose: () => void;
    onconfirm: () => void;
  } = $props();
</script>

<Sheet {title} {onclose}>
  <p>{text}</p>
  {#snippet footer()}
    <button class="btn" onclick={onclose}>Abbrechen</button>
    <button
      class="btn primary"
      class:danger-fill={danger}
      onclick={() => {
        onconfirm();
        onclose();
      }}>{confirm}</button
    >
  {/snippet}
</Sheet>

<style>
  p {
    margin: 4px 0 0;
    font-family: var(--font-ui);
    color: var(--muted);
  }
  .danger-fill {
    background: var(--danger);
    color: #fff;
  }
</style>
