import React, { useState, useEffect, useRef, useCallback } from 'react';
import './scrollbars.css';
import type { ScrollableElementProps } from './types';
import { defaultScrollableElementStyles } from './types';

const HIDE_TIMEOUT = 500;

const ScrollableElement: React.FC<ScrollableElementProps> = ({
  children,
  options = {},
  className = '',
  id,
  style,
  onScroll
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const animationFrameRef = useRef<number | null>(null);

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

  // Merged options with defaults
  const mergedOptions = {
    useShadows: true,
    handleMouseWheel: true,
    mouseWheelSmoothScroll: true,
		mouseWheelHorizontal: false,
    horizontal: 'auto' as const,
    vertical: 'auto' as const,
    horizontalScrollbarSize: 10,
    verticalScrollbarSize: 10,
    horizontalHasArrows: false,
    verticalHasArrows: false,
    arrowSize: 11,
    scrollByPage: false,
    ...options
  };

  const mergedStyles = {
    ...defaultScrollableElementStyles,
    ...options
  };

  // Calculate scrollbar visibility
  const needsVerticalScrollbar = contentHeight > containerHeight;
  const needsHorizontalScrollbar = contentWidth > containerWidth;

  const showVerticalScrollbar = needsVerticalScrollbar && mergedOptions.vertical !== 'hidden';
  const showHorizontalScrollbar = needsHorizontalScrollbar && mergedOptions.horizontal !== 'hidden';

  const shouldShowVerticalScrollbar = mergedOptions.vertical === 'visible' || 
    (mergedOptions.vertical === 'auto' && isVerticalScrollbarVisible);
  const shouldShowHorizontalScrollbar = mergedOptions.horizontal === 'visible' || 
    (mergedOptions.horizontal === 'auto' && isHorizontalScrollbarVisible);

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

  // Hide scrollbars with delay
  const hideScrollbars = useCallback((): void => {
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

  // Smooth scroll to position
  const smoothScrollTo = useCallback((targetScrollTop: number, targetScrollLeft: number): void => {
    if (!contentRef.current) return;

    const startScrollTop = scrollTop;
    const startScrollLeft = scrollLeft;
    const startTime = Date.now();
    const duration = 150; // ms

    const animate = (): void => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing function (ease-out)
      const easeOut = 1 - Math.pow(1 - progress, 3);
      
      const currentScrollTop = startScrollTop + (targetScrollTop - startScrollTop) * easeOut;
      const currentScrollLeft = startScrollLeft + (targetScrollLeft - startScrollLeft) * easeOut;
      
      if (contentRef.current) {
        contentRef.current.scrollTop = currentScrollTop;
        contentRef.current.scrollLeft = currentScrollLeft;
      }
      
      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    };

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = requestAnimationFrame(animate);
  }, [scrollTop, scrollLeft]);

  // Handle scroll
  const handleScroll = useCallback((): void => {
    if (!contentRef.current) return;

    const newScrollTop = contentRef.current.scrollTop;
    const newScrollLeft = contentRef.current.scrollLeft;

    setScrollTop(newScrollTop);
    setScrollLeft(newScrollLeft);
    onScroll?.(newScrollTop, newScrollLeft);
    showScrollbars();
    
    // Hide scrollbars after scroll ends
    hideScrollbars();
  }, [onScroll, showScrollbars, hideScrollbars]);

  // Handle mouse wheel
  const handleWheel = useCallback((event: WheelEvent): void => {
    if (!mergedOptions.handleMouseWheel || !contentRef.current) return;

    event.preventDefault();
    event.stopPropagation();
    showScrollbars();

		let deltaX = event.deltaX;
		let deltaY = event.deltaY;

		// Convert vertical wheel to horizontal scroll if mouseWheelHorizontal is enabled
		if (mergedOptions.mouseWheelHorizontal) {
			deltaX = deltaY;
			deltaY = 0;
		}

    if (mergedOptions.mouseWheelSmoothScroll) {
      const newScrollTop = Math.max(0, Math.min(scrollTop + deltaY, contentHeight - containerHeight));
      const newScrollLeft = Math.max(0, Math.min(scrollLeft + deltaX, contentWidth - containerWidth));
      smoothScrollTo(newScrollTop, newScrollLeft);
    } else {
      contentRef.current.scrollTop += deltaY;
      contentRef.current.scrollLeft += deltaX;
    }
    
    // Hide scrollbars after wheel interaction
    hideScrollbars();
	}, [mergedOptions.handleMouseWheel, mergedOptions.mouseWheelSmoothScroll, mergedOptions.mouseWheelHorizontal, scrollTop, scrollLeft, contentHeight, containerHeight, contentWidth, containerWidth, smoothScrollTo, showScrollbars, hideScrollbars]);

  // Handle mouse enter
  const handleMouseEnter = useCallback((): void => {
    showScrollbars();
  }, [showScrollbars]);

  // Handle mouse leave
  const handleMouseLeave = useCallback((): void => {
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

  // Drag handlers
  const handleVerticalSliderMouseDown = useCallback((event: React.MouseEvent): void => {
    event.preventDefault();
    setIsDraggingVertical(true);
    setDragStartY(event.clientY);
    setDragStartScrollTop(scrollTop);
    showScrollbars();
  }, [scrollTop, showScrollbars]);

  const handleHorizontalSliderMouseDown = useCallback((event: React.MouseEvent): void => {
    event.preventDefault();
    setIsDraggingHorizontal(true);
    setDragStartX(event.clientX);
    setDragStartScrollLeft(scrollLeft);
    showScrollbars();
  }, [scrollLeft, showScrollbars]);

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

  // Initialize scrollbar visibility based on options
  useEffect(() => {
    if (mergedOptions.vertical === 'visible') {
      setIsVerticalScrollbarVisible(true);
    } else if (mergedOptions.vertical === 'hidden') {
      setIsVerticalScrollbarVisible(false);
    }
    if (mergedOptions.horizontal === 'visible') {
      setIsHorizontalScrollbarVisible(true);
    } else if (mergedOptions.horizontal === 'hidden') {
      setIsHorizontalScrollbarVisible(false);
    }
  }, [mergedOptions.vertical, mergedOptions.horizontal]);

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

  // Update dimensions when children change (e.g., when switching tabs)
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
    'monaco-scrollable-element',
    className
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={containerRef}
      id={id}
      className={containerClasses}
      style={{
        position: 'relative',
        overflow: 'hidden',
        ...style
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Scroll shadows */}
      {mergedOptions.useShadows && (
        <>
          {scrollTop > 0 && <div className="shadow top" />}
          {scrollLeft > 0 && <div className="shadow left" />}
        </>
      )}

      {/* Content wrapper */}
      <div
        ref={contentRef}
        className="scrollable-content"
        style={{
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          position: 'relative'
        }}
        onScroll={handleScroll}
      >
        {children}
      </div>

      {/* Vertical scrollbar */}
      {showVerticalScrollbar && (
        <div
          className={`scrollbar vertical ${shouldShowVerticalScrollbar ? 'visible' : 'invisible fade'}`}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: mergedOptions.verticalScrollbarSize,
            height: '100%',
            backgroundColor: 'transparent'
          }}
        >
          {mergedOptions.verticalHasArrows && (
            <div
              className="scra arrow-up"
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
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '100%',
            height: mergedOptions.horizontalScrollbarSize,
            backgroundColor: 'transparent'
          }}
        >
          {mergedOptions.horizontalHasArrows && (
            <div
              className="scra arrow-left"
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

export { ScrollableElement };
export default ScrollableElement;
