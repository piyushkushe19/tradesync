import { useCallback, useEffect, useRef, useState } from 'react';

export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const notify = useCallback((kind, title, message) => {
    const id = crypto.randomUUID();
    setToasts((t) => [...t.slice(-3), { id, kind, title, message }]);
    timers.current.set(id, setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 5000));
  }, [dismiss]);

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  return { toasts, notify, dismiss };
}
