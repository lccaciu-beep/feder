<script lang="ts">
  import { PAPER_COLORS, PAPER_SIZES, TEMPLATES, templateInfo } from '../../model/paper';
  import type { BuiltinTemplateId, PaperColor } from '../../model/types';
  import PaperPreview from './PaperPreview.svelte';
  import { choiceToPaper, type PaperChoice } from './paperChoice';

  let { choice = $bindable() }: { choice: PaperChoice } = $props();

  const sizes = [
    ...Object.entries(PAPER_SIZES).map(([id, s]) => ({ id, label: s.label })),
    { id: 'custom', label: 'Eigenes Maß' },
  ];
  const colors = Object.entries(PAPER_COLORS) as [PaperColor, (typeof PAPER_COLORS)[PaperColor]][];

  let info = $derived(templateInfo(choice.template));

  function pickTemplate(id: BuiltinTemplateId) {
    choice.template = id;
    choice.spacing = templateInfo(id).defaults.spacing;
  }

  function previewFor(id: BuiltinTemplateId) {
    return choiceToPaper({ ...choice, template: id, spacing: templateInfo(id).defaults.spacing });
  }
</script>

<div class="picker">
  <div class="row">
    <span class="lbl">Format</span>
    <div class="seg">
      {#each sizes as s (s.id)}
        <button class:on={choice.size === s.id} onclick={() => (choice.size = s.id as PaperChoice['size'])}
          >{s.label}</button
        >
      {/each}
    </div>
  </div>

  {#if choice.size === 'custom'}
    <div class="row">
      <span class="lbl">Maß in mm</span>
      <div class="dims">
        <input
          class="field"
          type="number"
          min="50"
          max="2000"
          inputmode="numeric"
          bind:value={choice.customWmm}
          aria-label="Breite in mm"
        />
        <span>×</span>
        <input
          class="field"
          type="number"
          min="50"
          max="2000"
          inputmode="numeric"
          bind:value={choice.customHmm}
          aria-label="Höhe in mm"
        />
      </div>
    </div>
  {/if}

  <div class="row">
    <span class="lbl">Ausrichtung</span>
    <div class="seg">
      <button class:on={choice.orientation === 'portrait'} onclick={() => (choice.orientation = 'portrait')}
        >Hochformat</button
      >
      <button class:on={choice.orientation === 'landscape'} onclick={() => (choice.orientation = 'landscape')}
        >Querformat</button
      >
    </div>
  </div>

  <div class="row">
    <span class="lbl">Papierfarbe</span>
    <div class="swatches">
      {#each colors as [id, c] (id)}
        <button
          class="paper-swatch"
          class:on={choice.color === id}
          style:background={c.fill}
          onclick={() => (choice.color = id)}
          aria-label={c.label}
          aria-pressed={choice.color === id}
        ></button>
      {/each}
    </div>
  </div>

  <div class="templates" role="listbox" aria-label="Vorlage">
    {#each TEMPLATES as t (t.id)}
      <button
        class="tpl"
        class:on={choice.template === t.id}
        role="option"
        aria-selected={choice.template === t.id}
        onclick={() => pickTemplate(t.id)}
      >
        <PaperPreview paper={previewFor(t.id)} width={choice.orientation === 'landscape' ? 92 : 66} />
        <span>{t.label}</span>
      </button>
    {/each}
  </div>

  {#if info.spacings}
    <div class="row">
      <span class="lbl">Abstand</span>
      <div class="seg">
        {#each info.spacings as sp (sp.value)}
          <button
            class:on={Math.abs((choice.spacing ?? 0) - sp.value) < 0.01}
            onclick={() => (choice.spacing = sp.value)}>{sp.label}</button
          >
        {/each}
      </div>
    </div>
  {/if}
  {#if choice.template === 'ruled'}
    <label class="row check">
      <span class="lbl">Randlinie</span>
      <input type="checkbox" bind:checked={choice.margin} />
    </label>
  {/if}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .lbl {
    font-family: var(--font-ui);
    font-size: 15px;
    color: var(--muted);
  }
  .seg {
    display: inline-flex;
    flex-wrap: wrap;
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
  .dims {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dims .field {
    width: 96px;
  }
  .swatches {
    display: flex;
    gap: 10px;
  }
  .paper-swatch {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .paper-swatch.on {
    box-shadow:
      inset 0 0 0 1px var(--line),
      0 0 0 2px var(--surface),
      0 0 0 4px var(--accent);
  }
  .templates {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 8px;
  }
  .tpl {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    padding: 10px 4px 8px;
    border-radius: 12px;
    font: 500 13px var(--font-ui);
    color: var(--muted);
  }
  .tpl.on {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .check input {
    width: 22px;
    height: 22px;
    accent-color: var(--accent);
  }
</style>
