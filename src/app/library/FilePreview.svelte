<script lang="ts">
  // Miniatur einer Seite mit PDF- oder Bild-Hintergrund.
  import { renderThumbnail } from '../../engine/render/thumbnail';
  import type { PaperSpec } from '../../model/types';

  let { paper, width = 72 }: { paper: PaperSpec; width?: number } = $props();
  let canvas = $state<HTMLCanvasElement>();

  $effect(() => {
    if (canvas) void renderThumbnail(canvas, paper, [], width);
  });
</script>

<canvas bind:this={canvas} aria-hidden="true"></canvas>

<style>
  canvas {
    display: block;
    border-radius: 3px;
    background: #fff;
    box-shadow:
      0 0 0 0.5px rgba(22, 32, 58, 0.25),
      0 1px 3px rgba(22, 32, 58, 0.15);
  }
</style>
