import { useCallback, useEffect, useState } from 'react';
import {
  probeWebgl2,
  rendererPreference,
  setRendererPreference,
  shouldUseWebglRenderer,
  RENDERER_PREFERENCE_EVENT,
  type RendererPreference,
} from '../terminal/adapters/webgl-support';

/**
 * Terminal renderer preference shared by Settings and the terminal panel.
 * Changing it remounts live terminals so the new renderer applies immediately.
 */
export function useTerminalRenderer() {
  const [preference, setPreference] = useState<RendererPreference>(rendererPreference);

  useEffect(() => {
    const sync = () => setPreference(rendererPreference());
    window.addEventListener(RENDERER_PREFERENCE_EVENT, sync);
    return () => window.removeEventListener(RENDERER_PREFERENCE_EVENT, sync);
  }, []);

  const update = useCallback((next: RendererPreference) => {
    setRendererPreference(next);
    setPreference(next);
  }, []);

  const probe = probeWebgl2();
  const webglActive = shouldUseWebglRenderer(
    navigator.userAgent,
    navigator.platform,
    navigator.maxTouchPoints,
    preference,
    probe,
  );

  return { preference, setPreference: update, webglActive, probeDetail: probe.detail };
}
