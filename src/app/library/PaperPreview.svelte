<script lang="ts">
  import type { PaperSpec } from '../../model/types';
  import { drawPaper } from '../../templates/draw';

  let { paper, width = 72 }: { paper: PaperSpec; width?: number } = $props();
  let canvas = $state<HTMLCanvasElement>();

  $effect(() => {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const k = (width / paper.width) * dpr;
    canvas.width = Math.round(paper.width * k);
    canvas.height = Math.round(paper.height * k);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    drawPaper(ctx, paper, k);
  });
</script>

<canvas
  bind:this={canvas}
  style:width="{width}px"
  style:height="{(width * paper.height) / paper.width}px"
  aria-hidden="true"
></canvas>

<style>
  canvas {
    display: block;
    border-radius: 3px;
    box-shadow:
      0 0 0 0.5px rgba(22, 32, 58, 0.25),
      0 1px 3px rgba(22, 32, 58, 0.15);
  }
</style>
