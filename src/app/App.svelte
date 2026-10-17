<script lang="ts">
  import Library from './library/Library.svelte';
  import EditorView from './editor/EditorView.svelte';
  import SettingsSheet from './settings/SettingsSheet.svelte';
  import Toasts from './components/Toasts.svelte';
  import { router } from './stores/router.svelte';
  import { settings } from './stores/settings.svelte';

  let showSettings = $state(false);
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
      onsettings={() => (showSettings = true)}
    />
  {/key}
{:else}
  <Library route={router.route} onsettings={() => (showSettings = true)} />
{/if}

{#if showSettings}
  <SettingsSheet onclose={() => (showSettings = false)} />
{/if}

<Toasts />
