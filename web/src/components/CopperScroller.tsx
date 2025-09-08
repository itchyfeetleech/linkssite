"use client";

import { useEffect, useRef } from "react";
import { Sections } from "@/lib/sections";

export default function CopperScroller() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const w = parent.clientWidth;
      const h = Math.max(180, Math.min(320, parent.clientHeight));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);

    const text = 
      "» WELCOME TO HOPPCX — LINKS — FACEIT — LEETIFY — DEADLOCK — VALORANT — OVERWATCH — MARVEL RIVALS — YOUTUBE «  ";

    const t0 = performance.now();
    const render = (now: number) => {
      if (!running) return;
      const dt = (now - t0) * 0.001;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;

      // Clear
      ctx.clearRect(0, 0, w, h);

      // Copper bars
      const bars = 6;
      for (let i = 0; i < bars; i++) {
        const yBase = ((i / bars) * h + (Math.sin(dt * 0.7 + i) * 0.15 + 0.35) * h) % h;
        const barH = Math.max(14, h * 0.08);
        const grad = ctx.createLinearGradient(0, yBase - barH / 2, 0, yBase + barH / 2);
        grad.addColorStop(0.0, "rgba(0, 255, 166, 0.00)");
        grad.addColorStop(0.15, "rgba(0, 255, 166, 0.25)");
        grad.addColorStop(0.5, "rgba(34, 211, 238, 0.65)");
        grad.addColorStop(0.85, "rgba(0, 255, 166, 0.25)");
        grad.addColorStop(1.0, "rgba(0, 255, 166, 0.00)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, yBase - barH / 2, w, barH);
      }

      // Sine scroller
      const baseY = Math.round(h * 0.55);
      const amp = Math.max(6, h * 0.06);
      const k = 0.02; // spatial frequency
      const speed = 70; // px/s to left
      ctx.font = `${Math.round(Math.max(18, h * 0.18))}px VT323, JetBrains Mono, ui-monospace, monospace`;
      ctx.textBaseline = "middle";
      ctx.globalCompositeOperation = "lighter";

      // Repeat the string to fill wide screens
      const metrics = ctx.measureText(text);
      const stride = Math.max(40, metrics.width);
      const offset = -((dt * speed) % stride);
      for (let x = offset - stride * 2; x < w + stride * 2; x += stride) {
        // Draw per-character to apply per-x sine offset
        let xCursor = x;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          const y = baseY + Math.sin((xCursor + i * 12) * k + dt * 2.2) * amp;
          // Glow via shadow
          ctx.shadowColor = "rgba(34, 211, 238, 0.65)";
          ctx.shadowBlur = 8;
          ctx.fillStyle = "rgba(209, 247, 214, 0.95)"; // phosphor
          ctx.fillText(ch, xCursor, y);
          const adv = ctx.measureText(ch).width || 12;
          xCursor += adv;
        }
      }
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = "source-over";

      if (!reduce) requestAnimationFrame(render);
    };
    requestAnimationFrame(render);

    return () => {
      running = false;
      ro.disconnect();
    };
  }, [reduce]);

  return <canvas ref={canvasRef} className="scroller-layer" aria-hidden data-section={Sections.COPPER_SCROLLER} />;
}
