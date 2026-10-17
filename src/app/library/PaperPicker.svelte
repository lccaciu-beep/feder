<script lang="ts">
  import { PAPER_COLORS, PAPER_SIZES, TEMPLATES, templateInfo } from '../../model/paper';
  import type { BuiltinTemplateId, PaperColor } from '../../model/types';
  import { liveQuery } from 'dexie';
  import PaperPreview from './PaperPreview.svelte';
  import FilePreview from './FilePreview.svelte';
  import Icon from '../components/Icon.svelte';
  import { choiceToPaper, type PaperChoice } from './paperChoice';
  import { getDb } from '../../storage/db';
  import { addTemplatesFromFile, deleteTemplate, templatePaper } from '../../storage/templates';
  import { toasts } from '../stores/toast.svelte';
  import type { CustomTemplate } from '../../model/types';

  let { choice = $bindable() }: { choice: PaperChoice } = $props();

  const sizes = [
    ...Object.entries(PAPER_SIZES).map(([id, s]) => ({ id, label: s.label })),
    { id: 'custom', label: 'Eigenes Maß' },
  ];
  const colors = Object.entries(PAPER_COLORS) as [PaperColor, (typeof PAPER_COLORS)[PaperColor]][];

  let info = $derived(templateInfo(choice.template));

  const customQ = liveQuery(() => getDb().templates.orderBy('createdAt').toArray());
  let fileInput = $state<HTMLInputElement>();
  let editingCustom = $state(false);

  function sameFile(t: CustomTemplate) {
    const f = choice.file?.template;
    return (
      !!f && f.kind === t.kind && f.blobId === t.blobId && (f.kind !== 'pdf' || f.pageIndex === t.pageIndex)
    );
  }

  async function addCustom(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const created = await addTemplatesFromFile(file);
      if (created[0]) choice.file = templatePaper(created[0]);
      toasts.show(created.length === 1 ? 'Vorlage hinzugefügt' : `${created.length} Vorlagen hinzugefügt`);
    } catch (err) {
      toasts.show(
        `Vorlage konnte nicht angelegt werden: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  function pickTemplate(id: BuiltinTemplateId) {
    choice.file = null;
    choice.template = id;
    choice.spacing = templateInfo(id).defaults.spacing;
  }

  function previewFor(id: BuiltinTemplateId) {
    return choiceToPaper({ ...choice, template: id, spacing: templateInfo(id).defaults.spacing });
  }
</script>

<div class="picker">
  {#if !choice.file}
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
        <button
          class:on={choice.orientation === 'landscape'}
          onclick={() => (choice.orientation = 'landscape')}>Querformat</button
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
  {/if}

  <div class="templates" role="listbox" aria-label="Vorlage">
    {#each TEMPLATES as t (t.id)}
      <button
        class="tpl"
        class:on={!choice.file && choice.template === t.id}
        role="option"
        aria-selected={!choice.file && choice.template === t.id}
        onclick={() => pickTemplate(t.id)}
      >
        <PaperPreview paper={previewFor(t.id)} width={choice.orientation === 'landscape' ? 92 : 66} />
        <span>{t.label}</span>
      </button>
    {/each}
  </div>

  <div class="row">
    <span class="lbl">Eigene Vorlagen</span>
    <span>
      {#if $customQ?.length}
        <button class="link" onclick={() => (editingCustom = !editingCustom)}
          >{editingCustom ? 'Fertig' : 'Bearbeiten'}</button
        >
      {/if}
      <button class="link" onclick={() => fileInput?.click()}
        ><Icon name="plus" size={16} /> Aus PDF oder Bild</button
      >
      <input
        bind:this={fileInput}
        type="file"
        accept="application/pdf,.pdf,image/*"
        hidden
        onchange={addCustom}
      />
    </span>
  </div>
  {#if $customQ?.length}
    <div class="templates" role="listbox" aria-label="Eigene Vorlagen">
      {#each $customQ as t (t.id)}
        <div class="custom-cell">
          <button
            class="tpl"
            class:on={sameFile(t)}
            role="option"
            aria-selected={sameFile(t)}
            onclick={() => (choice.file = templatePaper(t))}
          >
            <FilePreview paper={templatePaper(t)} width={66} />
            <span>{t.name}</span>
          </button>
          {#if editingCustom}
            <button
              class="del"
              aria-label="Vorlage {t.name} löschen"
              onclick={() => void deleteTemplate(t.id)}><Icon name="close" size={14} /></button
            >
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if !choice.file && info.spacings}
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
  {#if !choice.file && choice.template === 'ruled'}
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
  .link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 10px;
    color: var(--accent);
    font: 600 14px var(--font-ui);
  }
  .custom-cell {
    position: relative;
  }
  .custom-cell .tpl {
    width: 100%;
  }
  .custom-cell span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .del {
    position: absolute;
    top: -4px;
    right: -4px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--danger);
    color: #fff;
  }
  .check input {
    width: 22px;
    height: 22px;
    accent-color: var(--accent);
  }
</style>
