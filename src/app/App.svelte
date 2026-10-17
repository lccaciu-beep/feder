<script lang="ts">
  import Library from './library/Library.svelte';
  import EditorView from './editor/EditorView.svelte';
  import SettingsSheet from './settings/SettingsSheet.svelte';
  import Toasts from './components/Toasts.svelte';
  import { router } from './stores/router.svelte';
  import { settings } from './stores/settings.svelte';
  import { ui } from './stores/ui.svelte';
  import LockScreen from './components/LockScreen.svelte';
  import { getLock, type LockConfig } from '../storage/lock';

  // App-Sperre: beim Start und nach Rückkehr aus dem Hintergrund
  let lockCfg = $state.raw<LockConfig | null>(null);
  let locked = $state(false);
  let hiddenAt = 0;

  $effect(() => {
    void getLock().then((cfg) => {
      lockCfg = cfg;
      locked = !!cfg;
    });
    const onVis = async () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        lockCfg = await getLock();
        // Sofort-Sperre: Inhalt verdecken, bevor iOS das Vorschaubild macht
        if (lockCfg && lockCfg.delayMin === 0) locked = true;
      } else if (lockCfg && Date.now() - hiddenAt >= lockCfg.delayMin * 60_000) {
        locked = true;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  });

  let systemDark = $state(window.matchMedia('(prefers-color-scheme: dark)').matches);

  $effect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = (e: MediaQueryListEvent) => (systemDark = e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  });

  $effect(() => {
    const t = settings.value.theme;
    const dark = t === 'dark' || (t === 'system' && systemDark);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  });
</script>

{#if router.route.name === 'notebook'}
  {#key router.route.id}
    <EditorView
      id={router.route.id}
      initialPage={router.route.page}
      initialPageId={router.route.pageId}
      onsettings={() => ui.openSettings()}
    />
  {/key}
{:else}
  <Library route={router.route} onsettings={() => ui.openSettings()} />
{/if}

{#if ui.settingsOpen}
  <SettingsSheet section={ui.settingsSection} onclose={() => ui.closeSettings()} />
{/if}

<Toasts />

{#if locked && lockCfg}
  <LockScreen config={lockCfg} onunlock={() => (locked = false)} />
{/if}
