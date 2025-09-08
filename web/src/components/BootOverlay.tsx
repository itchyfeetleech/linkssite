"use client";

import { useEffect, useState } from "react";

export default function BootOverlay() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const hide = () => setHidden(true);

    // Hide overlay as soon as WebGL rendered first frame
    window.addEventListener("webgl-ready", hide);

    // Safety fallback: if WebGL never fires, reveal after a short delay
    const t = window.setTimeout(() => {
      if (!hidden) setHidden(true);
    }, 3500);

    return () => {
      window.removeEventListener("webgl-ready", hide);
      window.clearTimeout(t);
    };
  }, [hidden]);

  return (
    <div
      id="boot-overlay"
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        zIndex: 9999,
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? "none" : "auto",
        transition: "opacity 300ms ease",
      }}
    />
  );
}

