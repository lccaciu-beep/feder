export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  sticky?: boolean;
}

class ToastStore {
  items = $state<Toast[]>([]);
  private seq = 0;

  show(text: string, opts: { action?: Toast['action']; sticky?: boolean; ms?: number } = {}) {
    const t: Toast = { id: ++this.seq, text, action: opts.action, sticky: opts.sticky };
    this.items.push(t);
    if (!opts.sticky) setTimeout(() => this.dismiss(t.id), opts.ms ?? 3500);
    return t.id;
  }

  dismiss(id: number) {
    this.items = this.items.filter((t) => t.id !== id);
  }
}

export const toasts = new ToastStore();
