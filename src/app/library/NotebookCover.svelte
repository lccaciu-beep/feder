<script lang="ts">
  import type { CoverSpec } from '../../model/types';

  let { title, cover, width = 150 }: { title: string; cover: CoverSpec; width?: number } = $props();

  /** Helle Cover bekommen dunkle Schrift. */
  function isLight(hex: string): boolean {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 160;
  }
</script>

<div
  class="cover pattern-{cover.pattern}"
  class:light={isLight(cover.color)}
  style:--c={cover.color}
  style:width="{width}px"
  style:height="{width * 1.32}px"
  aria-hidden="true"
>
  <div class="spine"></div>
  <div class="plate">
    <span>{title || 'Ohne Titel'}</span>
  </div>
</div>

<style>
  .cover {
    position: relative;
    border-radius: 4px 12px 12px 4px;
    background: var(--c);
    box-shadow: var(--shadow-cover);
    overflow: hidden;
    container-type: inline-size;
  }
  /* Buchrücken mit Bindung */
  .spine {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 11%;
    background: linear-gradient(
      90deg,
      rgba(0, 0, 0, 0.28),
      rgba(0, 0, 0, 0.12) 70%,
      rgba(255, 255, 255, 0.12)
    );
    border-right: 1px solid rgba(0, 0, 0, 0.18);
  }
  .pattern-linen {
    background-image:
      repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.06) 0 1px, transparent 1px 3px),
      repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.06) 0 1px, transparent 1px 3px);
  }
  .pattern-stripe {
    background-image: repeating-linear-gradient(90deg, transparent 0 18%, rgba(255, 255, 255, 0.14) 18% 21%);
  }
  .pattern-dots {
    background-image: radial-gradient(rgba(255, 255, 255, 0.2) 1.2px, transparent 1.4px);
    background-size: 10px 10px;
  }
  /* Titelschild */
  .plate {
    position: absolute;
    left: 22%;
    right: 10%;
    top: 16%;
    min-height: 22%;
    padding: 8% 7%;
    display: flex;
    align-items: center;
    background: rgba(251, 252, 253, 0.94);
    border-radius: 3px;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06);
  }
  .plate span {
    font-family: var(--font);
    font-weight: 600;
    font-size: clamp(10px, 10cqi, 17px);
    line-height: 1.2;
    color: #16203a;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow-wrap: anywhere;
  }
  .light .plate {
    background: rgba(255, 255, 255, 0.6);
    box-shadow: 0 0 0 1px rgba(22, 32, 58, 0.12);
  }
</style>
