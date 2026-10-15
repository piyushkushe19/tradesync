import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

const KINDS = {
  success: { Icon: CheckCircle2, cls: 'border-ok text-ok' },
  error: { Icon: XCircle, cls: 'border-bad text-bad' },
  warning: { Icon: AlertTriangle, cls: 'border-warn text-warn' },
  info: { Icon: Info, cls: 'border-brand text-brand' },
};

export default function ToastHost({ toasts, onDismiss }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => {
        const k = KINDS[t.kind] ?? KINDS.info;
        return (
          <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className={`pointer-events-auto flex gap-3 rounded-lg border-l-4 bg-white p-3 shadow-lg ring-1 ring-line ${k.cls}`}>
            <k.Icon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1 text-ink">
              <p className="text-sm font-semibold">{t.title}</p>
              {t.message && <p className="text-sm text-ink-soft">{t.message}</p>}
            </div>
            <button onClick={() => onDismiss(t.id)} aria-label="Dismiss notification" className="self-start text-ink-faint hover:text-ink"><X size={16} /></button>
          </div>
        );
      })}
    </div>
  );
}
