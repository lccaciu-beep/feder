<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import Menu, { type MenuItem } from '../components/Menu.svelte';
  import { press } from '../library/press';
  import { renderThumbnail } from '../../engine/render/thumbnail';
  import type { NotebookDoc } from '../../engine/doc/NotebookDoc';
  import type { Id } from '../../model/types';

  let {
    doc,
    pageIds,
    versions,
    current,
    ongo,
    onpaper,
    onclose,
  }: {
    doc: NotebookDoc;
    pageIds: Id[];
    versions: Record<Id, number>;
    current: number;
    ongo: (index: number) => void;
    onpaper: (pageId: Id) => void;
    onclose: () => void;
  } = $props();

  const THUMB_W = 132;
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  let listEl = $state<HTMLDivElement>();
  let reorder = $state<{ from: number; to: number; pointerId: number; y: number } | null>(null);

  // Miniaturen nur zeichnen, wenn sie sichtbar sind.
  function thumb(node: HTMLCanvasElement, params: { pageId: Id; version: number }) {
    let p = params;
    let visible = false;
    let drawn = -1;
    const draw = async () => {
      if (!visible || drawn === p.version) return;
      const page = doc.pages.get(p.pageId);
      if (!page) return;
      const v = p.version;
      const items = await doc.ensureItems(p.pageId);
      renderThumbnail(node, page.paper, items, THUMB_W);
      drawn = v;
    };
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      void draw();
    });
    io.observe(node);
    let timer: ReturnType<typeof setTimeout> | null = null;
    return {
      update(next: { pageId: Id; version: number }) {
        const changedPage = next.pageId !== p.pageId;
        p = next;
        if (changedPage) drawn = -1;
        if (timer) clearTimeout(timer);
        // Während des Schreibens nicht bei jedem Strich neu zeichnen.
        timer = setTimeout(() => void draw(), changedPage ? 0 : 400);
      },
      destroy() {
        io.disconnect();
        if (timer) clearTimeout(timer);
      },
    };
  }

  function pageMenu(index: number, x: number, y: number) {
    const id = pageIds[index]!;
    menu = {
      x,
      y,
      items: [
        { label: 'Neue Seite danach', icon: 'page-plus', run: () => doc.addPage(index + 1) },
        { label: 'Duplizieren', icon: 'copy', run: () => void doc.duplicatePage(id) },
        { label: 'Vorlage ändern …', icon: 'template', run: () => onpaper(id) },
        {
          label: 'Seite löschen',
          icon: 'trash',
          danger: true,
          disabled: pageIds.length <= 1,
          run: () => void doc.deletePage(id),
        },
      ],
    };
  }

  // ---------- Umsortieren ----------

  function indexAt(y: number): number {
    if (!listEl) return 0;
    const items = [...listEl.querySelectorAll<HTMLElement>('[data-index]')];
    for (const el of items) {
      const r = el.getBoundingClientRect();
      if (y < r.top + r.height / 2) return Number(el.dataset.index);
    }
    return pageIds.length;
  }

  function startReorder(index: number, e: PointerEvent) {
    reorder = { from: index, to: index, pointerId: e.pointerId, y: e.clientY };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('touchmove', prevent, { passive: false });
  }

  function prevent(e: TouchEvent) {
    e.preventDefault();
  }

  function onMove(e: PointerEvent) {
    if (!reorder || e.pointerId !== reorder.pointerId) return;
    reorder.y = e.clientY;
    reorder.to = indexAt(e.clientY);
    // am Rand automatisch scrollen
    if (listEl) {
      const r = listEl.getBoundingClientRect();
      if (e.clientY < r.top + 40) listEl.scrollTop -= 12;
      else if (e.clientY > r.bottom - 40) listEl.scrollTop += 12;
    }
  }

  function onUp(e: PointerEvent) {
    if (!reorder || e.pointerId !== reorder.pointerId) return;
    const { from, to } = reorder;
    reorder = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('touchmove', prevent);
    if (e.type === 'pointerup') {
      const target = to > from ? to - 1 : to;
      if (target !== from) doc.movePage(from, target);
    }
  }

  $effect(() => {
    // aktuelle Seite in den sichtbaren Bereich holen
    const el = listEl?.querySelector<HTMLElement>(`[data-index="${current}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  });
</script>

<aside class="sidebar" aria-label="Seiten">
  <header>
    <h2>Seiten</h2>
    <button class="icon-btn" onclick={onclose} aria-label="Seitenleiste schließen"
      ><Icon name="close" /></button
    >
  </header>
  <div class="list" bind:this={listEl}>
    {#each pageIds as id, i (id)}
      {#if reorder && reorder.to === i && reorder.from !== i}<div class="drop-line"></div>{/if}
      <div
        class="thumb"
        class:current={i === current}
        class:moving={reorder?.from === i}
        data-index={i}
        role="button"
        tabindex="0"
        aria-label="Seite {i + 1}"
        aria-current={i === current ? 'page' : undefined}
        use:press={{
          tap: () => ongo(i),
          menu: (x, y) => pageMenu(i, x, y),
          drag: (e) => startReorder(i, e),
        }}
      >
        <canvas use:thumb={{ pageId: id, version: versions[id] ?? 0 }} style:width="{THUMB_W}px"></canvas>
        <span class="num">{i + 1}</span>
        <button
          class="more"
          aria-label="Aktionen für Seite {i + 1}"
          onpointerdown={(e) => e.stopPropagation()}
          onclick={(e) => {
            e.stopPropagation();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            pageMenu(i, r.left, r.bottom + 4);
          }}><Icon name="more" size={18} /></button
        >
      </div>
    {/each}
    {#if reorder && reorder.to === pageIds.length}<div class="drop-line"></div>{/if}
    <button class="add" onclick={() => doc.addPage(pageIds.length)}>
      <Icon name="plus" size={20} /> Seite anhängen
    </button>
  </div>
</aside>

{#if menu}
  <Menu x={menu.x} y={menu.y} items={menu.items} onclose={() => (menu = null)} />
{/if}

<style>
  .sidebar {
    position: absolute;
    left: calc(10px + var(--safe-left));
    top: calc(var(--toolbar-h, 64px) + 8px);
    bottom: calc(10px + var(--safe-bottom));
    width: 196px;
    display: flex;
    flex-direction: column;
    background: var(--bar);
    -webkit-backdrop-filter: blur(16px);
    backdrop-filter: blur(16px);
    border-radius: 18px;
    box-shadow: var(--shadow-lift);
    z-index: 20;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 4px 0 16px;
  }
  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
  .list {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 6px 16px 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
  }
  .thumb {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 6px;
    border-radius: 10px;
    cursor: pointer;
  }
  .thumb canvas {
    display: block;
    min-height: 60px;
    box-shadow:
      0 0 0 0.5px rgba(22, 32, 58, 0.25),
      0 1px 4px rgba(22, 32, 58, 0.15);
    background: #fff;
  }
  .thumb.current canvas {
    box-shadow: 0 0 0 2.5px var(--accent);
  }
  .thumb:global(.lifted),
  .thumb.moving {
    opacity: 0.5;
  }
  .num {
    font: 500 12px var(--font-ui);
    color: var(--muted);
  }
  .thumb.current .num {
    color: var(--accent);
    font-weight: 700;
  }
  .more {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    color: var(--muted);
  }
  .drop-line {
    width: 100%;
    height: 3px;
    border-radius: 2px;
    background: var(--accent);
    margin: -8px 0;
  }
  .add {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 40px;
    padding: 0 12px;
    border-radius: 10px;
    font: 500 14px var(--font-ui);
    color: var(--accent);
  }
</style>
