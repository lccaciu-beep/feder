<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import Menu, { type MenuItem } from '../components/Menu.svelte';
  import type { Editor, SelectionInfo } from '../../engine/Editor';
  import { settings } from '../stores/settings.svelte';

  let {
    editor,
    info,
    onsaveelement,
    onshareimage,
    oncrop,
    onlink,
    onflashcard,
  }: {
    editor: Editor;
    info: SelectionInfo;
    onsaveelement: () => void;
    onshareimage: () => void;
    oncrop: () => void;
    onlink: () => void;
    onflashcard: () => void;
  } = $props();

  let colors = $state(false);
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);

  // Über der Auswahl, sonst darunter; immer im sichtbaren Bereich
  const pos = $derived.by(() => {
    const r = info.screen;
    const above = r.y - 58 - 40;
    const top = above > 70 ? above : r.y + r.h + 20;
    const left = Math.max(8, Math.min(r.x + r.w / 2, window.innerWidth - 8));
    return { left, top };
  });

  function more(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const items: MenuItem[] = [
      { label: 'Duplizieren', icon: 'copy', run: () => editor.duplicateSelection() },
      { label: 'Als Bild teilen …', icon: 'share', run: onshareimage },
      { label: 'Als Element speichern …', icon: 'sticker', run: onsaveelement },
      { label: 'Link hinzufügen …', icon: 'link', run: onlink },
      { label: 'Lernkarte erstellen …', icon: 'flashcard', run: onflashcard },
    ];
    const single = info.single;
    if (single?.type === 'image') {
      items.unshift(
        { label: 'Zuschneiden …', icon: 'crop', run: oncrop },
        {
          label: 'Um 90° drehen',
          icon: 'rotate-right',
          run: () =>
            editor.updateItems(
              [{ before: single, after: { ...single, rotation: single.rotation + Math.PI / 2 } }],
              'Bild drehen',
            ),
        },
      );
    }
    menu = { x: r.left - 120, y: r.bottom + 6, items };
  }
</script>

<div class="bar" style:left="{pos.left}px" style:top="{pos.top}px" role="toolbar" aria-label="Auswahl">
  <span class="count">{info.count === 1 ? '1 Element' : `${info.count} Elemente`}</span>
  <button class="icon-btn" aria-label="Farbe ändern" onclick={() => (colors = !colors)}
    ><Icon name="palette" size={22} /></button
  >
  <button class="icon-btn" aria-label="Kopieren" onclick={() => editor.copySelection()}
    ><Icon name="copy" size={22} /></button
  >
  <button class="icon-btn" aria-label="Ausschneiden" onclick={() => editor.cutSelection()}
    ><Icon name="cut" size={22} /></button
  >
  <button class="icon-btn danger" aria-label="Löschen" onclick={() => editor.deleteSelection()}
    ><Icon name="trash" size={22} /></button
  >
  <button class="icon-btn" aria-label="Weitere Aktionen" onclick={more}><Icon name="more" size={22} /></button
  >
  {#if colors}
    <div class="colors">
      {#each [...settings.value.pen.colors, ...settings.value.palette.slice(0, 6)] as c, i (i)}
        <button
          class="sw"
          style:--c={c}
          aria-label="Farbe {c}"
          onclick={() => {
            editor.recolorSelection(c);
            colors = false;
          }}
        ></button>
      {/each}
    </div>
  {/if}
</div>

{#if menu}
  <Menu x={menu.x} y={menu.y} items={menu.items} onclose={() => (menu = null)} />
{/if}

<style>
  .bar {
    position: absolute;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 6px 4px 14px;
    border-radius: 16px;
    background: var(--surface);
    box-shadow: var(--shadow-lift);
    border: 1px solid var(--line);
    z-index: 15;
  }
  .count {
    font: 600 13px var(--font-ui);
    color: var(--muted);
    margin-right: 6px;
    white-space: nowrap;
  }
  .danger {
    color: var(--danger);
  }
  .colors {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    display: grid;
    grid-template-columns: repeat(6, 36px);
    gap: 4px;
    padding: 10px;
    border-radius: 14px;
    background: var(--surface);
    box-shadow: var(--shadow-lift);
    border: 1px solid var(--line);
  }
  .sw {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
  }
  .sw::after {
    content: '';
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--c);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
  }
</style>
