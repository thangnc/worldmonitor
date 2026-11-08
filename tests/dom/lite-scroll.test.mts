// Lite overlay scroll areas (src/lite/components/scroll.tsx). The library must
// wrap a Preact-owned viewport and leave Preact's children in place, so re-renders
// still patch them. Without ResizeObserver the area keeps native scrolling.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { OverlayScroll } from '../../src/lite/components/scroll';

function mount(items: string[]): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  act(() => {
    render(
      h(OverlayScroll, { class: 'max-h-[40px] overflow-y-auto', contentClass: 'px-2' },
        items.map((t) => h('p', { key: t }, t))),
      root,
    );
  });
  return root;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('Lite OverlayScroll', () => {
  it('starts the overlay on its own viewport and keeps Preact children patchable', () => {
    const root = mount(['a', 'b']);
    const host = root.querySelector<HTMLElement>('[data-lite-scroll="y"]');
    expect(host).not.toBeNull();
    expect(host!.hasAttribute('data-overlayscrollbars')).toBe(true);
    const viewport = host!.querySelector<HTMLElement>('[data-overlayscrollbars-viewport]');
    expect(viewport?.parentElement).toBe(host);
    // The viewport is the Preact-owned div, not one the library generated around it.
    expect(viewport!.className).toBe('h-full');
    expect(viewport!.firstElementChild?.className).toBe('px-2');
    expect(viewport!.querySelector('.px-2')?.textContent).toBe('ab');
    expect(host!.querySelector('.os-scrollbar.os-theme-lite')).not.toBeNull();

    act(() => {
      render(
        h(OverlayScroll, { class: 'max-h-[40px] overflow-y-auto', contentClass: 'px-2' },
          ['a', 'c', 'd'].map((t) => h('p', { key: t }, t))),
        root,
      );
    });
    expect(viewport!.querySelector('.px-2')?.textContent).toBe('acd');

    act(() => render(null, root));
    expect(root.innerHTML).toBe('');
  });

  it('keeps native scrolling when ResizeObserver is missing', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const root = mount(['a']);
    const host = root.querySelector<HTMLElement>('[data-lite-scroll="y"]');
    expect(host!.hasAttribute('data-overlayscrollbars')).toBe(false);
    expect(host!.className).toContain('overflow-y-auto');
    expect(host!.textContent).toBe('a');
  });
});
