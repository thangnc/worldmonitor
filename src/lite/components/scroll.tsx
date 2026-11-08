import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { OverlayScrollbars, type PartialOptions } from 'overlayscrollbars';

// Overlay scrollbars for the Lite UI. They float over the content, take no
// width, and show only while the pointer is over the scroll area. The theme
// (`.os-theme-lite`) lives in lite.css.

type Axis = 'x' | 'y' | 'both';

function scrollOptions(axis: Axis): PartialOptions {
  return {
    overflow: { x: axis === 'y' ? 'hidden' : 'scroll', y: axis === 'x' ? 'hidden' : 'scroll' },
    scrollbars: { theme: 'os-theme-lite', autoHide: 'leave', autoHideDelay: 400, clickScroll: true },
  };
}

/** Without ResizeObserver (jsdom, very old browsers) the areas keep native scrolling. */
export function canOverlay(): boolean {
  return typeof window !== 'undefined' && typeof ResizeObserver !== 'undefined';
}

/**
 * A scroll area with an overlay scrollbar.
 *
 * `class` sizes the area. Keep its native `overflow-*-auto` class there, so it
 * still scrolls if the overlay never starts. The library makes the host a
 * relative flex row and zeroes the viewport's padding, so put layout and
 * padding on `contentClass`, and positioning (sticky, absolute) on a parent.
 * The viewport is Preact-owned and passed to the library, so it never moves
 * Preact's children.
 */
export function OverlayScroll({
  axis = 'y',
  class: className,
  contentClass,
  children,
}: {
  axis?: Axis;
  class?: string;
  contentClass?: string;
  children: ComponentChildren;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current || !viewport.current || !canOverlay()) return;
    const instance = OverlayScrollbars({ target: host.current, elements: { viewport: viewport.current } }, scrollOptions(axis));
    return () => instance.destroy();
  }, [axis]);
  return (
    <div ref={host} class={className} data-lite-scroll={axis}>
      <div ref={viewport} class="h-full">
        <div class={contentClass}>{children}</div>
      </div>
    </div>
  );
}

let page: OverlayScrollbars | null = null;

/** Overlay scrollbar on the page itself. Call once, before the first render. */
export function initPageScroll(): void {
  if (page || !canOverlay()) return;
  // `cancel` keeps the overlay on macOS, whose native scrollbars are already
  // overlaid but show on scroll, not on hover.
  page = OverlayScrollbars(
    { target: document.body, cancel: { body: false, nativeScrollbarsOverlaid: false } },
    scrollOptions('y'),
  );
}

/** The page scrolls inside the overlay viewport, so `window.scrollTo` alone no longer moves it. */
export function scrollPageToTop(): void {
  page?.elements().scrollOffsetElement.scrollTo(0, 0);
  window.scrollTo(0, 0);
}
