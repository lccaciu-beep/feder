import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import './app/theme/global.css';
import App from './app/App.svelte';
import { installSafariGuards } from './platform/safari';
import { requestPersistence } from './storage/persist';
import { settings } from './app/stores/settings.svelte';
import { toasts } from './app/stores/toast.svelte';

installSafariGuards();

const updateSW = registerSW({
  onNeedRefresh() {
    toasts.show('Eine neue Version von Feder ist bereit.', {
      sticky: true,
      action: { label: 'Neu laden', run: () => void updateSW(true) },
    });
  },
  onOfflineReady() {
    toasts.show('Feder funktioniert jetzt auch offline.');
  },
});

await settings.load();
void requestPersistence();

mount(App, { target: document.getElementById('app')! });
