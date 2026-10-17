<script lang="ts">
  import { untrack } from 'svelte';
  import Sheet from '../components/Sheet.svelte';
  import { getBlobStore } from '../../storage/blobstore';
  import type { ImageItem, Rect } from '../../model/types';

  let { item, onclose, onapply }: { item: ImageItem; onclose: () => void; onapply: (crop: Rect) => void } =
    $props();

  let url = $state<string | null>(null);
  let crop = $state<Rect>(untrack(() => ({ ...item.crop })));
  const MAXW = 460;
  const MAXH = 380;
  const k = $derived(Math.min(MAXW / item.natW, MAXH / item.natH));

  $effect(() => {
    let u: string | null = null;
    void (async () => {
      const blob = await (await getBlobStore()).get(item.blobId);
      if (blob) url = u = URL.createObjectURL(blob);
    })();
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  });

  type Handle = 'tl' | 'tr' | 'bl' | 'br' | 'move';
  let drag: { h: Handle; x: number; y: number; start: Rect; id: number } | null = null;

  function down(e: PointerEvent, h: Handle) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { h, x: e.clientX, y: e.clientY, start: { ...crop }, id: e.pointerId };
  }

  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = (e.clientX - drag.x) / k;
    const dy = (e.clientY - drag.y) / k;
    const s = drag.start;
    const min = 20 / k;
    let { x, y, w, h } = s;
    if (drag.h === 'move') {
      x = Math.max(0, Math.min(item.natW - w, s.x + dx));
      y = Math.max(0, Math.min(item.natH - h, s.y + dy));
    } else {
      if (drag.h.includes('l')) {
        x = Math.max(0, Math.min(s.x + s.w - min, s.x + dx));
        w = s.x + s.w - x;
      }
      if (drag.h.includes('r')) w = Math.max(min, Math.min(item.natW - s.x, s.w + dx));
      if (drag.h.includes('t')) {
        y = Math.max(0, Math.min(s.y + s.h - min, s.y + dy));
        h = s.y + s.h - y;
      }
      if (drag.h.includes('b')) h = Math.max(min, Math.min(item.natH - s.y, s.h + dy));
    }
    crop = { x, y, w, h };
  }

  function up() {
    drag = null;
  }
</script>

<Sheet title="Bild zuschneiden" {onclose} wide>
  <div class="stage">
    <div
      class="frame"
      style:width="{item.natW * k}px"
      style:height="{item.natH * k}px"
      role="presentation"
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
    >
      {#if url}<img src={url} alt="" draggable="false" />{/if}
      <div
        class="crop"
        style:left="{crop.x * k}px"
        style:top="{crop.y * k}px"
        style:width="{crop.w * k}px"
        style:height="{crop.h * k}px"
        role="presentation"
        onpointerdown={(e) => down(e, 'move')}
      >
        {#each ['tl', 'tr', 'bl', 'br'] as const as h (h)}
          <span class="h {h}" role="presentation" onpointerdown={(e) => down(e, h)}></span>
        {/each}
      </div>
    </div>
  </div>
  {#snippet footer()}
    <button class="btn" onclick={() => (crop = { x: 0, y: 0, w: item.natW, h: item.natH })}
      >Zurücksetzen</button
    >
    <button
      class="btn primary"
      onclick={() => {
        onapply($state.snapshot(crop));
        onclose();
      }}>Übernehmen</button
    >
  {/snippet}
</Sheet>

<style>
  .stage {
    display: grid;
    place-items: center;
    padding: 8px;
  }
  .frame {
    position: relative;
    touch-action: none;
  }
  img {
    width: 100%;
    height: 100%;
    display: block;
    opacity: 0.45;
    pointer-events: none;
  }
  .crop {
    position: absolute;
    outline: 2px solid var(--accent);
    box-shadow: 0 0 0 9999px rgba(18, 24, 40, 0.25);
    cursor: move;
    background: transparent;
  }
  .h {
    position: absolute;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--surface);
    border: 2px solid var(--accent);
  }
  .tl {
    left: -13px;
    top: -13px;
  }
  .tr {
    right: -13px;
    top: -13px;
  }
  .bl {
    left: -13px;
    bottom: -13px;
  }
  .br {
    right: -13px;
    bottom: -13px;
  }
</style>
