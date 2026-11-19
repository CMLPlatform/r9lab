import { useCallback, useMemo, useRef, useState } from 'react';
import type { SectionKey, SectionNavApi } from '@/components/base/SectionNavContext';

const SCROLL_OFFSET = 8;
const ACTIVE_THRESHOLD = 56;
// A jump asked for before the section laid out; sections re-register as the page settles.
const PENDING_MS = 1500;

/** Section-position registry for anchored scroll: sections report y, chips jump via scrollTo, scroll-spy sets activeKey. */
export function useSectionNav(
  scrollToY: (y: number) => void,
): SectionNavApi & { onScrollSpy: (offsetY: number) => void } {
  const positionsRef = useRef(new Map<SectionKey, number>());
  const [activeKey, setActiveKey] = useState<SectionKey>('overview');

  const pendingRef = useRef<{ key: SectionKey; until: number } | null>(null);

  const registerSection = useCallback(
    (key: SectionKey, y: number) => {
      positionsRef.current.set(key, y);
      // Anchored sections register again once the page offset settles, so the last
      // registration inside the window decides where the jump lands.
      const pending = pendingRef.current;
      if (pending?.key === key && Date.now() < pending.until) {
        scrollToY(Math.max(0, y - SCROLL_OFFSET));
      }
    },
    [scrollToY],
  );

  const unregisterSection = useCallback((key: SectionKey) => {
    positionsRef.current.delete(key);
  }, []);

  const scrollTo = useCallback(
    (key: SectionKey) => {
      const y = positionsRef.current.get(key);
      if (y === undefined) {
        pendingRef.current = { key, until: Date.now() + PENDING_MS };
        return;
      }
      pendingRef.current = null;
      scrollToY(Math.max(0, y - SCROLL_OFFSET));
    },
    [scrollToY],
  );

  const onScrollSpy = useCallback((offsetY: number) => {
    let best: { key: SectionKey; y: number } | undefined;
    for (const [key, y] of positionsRef.current) {
      if (y <= offsetY + ACTIVE_THRESHOLD && (!best || y > best.y)) {
        best = { key, y };
      }
    }
    if (best) setActiveKey((current) => (current === best.key ? current : best.key));
  }, []);

  return useMemo(
    () => ({ registerSection, unregisterSection, scrollTo, onScrollSpy, activeKey }),
    [registerSection, unregisterSection, scrollTo, onScrollSpy, activeKey],
  );
}
