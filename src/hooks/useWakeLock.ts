// src/hooks/useWakeLock.ts
// Mantém a tela do celular/PC ligada enquanto ativo (Screen Wake Lock API).
import { useCallback, useEffect, useRef, useState } from 'react';

type WakeLockSentinelLike = { release: () => Promise<void> };

export function useWakeLock() {
  const [enabled, setEnabled] = useState(false);
  const [supported] = useState(
    () => typeof navigator !== 'undefined' && 'wakeLock' in navigator
  );
  const lockRef = useRef<WakeLockSentinelLike | null>(null);

  const acquire = useCallback(async () => {
    if (!supported) return;
    try {
      const nav = navigator as unknown as {
        wakeLock: { request: (t: string) => Promise<WakeLockSentinelLike> };
      };
      lockRef.current = await nav.wakeLock.request('screen');
    } catch {
      /* ignora (ex.: aba sem foco) */
    }
  }, [supported]);

  const release = useCallback(async () => {
    try {
      await lockRef.current?.release();
    } catch {
      /* noop */
    }
    lockRef.current = null;
  }, []);

  // Reativa ao voltar o foco, se estava ligado.
  useEffect(() => {
    if (!enabled) return;
    acquire();
    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      release();
    };
  }, [enabled, acquire, release]);

  return { supported, enabled, setEnabled };
}
