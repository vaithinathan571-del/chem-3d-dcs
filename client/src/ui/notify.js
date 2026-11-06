/**
 * Toast notifications, confirmation dialog and alarm horn.
 */
import { h } from './dom.js';

let toastHost = null;

export function toast(message, kind = 'info', ms = 4000) {
  if (!toastHost) {
    toastHost = h('div.toasts', { role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const el = h(`div.toast.${kind}`, {}, message);
  toastHost.append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

/** Report a command result; returns true on success. */
export function report(result, okMessage) {
  if (result.ok) {
    if (okMessage) toast(okMessage, 'ok', 2500);
    return true;
  }
  toast(result.message ?? 'Command failed', 'error', 6000);
  return false;
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const close = (v) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
    };
    const ok = h(`button.btn${danger ? '.danger' : '.primary'}`, { onclick: () => close(true) }, confirmLabel);
    const overlay = h(
      'div.modal-overlay',
      { onclick: (e) => e.target === overlay && close(false) },
      h('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('h3', {}, title),
        h('p', {}, message),
        h('div.modal-actions', {}, h('button.btn', { onclick: () => close(false) }, 'Cancel'), ok)),
    );
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    ok.focus();
  });
}

/**
 * Generic modal dialog. `actions` is a list of {label, kind?, onClick?(close)};
 * an action without onClick just closes the dialog.
 */
export function modal({ title, body, actions = [{ label: 'Close' }], wide = false }) {
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const buttons = actions.map((a) => h(`button.btn${a.kind ? `.${a.kind}` : ''}`, { onclick: () => (a.onClick ? a.onClick(close) : close()) }, a.label));
  const overlay = h(
    'div.modal-overlay',
    { onclick: (e) => e.target === overlay && close() },
    h(`div.modal${wide ? '.wide' : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('h3', {}, title),
      body,
      h('div.modal-actions', {}, buttons)),
  );
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  buttons.at(-1)?.focus();
  return { close };
}

/** Alarm horn using WebAudio – a short two-tone beep per new urgent alarm. */
export class Horn {
  constructor() {
    this.muted = false;
    this.ctx = null;
  }

  beep(priority) {
    if (this.muted) return;
    try {
      this.ctx ??= new AudioContext();
      const ctx = this.ctx;
      const tones = priority === 'CRITICAL' ? [880, 660, 880] : [660, 520];
      tones.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = f;
        const t0 = ctx.currentTime + i * 0.18;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.05, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.17);
      });
    } catch {
      // audio unavailable
    }
  }
}
