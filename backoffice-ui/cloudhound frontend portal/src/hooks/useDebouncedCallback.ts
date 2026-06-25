import { useCallback, useEffect, useRef } from 'react';

export function useDebouncedCallback<T extends (...args: Parameters<T>) => void>(
  callback: T,
  delayMs: number,
): T {
  const timerRef = useRef<number | undefined>(undefined);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  return useCallback(
    ((...args: Parameters<T>) => {
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        callbackRef.current(...args);
      }, delayMs);
    }) as T,
    [delayMs],
  );
}
