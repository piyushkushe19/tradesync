import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';

const STYLES = {
  queued: { cls: 'bg-warn-soft text-warn', Icon: Clock, label: 'Queued' },
  running: { cls: 'bg-warn-soft text-warn', Icon: Loader2, label: 'Running', spin: true },
  completed: { cls: 'bg-ok-soft text-ok', Icon: CheckCircle2, label: 'Completed' },
  failed: { cls: 'bg-bad-soft text-bad', Icon: XCircle, label: 'Failed' },
};

export default function StatusBadge({ status }) {
  const s = STYLES[status] ?? { cls: 'bg-canvas text-ink-soft', Icon: Clock, label: status ?? 'Idle' };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>
      <s.Icon size={13} className={s.spin ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden="true" />
      {s.label}
    </span>
  );
}
