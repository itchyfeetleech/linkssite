"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
const LensWarp = dynamic(() => import("@/components/LensWarp"), { ssr: false });
import NfoBanner from "@/components/NfoBanner";
import { profileLinks, gameLinks, otherLinks } from "@/data/links";
import { LinkGroups, Sections } from "@/lib/sections";

const DEFAULT_SIZE = { width: 860, height: 560 };
const MIN_WIDTH = 420;
const MIN_HEIGHT = 320;
const SIDE_MARGIN = 16;
const TOP_MARGIN = 56;
const BOTTOM_MARGIN = 72;
const MIN_AVAILABLE_WIDTH = 260;
const MIN_AVAILABLE_HEIGHT = 220;
const WINDOW_ID = "terminal-window";

type Size = { width: number; height: number };
type Position = { x: number; y: number };

const clamp = (value: number, min: number, max: number) => {
  if (Number.isNaN(value)) return min;
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
};

const centerWithin = (size: Size, viewport: Size) => ({
  x: Math.round((viewport.width - size.width) / 2),
  y: Math.round((viewport.height - size.height) / 2),
});

export default function DesktopShell() {
  const windowRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);
  const initializedRef = useRef(false);
  const prevMinimizedRef = useRef(false);

  const [viewport, setViewport] = useState<Size>({ width: 1280, height: 720 });
  const [size, setSize] = useState<Size>(DEFAULT_SIZE);
  const [position, setPosition] = useState<Position>({ x: SIDE_MARGIN, y: TOP_MARGIN });
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const viewportWidth = viewport.width;
  const viewportHeight = viewport.height;

  useEffect(() => {
    const update = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const clampSize = useCallback(
    (candidate: Size) => {
      const availableWidth = Math.max(
        MIN_AVAILABLE_WIDTH,
        viewportWidth - SIDE_MARGIN * 2
      );
      const availableHeight = Math.max(
        MIN_AVAILABLE_HEIGHT,
        viewportHeight - TOP_MARGIN - BOTTOM_MARGIN
      );
      const minWidth = Math.min(MIN_WIDTH, availableWidth);
      const minHeight = Math.min(MIN_HEIGHT, availableHeight);
      return {
        width: clamp(candidate.width, minWidth, availableWidth),
        height: clamp(candidate.height, minHeight, availableHeight),
      };
    },
    [viewportHeight, viewportWidth]
  );

  const clampPosition = useCallback(
    (x: number, y: number, dims: Size = size) => {
      const minX = SIDE_MARGIN;
      const minY = TOP_MARGIN;
      const maxX = viewportWidth - dims.width - SIDE_MARGIN;
      const maxY = viewportHeight - dims.height - BOTTOM_MARGIN;
      const centered = centerWithin(dims, { width: viewportWidth, height: viewportHeight });
      const resolvedX = maxX < minX ? centered.x : clamp(x, minX, maxX);
      const resolvedY = maxY < minY ? centered.y : clamp(y, minY, maxY);
      return { x: resolvedX, y: resolvedY };
    },
    [size, viewportHeight, viewportWidth]
  );

  useEffect(() => {
    setSize((prev) => {
      const next = clampSize(prev);
      if (next.width === prev.width && next.height === prev.height) {
        return prev;
      }
      return next;
    });
  }, [clampSize]);

  useEffect(() => {
    if (!initializedRef.current && viewportWidth && viewportHeight) {
      const initialSize = clampSize(DEFAULT_SIZE);
      const viewportSize = { width: viewportWidth, height: viewportHeight };
      const centerPoint = centerWithin(initialSize, viewportSize);
      const centered = clampPosition(centerPoint.x, centerPoint.y, initialSize);
      setSize(initialSize);
      setPosition(centered);
      initializedRef.current = true;
      return;
    }
    setPosition((prev) => {
      const next = clampPosition(prev.x, prev.y);
      if (next.x === prev.x && next.y === prev.y) {
        return prev;
      }
      return next;
    });
  }, [clampPosition, clampSize, viewportHeight, viewportWidth]);

  useEffect(() => {
    const scene = document.getElementById("crt-scene");
    if (!scene) return;
    const enableNative = isDragging || isResizing;
    scene.classList.toggle("cursor-native", enableNative);
    if (enableNative) {
      scene.style.cursor = isResizing ? "nwse-resize" : "grabbing";
    } else {
      scene.style.cursor = "";
    }
    return () => {
      scene.classList.remove("cursor-native");
      scene.style.cursor = "";
    };
  }, [isDragging, isResizing]);

  useEffect(() => {
    if (prevMinimizedRef.current && !isMinimized && windowRef.current) {
      windowRef.current.focus({ preventScroll: true });
    }
    prevMinimizedRef.current = isMinimized;
  }, [isMinimized]);

  useEffect(() => {
    if (isMinimized) {
      setIsDragging(false);
      setIsResizing(false);
      dragRef.current = null;
      resizeRef.current = null;
    }
  }, [isMinimized]);

  const handleMinimize = useCallback(() => {
    setIsMinimized(true);
  }, []);

  const restoreDefaultLayout = useCallback(() => {
    const defaultSize = clampSize(DEFAULT_SIZE);
    const viewportSize = { width: viewportWidth, height: viewportHeight };
    const centerPoint = centerWithin(defaultSize, viewportSize);
    setSize(defaultSize);
    setPosition(clampPosition(centerPoint.x, centerPoint.y, defaultSize));
    setIsMinimized(false);
  }, [clampPosition, clampSize, viewportHeight, viewportWidth]);

  const handleTaskClick = useCallback(() => {
    setIsMinimized((prev) => !prev);
  }, []);

  const handleTitlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (isMinimized) return;
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest("button")) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        offsetX: event.clientX - position.x,
        offsetY: event.clientY - position.y,
      };
      setIsDragging(true);
    },
    [isMinimized, position.x, position.y]
  );

  const handleTitlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      const nextX = event.clientX - drag.offsetX;
      const nextY = event.clientY - drag.offsetY;
      const nextPos = clampPosition(nextX, nextY);
      setPosition((prev) =>
        prev.x === nextPos.x && prev.y === nextPos.y ? prev : nextPos
      );
    },
    [clampPosition]
  );

  const finishDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsDragging(false);
  }, []);

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (isMinimized) return;
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      resizeRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: size.width,
        startHeight: size.height,
      };
      setIsResizing(true);
    },
    [isMinimized, size.height, size.width]
  );

  const handleResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const info = resizeRef.current;
      if (!info || info.pointerId !== event.pointerId) return;
      event.preventDefault();
      const candidate = {
        width: info.startWidth + (event.clientX - info.startX),
        height: info.startHeight + (event.clientY - info.startY),
      };
      const nextSize = clampSize(candidate);
      setSize((prev) =>
        prev.width === nextSize.width && prev.height === nextSize.height
          ? prev
          : nextSize
      );
      setPosition((prev) => {
        const next = clampPosition(prev.x, prev.y, nextSize);
        return prev.x === next.x && prev.y === next.y ? prev : next;
      });
    },
    [clampPosition, clampSize]
  );

  const finishResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const info = resizeRef.current;
      if (!info || info.pointerId !== event.pointerId) return;
      resizeRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setIsResizing(false);
    },
    []
  );

  const handleTitleDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest("button")) return;
      restoreDefaultLayout();
    },
    [restoreDefaultLayout]
  );

  const windowClasses = useMemo(() => {
    const classes = ["terminal", "window"];
    if (isDragging) classes.push("is-dragging");
    if (isResizing) classes.push("is-resizing");
    return classes.join(" ");
  }, [isDragging, isResizing]);

  const windowStyle = useMemo(
    () => ({
      width: `${size.width}px`,
      height: `${size.height}px`,
      top: `${position.y}px`,
      left: `${position.x}px`,
    }),
    [position.x, position.y, size.height, size.width]
  );

  return (
    <main id="main-content" className="desktop crt" aria-label="Desktop Shell">
      <div className="topbar" aria-hidden>
        <div className="brand">linksshell</div>
        <div className="status">
          <span className="badge hq">CRT HQ</span>
        </div>
      </div>

      <div
        id={WINDOW_ID}
        ref={windowRef}
        className={windowClasses}
        role="region"
        aria-label="NFO Viewer"
        data-section={Sections.TERMINAL_WINDOW}
        style={windowStyle}
        hidden={isMinimized}
        tabIndex={-1}
      >
        <div
          className="titlebar"
          data-section={Sections.TERMINAL_TITLEBAR}
          onPointerDown={handleTitlePointerDown}
          onPointerMove={handleTitlePointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onDoubleClick={handleTitleDoubleClick}
        >
          <span className="dots" data-section={Sections.TITLEBAR_DOTS}>
            <button
              type="button"
              className="dot dot-button"
              data-variant="close"
              aria-label="Close terminal window"
              disabled
            />
            <button
              type="button"
              className="dot dot-button"
              data-variant="minimize"
              aria-label="Minimize terminal window"
              onClick={handleMinimize}
            />
            <button
              type="button"
              className="dot dot-button"
              data-variant="restore"
              aria-label="Restore default layout"
              onClick={restoreDefaultLayout}
            />
          </span>
          <span className="title" data-section={Sections.TITLEBAR_TITLE}>
            HOPPCX.NFO - ansi/2025
          </span>
        </div>
        <div className="screen" data-section={Sections.SCREEN_VIEWPORT}>
          <NfoBanner />
          <ul className="nfo-list" aria-label="Links" data-section={Sections.LINKS_LIST}>
            {profileLinks.map((l) => (
              <li
                key={l.id}
                className="nfo-item"
                data-section={Sections.LINK_ITEM}
                data-group={LinkGroups.PROFILE}
              >
                <span className="nfo-key">{l.label}</span>
                <span className="nfo-arrow" aria-hidden>
                  ›
                </span>
                <a href={l.href} target="_blank" rel="noopener noreferrer">
                  {l.href}
                </a>
              </li>
            ))}
            {gameLinks.map((l) => (
              <li
                key={l.id}
                className="nfo-item"
                data-section={Sections.LINK_ITEM}
                data-group={LinkGroups.GAMES}
              >
                <span className="nfo-key">{l.ariaLabel}</span>
                <span className="nfo-arrow" aria-hidden>
                  ›
                </span>
                <a href={l.href} target="_blank" rel="noopener noreferrer">
                  {l.href}
                </a>
              </li>
            ))}
            {otherLinks.map((l) => (
              <li
                key={l.id}
                className="nfo-item"
                data-section={Sections.LINK_ITEM}
                data-group={LinkGroups.OTHER}
              >
                <span className="nfo-key">{l.label}</span>
                <span className="nfo-arrow" aria-hidden>
                  ›
                </span>
                <a href={l.href} target="_blank" rel="noopener noreferrer">
                  {l.href}
                </a>
              </li>
            ))}
          </ul>
          {/** Mount the LensWarp overlay within the screen container so it only postprocesses terminal content */}
          <LensWarp />
        </div>
        <div
          className="resize-handle"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          aria-hidden="true"
        />
      </div>

      <nav className="taskbar" role="navigation" aria-label="Taskbar">
        <button
          type="button"
          className="task"
          data-active={!isMinimized}
          aria-pressed={!isMinimized}
          aria-controls={WINDOW_ID}
          title="NFO Viewer"
          onClick={handleTaskClick}
        >
          <Image src="/window.svg" alt="" width={16} height={16} aria-hidden className="task-icon" />
          <span>Terminal</span>
        </button>
      </nav>
    </main>
  );
}
