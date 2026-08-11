import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './scrollbars.css';
import type { ScrollableElementProps } from './types';
import { defaultScrollableElementStyles } from './types';
import { nextPageScrollPosition, shouldStopTrackAutoScroll, trackClickDirection } from './trackAutoScroll';

const HIDE_TIMEOUT = 500;

const ScrollableElementInner: React.FC<ScrollableElementProps> = ({
  children,
  options = {},
  className = '',
  contentClassName,
  id,
  style,
  onScroll,
  contentRef: externalContentRef,
  'data-testid': dataTestId,
  ...domProps
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  // Burst-safe wheel-scroll target refs. See `handleWheel` for the
  // full reasoning — accumulating into a synchronously-updated
  // target prevents fast wheel events from coalescing onto the
  // same starting position.
  const targetScrollTopRef = useRef<number>(0);
  const targetScrollLeftRef = useRef<number>(0);

  // State
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [isVerticalScrollbarVisible, setIsVerticalScrollbarVisible] = useState(false);
  const [isHorizontalScrollbarVisible, setIsHorizontalScrollbarVisible] = useState(false);
  const [isDraggingVertical, setIsDraggingVertical] = useState(false);
  const [isDraggingHorizontal, setIsDraggingHorizontal] = useState(false);
  const [dragStartY, setDragStartY] = useState(0);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartScrollTop, setDragStartScrollTop] = useState(0);
  const [dragStartScrollLeft, setDragStartScrollLeft] = useState(0);
  const [stickyHeaderBackgroundHeight, setStickyHeaderBackgroundHeight] = useState(0);

  // Merged options/styles, memoised on `options` so a parent re-render doesn't
  // hand every downstream effect a fresh object identity each tick.
  // (IScrollableElementOptions extends IScrollableElementStyles, so `options`
  // legitimately also carries the style keys mergedStyles reads.)
  const mergedOptions = useMemo(() => ({
    useShadows: true,
    handleMouseWheel: true,
    mouseWheelSmoothScroll: true,
    mouseWheelHorizontal: false,
    horizontal: 'visible' as const,
    vertical: 'visible' as const,
    horizontalScrollbarSize: 14,
    verticalScrollbarSize: 14,
    horizontalHasArrows: false,
    verticalHasArrows: false,
    arrowSize: 11,
    scrollByPage: false,
    ...options
  }), [options]);

  const mergedStyles = useMemo(() => ({
    ...defaultScrollableElementStyles,
    ...options
  }), [options]);

  // Calculate scrollbar visibility
  const needsVerticalScrollbar = contentHeight > containerHeight;
  const needsHorizontalScrollbar = contentWidth > containerWidth;

  const showVerticalScrollbar = needsVerticalScrollbar && mergedOptions.vertical !== 'hidden';
  const showHorizontalScrollbar = needsHorizontalScrollbar && mergedOptions.horizontal !== 'hidden';

  const shouldShowVerticalScrollbar = mergedOptions.vertical === 'visible' ||
    (mergedOptions.vertical === 'auto' && isVerticalScrollbarVisible);
  const shouldShowHorizontalScrollbar = mergedOptions.horizontal === 'visible' ||
    (mergedOptions.horizontal === 'auto' && isHorizontalScrollbarVisible);

  const setContentRef = useCallback(
    (node: HTMLDivElement | null): void => {
      contentRef.current = node;
      if (typeof externalContentRef === 'function') {
        externalContentRef(node);
      } else if (externalContentRef && typeof externalContentRef === 'object') {
        // Use Object.assign to update ref without direct mutation
        Object.assign(externalContentRef, { current: node });
      }
    },
    [externalContentRef]
  );

  // Update dimensions
  const updateDimensions = useCallback((): void => {
    if (!containerRef.current || !contentRef.current) return;

    const container = containerRef.current;
    const content = contentRef.current;

    const newContainerWidth = container.clientWidth;
    const newContainerHeight = container.clientHeight;
    const newContentWidth = content.scrollWidth;
    const newContentHeight = content.scrollHeight;

    setContainerWidth(newContainerWidth);
    setContainerHeight(newContainerHeight);
    setContentWidth(newContentWidth);
    setContentHeight(newContentHeight);
  }, []);

  // Show scrollbars
  const showScrollbars = useCallback((): void => {
    if (mergedOptions.vertical === 'auto') {
      setIsVerticalScrollbarVisible(true);
    }
    if (mergedOptions.horizontal === 'auto') {
      setIsHorizontalScrollbarVisible(true);
    }

    // Clear existing timeout
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, [mergedOptions.vertical, mergedOptions.horizontal]);

  // Hover state — keeps the scrollbar visible as long as the mouse
  // is inside the component, even after wheel / scroll activity
  // has settled. Without this, the inactivity timeout would fade
  // the bar out while the user is clearly still interacting with
  // the surface (the mouse hasn't even left).
  const isHoveringRef = useRef(false);

  // Hide scrollbars with delay
  const hideScrollbars = useCallback((): void => {
    // If the mouse is still inside the component, don't schedule a
    // hide — the auto-fade is reserved for the "user moved away or
    // never hovered" case. Pointer-leave fires its own hideScrollbars
    // and sets `isHoveringRef.current = false` first.
    if (isHoveringRef.current) return;
    // Clear existing timeout
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }

    // Set new timeout
    hideTimeoutRef.current = setTimeout(() => {
      if (mergedOptions.vertical === 'auto') {
        setIsVerticalScrollbarVisible(false);
      }
      if (mergedOptions.horizontal === 'auto') {
        setIsHorizontalScrollbarVisible(false);
      }
    }, HIDE_TIMEOUT);
  }, [mergedOptions.vertical, mergedOptions.horizontal]);

  // Smooth scroll toward a target position via a continuous spring/
  // lerp loop. Each call updates `targetScrollTopRef` /
  // `targetScrollLeftRef` and ensures the rAF loop is running; the
  // loop itself reads the target every frame and exponentially
  // eases the live `scrollTop` toward it.
  //
  // Why not a fixed-duration animation? A burst of wheel events
  // fires faster than the 150ms ease-out can complete, and each
  // new event would cancel-and-restart the animation. The
  // in-flight portion is discarded on every restart, so a 10-tick
  // burst lands at ~30% of where the same 10 ticks delivered
  // slowly would put it.
  //
  // The spring approach interpolates with a fixed *time constant*
  // (TAU_MS): each frame moves a constant fraction of the
  // remaining distance, regardless of how often the target moves.
  // Burst writes only mutate `targetScrollTopRef`; the loop keeps
  // running and converges to the latest target with no restart.
  const lastFrameTimeRef = useRef<number>(0);
  const TAU_MS = 80;
  const SETTLE_PX = 0.5;

  const ensureSpringRunning = useCallback((): void => {
    if (animationFrameRef.current !== null) return;
    lastFrameTimeRef.current = performance.now();
    const tick = (): void => {
      if (!contentRef.current) {
        animationFrameRef.current = null;
        return;
      }
      const now = performance.now();
      // Clamp dt so a tab-focus change or a long pause doesn't
      // produce a huge single-frame jump (`Math.exp(-dt/TAU)`
      // would still saturate at 1 but staying defensive keeps
      // future tweaks safe).
      const dt = Math.min(64, now - lastFrameTimeRef.current);
      lastFrameTimeRef.current = now;
      const factor = 1 - Math.exp(-dt / TAU_MS);
      const liveTop = contentRef.current.scrollTop;
      const liveLeft = contentRef.current.scrollLeft;
      // Clamp the target to the REAL scrollable range of the DOM node on
      // every frame. The wheel handler clamps against measured
      // contentHeight/containerHeight state, which can overshoot the true
      // range (sticky spacing, stale measurements) — an out-of-range target
      // can never be reached, so the settle check below would never pass
      // and this loop would keep writing scrollTop forever, silently
      // swallowing every external scroll (native smooth scrollTo,
      // programmatic jumps, anchor navigation).
      const domMaxTop = contentRef.current.scrollHeight - contentRef.current.clientHeight;
      const domMaxLeft = contentRef.current.scrollWidth - contentRef.current.clientWidth;
      targetScrollTopRef.current = Math.max(0, Math.min(targetScrollTopRef.current, domMaxTop));
      targetScrollLeftRef.current = Math.max(0, Math.min(targetScrollLeftRef.current, domMaxLeft));
      const targetTop = targetScrollTopRef.current;
      const targetLeft = targetScrollLeftRef.current;
      const nextTop = liveTop + (targetTop - liveTop) * factor;
      const nextLeft = liveLeft + (targetLeft - liveLeft) * factor;
      // Snap to the exact target when within `SETTLE_PX` to avoid
      // permanent sub-pixel jitter from the exponential approach.
      contentRef.current.scrollTop = Math.abs(targetTop - nextTop) < SETTLE_PX ? targetTop : nextTop;
      contentRef.current.scrollLeft = Math.abs(targetLeft - nextLeft) < SETTLE_PX ? targetLeft : nextLeft;
      // The DOM may round scroll offsets to whole pixels: near the target
      // the exponential step shrinks below 1px, rounds to zero, and the
      // live value stops advancing while still > SETTLE_PX away — the loop
      // would then spin forever, swallowing every external scroll. If the
      // write produced no movement, jump straight to the target and adopt
      // whatever the DOM actually accepts as the final position.
      if (contentRef.current.scrollTop === liveTop && Math.abs(targetTop - liveTop) >= SETTLE_PX) {
        contentRef.current.scrollTop = targetTop;
        targetScrollTopRef.current = contentRef.current.scrollTop;
      }
      if (contentRef.current.scrollLeft === liveLeft && Math.abs(targetLeft - liveLeft) >= SETTLE_PX) {
        contentRef.current.scrollLeft = targetLeft;
        targetScrollLeftRef.current = contentRef.current.scrollLeft;
      }
      if (
        Math.abs(targetTop - contentRef.current.scrollTop) < SETTLE_PX &&
        Math.abs(targetLeft - contentRef.current.scrollLeft) < SETTLE_PX
      ) {
        animationFrameRef.current = null;
        return;
      }
      animationFrameRef.current = requestAnimationFrame(tick);
    };
    animationFrameRef.current = requestAnimationFrame(tick);
  }, []);

  const smoothScrollTo = useCallback((targetScrollTop: number, targetScrollLeft: number): void => {
    if (!contentRef.current) return;
    targetScrollTopRef.current = targetScrollTop;
    targetScrollLeftRef.current = targetScrollLeft;
    ensureSpringRunning();
  }, [ensureSpringRunning]);

  interface IElementsTopAndHeight {
    element: HTMLElement,
    offsetTop: number,
    height: number,
    realHeight: number,
    marginTop: number,
    marginBottom: number,
    stickyLevel: number,
    stickyTop: number,
    onScreenTop: number,
    pushTop: number,
  }

  const elementsTopAndHeightMapRef = useRef<IElementsTopAndHeight[]>([]);
  const lastElementPerStickyLevelRef = useRef<Map<number, IElementsTopAndHeight>>(new Map());

  const computeElementsTopAndHeight = useCallback((container: HTMLElement): number => {
    elementsTopAndHeightMapRef.current = [];
    lastElementPerStickyLevelRef.current = new Map();

    // Support both direct children and nested elements with data-sticky-level
    const stickyNodeList = Array.from(
      container.querySelectorAll<HTMLElement>('[data-sticky-level]')
    );

    // Ensure non-sticky direct children have correct z-index
    for (const child of Array.from(container.children)) {
      if (child instanceof HTMLElement && !child.hasAttribute('data-sticky-level')) {
        child.style.zIndex = '0';
      }
    }

    let maxStickyLevel = 0;
    stickyNodeList.forEach((el: HTMLElement) => {
      const stickyLevel = Number(el.getAttribute('data-sticky-level'));
      if (stickyLevel > 0) {
        maxStickyLevel = Math.max(maxStickyLevel, stickyLevel);
        const rect = el.getBoundingClientRect();
        const computed = window.getComputedStyle(el);
        const mt = parseFloat(computed.marginTop || '0');
        const mb = parseFloat(computed.marginBottom || '0');
        const marginTop = Number.isFinite(mt) ? mt : 0;
        const marginBottom = Number.isFinite(mb) ? mb : 0;
        const realHeight = rect.height + marginTop + marginBottom;
        const currentStickyLevel = stickyLevel;

        let cumulativeSpacing = 0;
        let currentMarginTop = marginTop;
        let last = undefined;
        for (const predecessor of lastElementPerStickyLevelRef.current.values()) {
          if (predecessor.stickyLevel < currentStickyLevel) {
            cumulativeSpacing += Math.max(predecessor.marginBottom, currentMarginTop);
            cumulativeSpacing += predecessor.height;
            currentMarginTop = predecessor.marginTop;
          }
          last = predecessor;
        }
        cumulativeSpacing += last?.marginTop ?? marginTop;

        const currentlementTopAndHeight = {
          element: el,
          offsetTop: el.offsetTop,
          stickyTop: cumulativeSpacing,
          height: rect.height,
          realHeight,
          marginTop,
          marginBottom,
          stickyLevel: currentStickyLevel,
          onScreenTop: el.getBoundingClientRect().top - container.getBoundingClientRect().top,
          pushTop: 0,
        };

        lastElementPerStickyLevelRef.current.set(currentStickyLevel, currentlementTopAndHeight);

        elementsTopAndHeightMapRef.current.push(currentlementTopAndHeight);
      }

    });
    return maxStickyLevel;
  }, []);

  const updateStickyLayout = useCallback((scrollTop: number, container: HTMLElement): void => {

    const maxStickyLevel = computeElementsTopAndHeight(container);

    let updateStickyHeaderBackgroundHeight = scrollTop > 0;
    const elementsTopAndHeightMap = elementsTopAndHeightMapRef.current;
    for (let i = elementsTopAndHeightMap.length - 1; i >= 0; i--) {
      const el = elementsTopAndHeightMap[i];
      if (!el) continue;
      const stickyLevel = el.stickyLevel;

      if (i > 0) {
        for (let j = i - 1; j >= 0; j--) {
          const pushed = elementsTopAndHeightMap[j];

          if (pushed && pushed.stickyLevel >= stickyLevel) {
            const maxMargin = Math.max(pushed.marginBottom, el.marginTop);
            const pushBy = el.onScreenTop - maxMargin - pushed.stickyTop - pushed.height - pushed.marginTop;
            if (pushBy < 0) {
              pushed.pushTop = pushBy;
            }
            pushed.pushTop += el.pushTop;
          }
        }
      }
      el.element.style.zIndex = (maxStickyLevel - stickyLevel + 1).toString();
      el.element.style.position = 'sticky';
      el.element.style.top = `${el.stickyTop + el.pushTop}px`;
      if (updateStickyHeaderBackgroundHeight && el.onScreenTop <= el.stickyTop) {
        setStickyHeaderBackgroundHeight(el.onScreenTop + el.height + el.marginBottom);
        updateStickyHeaderBackgroundHeight = false;
      }
    }
    if (updateStickyHeaderBackgroundHeight || !scrollTop) {
      setStickyHeaderBackgroundHeight(0);
    }
    /*console.clear();
    console.table(elementsTopAndHeightMap?.map(el => ({
      element: el.element.textContent,
      stickyLevel: el.stickyLevel,
      height: Math.round(el.height),
      marginTop: Math.round(el.marginTop),
      marginBottom: Math.round(el.marginBottom),
      stickyTop: Math.round(el.stickyTop),
      offsetTop: Math.round(el.offsetTop),
      onScreenTop: Math.round(el.onScreenTop),
      pushTop: Math.round(el.pushTop),
    })),
    ["element", "stickyLevel", "height", "marginTop", "marginBottom", "stickyTop", "offsetTop", "onScreenTop", "pushTop"])*/

  }, [computeElementsTopAndHeight]);

  // Handle scroll
  const handleScroll = useCallback((): void => {
    if (!contentRef.current) return;

    const newScrollTop = contentRef.current.scrollTop;
    const newScrollLeft = contentRef.current.scrollLeft;

    setScrollTop(newScrollTop);
    setScrollLeft(newScrollLeft);
    onScroll?.(newScrollTop, newScrollLeft);
    showScrollbars();

    updateStickyLayout(newScrollTop, contentRef.current);
    // Hide scrollbars after scroll ends
    hideScrollbars();
  }, [onScroll, showScrollbars, hideScrollbars, updateStickyLayout]);

  // Handle mouse wheel
  const handleWheel = useCallback((event: WheelEvent): void => {
    if (!mergedOptions.handleMouseWheel || !contentRef.current) return;

    let deltaX = event.deltaX;
    let deltaY = event.deltaY;

    // Convert vertical wheel to horizontal scroll if mouseWheelHorizontal is enabled
    if (mergedOptions.mouseWheelHorizontal) {
      deltaX = deltaY;
      deltaY = 0;
    }

    // Scroll chaining: if this scrollable can't move in the wheel's
    // direction (either because the content already fits, or because
    // we're pinned at the matching edge), bail BEFORE `preventDefault`
    // + `stopPropagation` so the event bubbles up to whatever outer
    // scrollable can take it. Native browsers do this for nested
    // `overflow: auto` containers; without it, a nested ScrollableElement
    // — e.g. a ListView dropped inside an outer tab-panel ScrollableElement —
    // swallows every wheel event the cursor lands on, even when it has
    // nothing to scroll itself, and the outer container only scrolls
    // when the cursor sits exactly over its scrollbar.
    //
    // Comparing against the spring target (when a smooth-scroll is in
    // flight) instead of the live `scrollTop` matters during a burst:
    // the next wheel tick fires before the spring has moved the live
    // value off zero, but the target already encodes the planned scroll.
    const maxScrollTop = Math.max(0, contentHeight - containerHeight);
    const maxScrollLeft = Math.max(0, contentWidth - containerWidth);
    const currentTop = animationFrameRef.current !== null
      ? targetScrollTopRef.current
      : contentRef.current.scrollTop;
    const currentLeft = animationFrameRef.current !== null
      ? targetScrollLeftRef.current
      : contentRef.current.scrollLeft;
    const canScrollY = (deltaY > 0 && currentTop < maxScrollTop) || (deltaY < 0 && currentTop > 0);
    const canScrollX = (deltaX > 0 && currentLeft < maxScrollLeft) || (deltaX < 0 && currentLeft > 0);
    if (!canScrollY && !canScrollX) return;

    event.preventDefault();
    event.stopPropagation();
    showScrollbars();

    if (mergedOptions.mouseWheelSmoothScroll) {
      // Burst-safe accumulation. The spring loop (`ensureSpringRunning`
      // in `smoothScrollTo`) interpolates the live scrollTop toward
      // `targetScrollTopRef.current` with a fixed time constant; we
      // only need to keep that ref accurate.
      //
      // Re-sync to the live position when the spring is idle (no
      // raf pending). That covers the cases where the scrollTop
      // moved by a different mechanism — slider drag, track-click
      // page-jump, programmatic scroll — and the next wheel event
      // should accumulate from the new position rather than from
      // an old wheel-driven target. While the spring is running
      // we leave the target ref alone so the burst keeps
      // accumulating against the in-flight target instead of
      // collapsing back onto the partial-progress live position.
      if (animationFrameRef.current === null) {
        targetScrollTopRef.current = contentRef.current.scrollTop;
        targetScrollLeftRef.current = contentRef.current.scrollLeft;
      }
      targetScrollTopRef.current = Math.max(0, Math.min(targetScrollTopRef.current + deltaY, contentHeight - containerHeight));
      targetScrollLeftRef.current = Math.max(0, Math.min(targetScrollLeftRef.current + deltaX, contentWidth - containerWidth));
      smoothScrollTo(targetScrollTopRef.current, targetScrollLeftRef.current);
    } else {
      contentRef.current.scrollTop += deltaY;
      contentRef.current.scrollLeft += deltaX;
    }

    // Hide scrollbars after wheel interaction
    hideScrollbars();
  }, [mergedOptions.handleMouseWheel, mergedOptions.mouseWheelSmoothScroll, mergedOptions.mouseWheelHorizontal, contentHeight, containerHeight, contentWidth, containerWidth, smoothScrollTo, showScrollbars, hideScrollbars]);

  // Handle mouse enter
  const handleMouseEnter = useCallback((): void => {
    isHoveringRef.current = true;
    showScrollbars();
  }, [showScrollbars]);

  // Handle mouse leave
  const handleMouseLeave = useCallback((): void => {
    isHoveringRef.current = false;
    hideScrollbars();
  }, [hideScrollbars]);

  // Vertical scrollbar calculations
  const verticalSliderSize = needsVerticalScrollbar ?
    Math.max(20, (containerHeight / contentHeight) * (containerHeight - (mergedOptions.verticalHasArrows ? mergedOptions.arrowSize * 2 : 0))) : 0;

  const verticalSliderPosition = needsVerticalScrollbar ?
    (scrollTop / (contentHeight - containerHeight)) * (containerHeight - verticalSliderSize - (mergedOptions.verticalHasArrows ? mergedOptions.arrowSize * 2 : 0)) : 0;

  // Horizontal scrollbar calculations
  const horizontalSliderSize = needsHorizontalScrollbar ?
    Math.max(20, (containerWidth / contentWidth) * (containerWidth - (mergedOptions.horizontalHasArrows ? mergedOptions.arrowSize * 2 : 0))) : 0;

  const horizontalSliderPosition = needsHorizontalScrollbar ?
    (scrollLeft / (contentWidth - containerWidth)) * (containerWidth - horizontalSliderSize - (mergedOptions.horizontalHasArrows ? mergedOptions.arrowSize * 2 : 0)) : 0;

  // Arrow click handlers
  const handleVerticalArrowUp = useCallback((): void => {
    if (!contentRef.current) return;
    const newScrollTop = Math.max(0, scrollTop - 20);
    if (mergedOptions.mouseWheelSmoothScroll) {
      smoothScrollTo(newScrollTop, scrollLeft);
    } else {
      contentRef.current.scrollTop = newScrollTop;
    }
    showScrollbars();
  }, [scrollTop, scrollLeft, mergedOptions.mouseWheelSmoothScroll, smoothScrollTo, showScrollbars]);

  const handleVerticalArrowDown = useCallback((): void => {
    if (!contentRef.current) return;
    const newScrollTop = Math.min(contentHeight - containerHeight, scrollTop + 20);
    if (mergedOptions.mouseWheelSmoothScroll) {
      smoothScrollTo(newScrollTop, scrollLeft);
    } else {
      contentRef.current.scrollTop = newScrollTop;
    }
    showScrollbars();
  }, [scrollTop, scrollLeft, contentHeight, containerHeight, mergedOptions.mouseWheelSmoothScroll, smoothScrollTo, showScrollbars]);

  const handleHorizontalArrowLeft = useCallback((): void => {
    if (!contentRef.current) return;
    const newScrollLeft = Math.max(0, scrollLeft - 20);
    if (mergedOptions.mouseWheelSmoothScroll) {
      smoothScrollTo(scrollTop, newScrollLeft);
    } else {
      contentRef.current.scrollLeft = newScrollLeft;
    }
    showScrollbars();
  }, [scrollTop, scrollLeft, mergedOptions.mouseWheelSmoothScroll, smoothScrollTo, showScrollbars]);

  const handleHorizontalArrowRight = useCallback((): void => {
    if (!contentRef.current) return;
    const newScrollLeft = Math.min(contentWidth - containerWidth, scrollLeft + 20);
    if (mergedOptions.mouseWheelSmoothScroll) {
      smoothScrollTo(scrollTop, newScrollLeft);
    } else {
      contentRef.current.scrollLeft = newScrollLeft;
    }
    showScrollbars();
  }, [scrollTop, scrollLeft, contentWidth, containerWidth, mergedOptions.mouseWheelSmoothScroll, smoothScrollTo, showScrollbars]);

  // Helper: cancel any in-flight spring loop and re-sync the target
  // ref to the current live scroll position. Called whenever the
  // user takes direct control (slider drag, track-click autoscroll)
  // so the spring doesn't fight the manual interaction by pulling
  // scrollTop back toward an old wheel-driven target.
  const cancelSpringAndSyncTarget = useCallback((): void => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (contentRef.current) {
      targetScrollTopRef.current = contentRef.current.scrollTop;
      targetScrollLeftRef.current = contentRef.current.scrollLeft;
    }
  }, []);

  // Drag handlers
  const handleVerticalSliderMouseDown = useCallback((event: React.MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    cancelSpringAndSyncTarget();
    setIsDraggingVertical(true);
    setDragStartY(event.clientY);
    setDragStartScrollTop(scrollTop);
    showScrollbars();
  }, [scrollTop, showScrollbars, cancelSpringAndSyncTarget]);

  const handleHorizontalSliderMouseDown = useCallback((event: React.MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    cancelSpringAndSyncTarget();
    setIsDraggingHorizontal(true);
    setDragStartX(event.clientX);
    setDragStartScrollLeft(scrollLeft);
    showScrollbars();
  }, [scrollLeft, showScrollbars, cancelSpringAndSyncTarget]);

  // Track-click autoscroll. Clicking the rail above / below the
  // thumb scrolls one viewport in that direction; holding the
  // mouse button repeats the page-jump every TRACK_REPEAT_INTERVAL_MS
  // until either the thumb passes the cursor's position or the
  // user releases the button. Mirrors Chromium's native scrollbar
  // feel.
  const trackIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const trackCursorYRef = useRef<number>(0);
  const trackCursorXRef = useRef<number>(0);
  const TRACK_REPEAT_INTERVAL_MS = 60;
  const TRACK_INITIAL_DELAY_MS = 250;

  const stopTrackAutoScroll = useCallback((): void => {
    if (trackIntervalRef.current !== null) {
      clearInterval(trackIntervalRef.current);
      trackIntervalRef.current = null;
    }
  }, []);

  const handleVerticalRailMouseDown = useCallback((event: React.MouseEvent): void => {
    // Only react to clicks on the rail itself — not on the slider
    // (its own handler calls stopPropagation) or the arrows
    // (children that own the click).
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    if (!contentRef.current) return;
    cancelSpringAndSyncTarget();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const cursorY = event.clientY - rect.top;
    trackCursorYRef.current = cursorY;
    const arrowOffset = mergedOptions.verticalHasArrows ? mergedOptions.arrowSize : 0;
    const thumbStart = arrowOffset + verticalSliderPosition;
    const thumbEnd = thumbStart + verticalSliderSize;
    const dir = trackClickDirection(cursorY, thumbStart, thumbEnd);
    // No-op when the cursor is already on the thumb (the slider's
    // own handler caught the event in that case anyway, but be
    // defensive).
    if (dir === null) return;
    const pageJump = (): void => {
      if (!contentRef.current) return;
      const liveSliderPos = (contentRef.current.scrollTop / (contentHeight - containerHeight)) *
        (containerHeight - verticalSliderSize - arrowOffset * 2);
      const liveThumbStart = arrowOffset + liveSliderPos;
      const liveThumbEnd = liveThumbStart + verticalSliderSize;
      if (shouldStopTrackAutoScroll(liveThumbStart, liveThumbEnd, trackCursorYRef.current, dir)) {
        stopTrackAutoScroll();
        return;
      }
      contentRef.current.scrollTop = nextPageScrollPosition(
        contentRef.current.scrollTop,
        containerHeight,
        contentHeight,
        dir
      );
    };
    pageJump();
    showScrollbars();
    // Initial pause matches Chromium's native scrollbar (a single
    // click shouldn't auto-repeat instantly — gives the user time
    // to release before the loop kicks in).
    const startTimeout = setTimeout(() => {
      trackIntervalRef.current = setInterval(pageJump, TRACK_REPEAT_INTERVAL_MS);
    }, TRACK_INITIAL_DELAY_MS);
    const onPointerUp = (): void => {
      clearTimeout(startTimeout);
      stopTrackAutoScroll();
      document.removeEventListener('pointerup', onPointerUp);
    };
    document.addEventListener('pointerup', onPointerUp);
  }, [containerHeight, contentHeight, verticalSliderPosition, verticalSliderSize, mergedOptions.verticalHasArrows, mergedOptions.arrowSize, stopTrackAutoScroll, showScrollbars, cancelSpringAndSyncTarget]);

  const handleHorizontalRailMouseDown = useCallback((event: React.MouseEvent): void => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    if (!contentRef.current) return;
    cancelSpringAndSyncTarget();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    trackCursorXRef.current = cursorX;
    const arrowOffset = mergedOptions.horizontalHasArrows ? mergedOptions.arrowSize : 0;
    const thumbStart = arrowOffset + horizontalSliderPosition;
    const thumbEnd = thumbStart + horizontalSliderSize;
    const dir = trackClickDirection(cursorX, thumbStart, thumbEnd);
    if (dir === null) return;
    const pageJump = (): void => {
      if (!contentRef.current) return;
      const liveSliderPos = (contentRef.current.scrollLeft / (contentWidth - containerWidth)) *
        (containerWidth - horizontalSliderSize - arrowOffset * 2);
      const liveThumbStart = arrowOffset + liveSliderPos;
      const liveThumbEnd = liveThumbStart + horizontalSliderSize;
      if (shouldStopTrackAutoScroll(liveThumbStart, liveThumbEnd, trackCursorXRef.current, dir)) {
        stopTrackAutoScroll();
        return;
      }
      contentRef.current.scrollLeft = nextPageScrollPosition(
        contentRef.current.scrollLeft,
        containerWidth,
        contentWidth,
        dir
      );
    };
    pageJump();
    showScrollbars();
    const startTimeout = setTimeout(() => {
      trackIntervalRef.current = setInterval(pageJump, TRACK_REPEAT_INTERVAL_MS);
    }, TRACK_INITIAL_DELAY_MS);
    const onPointerUp = (): void => {
      clearTimeout(startTimeout);
      stopTrackAutoScroll();
      document.removeEventListener('pointerup', onPointerUp);
    };
    document.addEventListener('pointerup', onPointerUp);
  }, [containerWidth, contentWidth, horizontalSliderPosition, horizontalSliderSize, mergedOptions.horizontalHasArrows, mergedOptions.arrowSize, stopTrackAutoScroll, showScrollbars, cancelSpringAndSyncTarget]);

  // Cleanup on unmount: any pending interval / timeout would
  // otherwise outlive the component and leak.
  useEffect(() => {
    return () => { stopTrackAutoScroll(); };
  }, [stopTrackAutoScroll]);

  // Global mouse move handler
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent): void => {
      if (isDraggingVertical && contentRef.current) {
        const deltaY = event.clientY - dragStartY;
        const trackHeight = containerHeight - verticalSliderSize - (mergedOptions.verticalHasArrows ? mergedOptions.arrowSize * 2 : 0);
        const scrollRatio = deltaY / trackHeight;
        const newScrollTop = Math.max(0, Math.min(
          dragStartScrollTop + scrollRatio * (contentHeight - containerHeight),
          contentHeight - containerHeight
        ));
        contentRef.current.scrollTop = newScrollTop;
      }

      if (isDraggingHorizontal && contentRef.current) {
        const deltaX = event.clientX - dragStartX;
        const trackWidth = containerWidth - horizontalSliderSize - (mergedOptions.horizontalHasArrows ? mergedOptions.arrowSize * 2 : 0);
        const scrollRatio = deltaX / trackWidth;
        const newScrollLeft = Math.max(0, Math.min(
          dragStartScrollLeft + scrollRatio * (contentWidth - containerWidth),
          contentWidth - containerWidth
        ));
        contentRef.current.scrollLeft = newScrollLeft;
      }
    };

    const handleMouseUp = (): void => {
      setIsDraggingVertical(false);
      setIsDraggingHorizontal(false);
    };

    if (isDraggingVertical || isDraggingHorizontal) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingVertical, isDraggingHorizontal, dragStartY, dragStartX, dragStartScrollTop, dragStartScrollLeft, containerHeight, containerWidth, verticalSliderSize, horizontalSliderSize, contentHeight, contentWidth, mergedOptions.verticalHasArrows, mergedOptions.horizontalHasArrows, mergedOptions.arrowSize]);

  // Note: scrollbar visibility state is only used for 'auto' mode.
  // For 'visible' and 'hidden' modes, the shouldShow* variables handle it directly.

  // Add wheel event listener with passive: false
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  // Update dimensions on mount and resize
  useEffect(() => {
    updateDimensions();

    const resizeObserver = new ResizeObserver(updateDimensions);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    if (contentRef.current) {
      resizeObserver.observe(contentRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [updateDimensions]);

  // Update dimensions when children change (e.g., when switching tabs).
  // NOT keyed on scrollTop — re-running this rAF + scrollWidth/Height read on
  // every scroll tick was pure layout thrash; size changes are already covered
  // by the ResizeObserver above (observing both container and content).
  useEffect(() => {
    // Use requestAnimationFrame to allow DOM to update before recalculating dimensions
    const frameId = requestAnimationFrame(() => {
      updateDimensions();
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [children, updateDimensions]);

  // Container classes
  const containerClasses = [
    'scrollable-element',
    className
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={containerRef}
      id={id}
      className={containerClasses}
      {...(dataTestId && {
        'data-testid': dataTestId,
        'data-scroll-top': String(Math.round(scrollTop)),
        'data-scroll-left': String(Math.round(scrollLeft)),
        'data-container-width': String(Math.round(containerWidth)),
        'data-container-height': String(Math.round(containerHeight)),
        'data-content-width': String(Math.round(contentWidth)),
        'data-content-height': String(Math.round(contentHeight)),
      })}
      style={{
        position: 'relative',
        overflow: 'hidden',
        ...style
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Scroll shadows (only horizontal/left shadow kept for now) */}
      {mergedOptions.useShadows && scrollLeft > 0 && (
        <div
          className="shadow left"
          {...(dataTestId && { 'data-testid': `${dataTestId}-left-shadow` })}
        />
      )}

      {/* Content wrapper */}
      <div
        ref={setContentRef}
        className={`scrollable-content${contentClassName ? ` ${contentClassName}` : ''}`}
        {...(dataTestId && {
          'data-testid': `${dataTestId}-content`,
          'data-scroll-top': String(Math.round(scrollTop)),
          'data-scroll-left': String(Math.round(scrollLeft)),
          'data-container-width': String(Math.round(containerWidth)),
          'data-container-height': String(Math.round(containerHeight)),
          'data-content-width': String(Math.round(contentWidth)),
          'data-content-height': String(Math.round(contentHeight)),
        })}
        style={{
          width: '100%',
          height: mergedOptions.fitContent ? 'auto' : '100%',
          minHeight: mergedOptions.fitContent ? 'auto' : '100%',
          maxHeight: mergedOptions.fitContent ? style?.maxHeight : undefined,
          overflow: 'auto',
          position: 'relative',
          // Reserve a gutter for the overlay scrollbar so it never sits ON TOP
          // of the content. The scrollbars are absolutely-positioned siblings
          // over this div's right / bottom edge; without this inset the last
          // column of text or a trailing control renders under the thumb. Only
          // reserved when a scrollbar is actually present (content overflows),
          // and `border-box` keeps the `width/height: 100%` honest so children
          // shrink into the gutter instead of overflowing. Consumers should NOT
          // add their own scrollbar-compensation margin on top of this.
          boxSizing: 'border-box',
          paddingRight: showVerticalScrollbar ? mergedOptions.verticalScrollbarSize : undefined,
          paddingBottom: showHorizontalScrollbar ? mergedOptions.horizontalScrollbarSize : undefined,
          // While the user is dragging the scrollbar thumb, the
          // mouse can wander OFF the rail and onto whatever is
          // underneath — child rows would then receive hover /
          // mouseenter events the user didn't intend. Suppress
          // pointer events on the content area during a drag so
          // hover state stays frozen on whatever it was before
          // the drag began. The scrollbar lives outside this div
          // so its own listeners keep working.
          pointerEvents: (isDraggingVertical || isDraggingHorizontal) ? 'none' : undefined,
        }}
        onScroll={handleScroll}
        {...domProps}
      >
        {stickyHeaderBackgroundHeight > 0 && (
          <div
            style={{
              position: 'sticky',
              top: 0,
              height: stickyHeaderBackgroundHeight,
              width: '100%',
              backgroundColor: 'var(--editor-background)',
              // Drop shadow under sticky header background
              boxShadow: '0 4px 4px rgba(0, 0, 0, 0.4)',
              zIndex: 1,
              // Do not push children down: compensate the element's height
              marginBottom: -stickyHeaderBackgroundHeight,
              // Ensure it does not intercept mouse events
              pointerEvents: 'none'
            }}
          />
        )}
        {children}
      </div>

      {/* Vertical scrollbar */}
      {showVerticalScrollbar && (
        <div
          className={`scrollbar vertical ${shouldShowVerticalScrollbar ? 'visible' : 'invisible fade'}`}
          {...(dataTestId && {
            'data-testid': `${dataTestId}-v-scrollbar`,
            'data-is-visible': shouldShowVerticalScrollbar ? 'true' : 'false'
          })}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: mergedOptions.verticalScrollbarSize,
            height: '100%',
            backgroundColor: 'transparent',
            cursor: 'pointer'
          }}
          onMouseDown={handleVerticalRailMouseDown}
        >
          {mergedOptions.verticalHasArrows && (
            <div
              className="scra arrow-up"
              {...(dataTestId && { 'data-testid': `${dataTestId}-v-arrow-up` })}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: mergedOptions.verticalScrollbarSize,
                height: mergedOptions.arrowSize,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '11px'
              }}
              onClick={handleVerticalArrowUp}
            >
              ▲
            </div>
          )}
          <div
            className="slider"
            {...(dataTestId && { 'data-testid': `${dataTestId}-v-slider` })}
            style={{
              position: 'absolute',
              left: 0,
              top: (mergedOptions.verticalHasArrows ? mergedOptions.arrowSize : 0) + verticalSliderPosition,
              width: mergedOptions.verticalScrollbarSize,
              height: verticalSliderSize,
              backgroundColor: mergedStyles.scrollbarSliderBackground,
              cursor: 'pointer',
              borderRadius: '2px'
            }}
            onMouseDown={handleVerticalSliderMouseDown}
          />
          {mergedOptions.verticalHasArrows && (
            <div
              className="scra arrow-down"
              {...(dataTestId && { 'data-testid': `${dataTestId}-v-arrow-down` })}
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                width: mergedOptions.verticalScrollbarSize,
                height: mergedOptions.arrowSize,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '11px'
              }}
              onClick={handleVerticalArrowDown}
            >
              ▼
            </div>
          )}
        </div>
      )}

      {/* Horizontal scrollbar */}
      {showHorizontalScrollbar && (
        <div
          className={`scrollbar horizontal ${shouldShowHorizontalScrollbar ? 'visible' : 'invisible fade'}`}
          {...(dataTestId && {
            'data-testid': `${dataTestId}-h-scrollbar`,
            'data-is-visible': shouldShowHorizontalScrollbar ? 'true' : 'false'
          })}
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '100%',
            height: mergedOptions.horizontalScrollbarSize,
            backgroundColor: 'transparent',
            cursor: 'pointer'
          }}
          onMouseDown={handleHorizontalRailMouseDown}
        >
          {mergedOptions.horizontalHasArrows && (
            <div
              className="scra arrow-left"
              {...(dataTestId && { 'data-testid': `${dataTestId}-h-arrow-left` })}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: mergedOptions.arrowSize,
                height: mergedOptions.horizontalScrollbarSize,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '11px'
              }}
              onClick={handleHorizontalArrowLeft}
            >
              ◀
            </div>
          )}
          <div
            className="slider"
            {...(dataTestId && { 'data-testid': `${dataTestId}-h-slider` })}
            style={{
              position: 'absolute',
              top: 0,
              left: (mergedOptions.horizontalHasArrows ? mergedOptions.arrowSize : 0) + horizontalSliderPosition,
              width: horizontalSliderSize,
              height: mergedOptions.horizontalScrollbarSize,
              backgroundColor: mergedStyles.scrollbarSliderBackground,
              cursor: 'pointer',
              borderRadius: '2px'
            }}
            onMouseDown={handleHorizontalSliderMouseDown}
          />
          {mergedOptions.horizontalHasArrows && (
            <div
              className="scra arrow-right"
              {...(dataTestId && { 'data-testid': `${dataTestId}-h-arrow-right` })}
              style={{
                position: 'absolute',
                right: 0,
                top: 0,
                width: mergedOptions.arrowSize,
                height: mergedOptions.horizontalScrollbarSize,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '11px'
              }}
              onClick={handleHorizontalArrowRight}
            >
              ▶
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ScrollableElement = React.memo(ScrollableElementInner);
export { ScrollableElement };
