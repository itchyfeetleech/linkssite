"use client";

import { useEffect, useRef } from "react";
import { Sections } from "@/lib/sections";

export default function ClientEffects() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cursorElRef = useRef<HTMLDivElement | null>(null);
  const cursorPosRef = useRef<{ x: number; y: number; inside: boolean }>({ x: 0, y: 0, inside: false });

  useEffect(() => {
    // WebGL background
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl");
    if (!canvas || !gl) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    const vertSrc = `
      attribute vec2 position;
      void main(){ gl_Position = vec4(position, 0.0, 1.0); }
    `;
    const fragSrc = `
      precision mediump float;
      uniform vec2 u_res;
      uniform float u_time;
      uniform vec2 u_cursor;   // cursor in pixels
      uniform float u_cursor_on; // 0 or 1
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        float a = hash(i);
        float b = hash(i + vec2(1.0,0.0));
        float c = hash(i + vec2(0.0,1.0));
        float d = hash(i + vec2(1.0,1.0));
        vec2 u = f*f*(3.0-2.0*f);
        return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
      }
      vec2 lensWarp(vec2 uv, vec2 center, float radius, float strength) {
        // Pull uv slightly toward center with smooth falloff inside radius
        vec2 d = uv - center;
        float dist = length(d);
        if (dist > radius || radius <= 0.0) return uv;
        float fall = 1.0 - clamp(dist / radius, 0.0, 1.0);
        float k = strength * fall * fall; // stronger at center
        return uv - d * k;
      }
      void main(){
        vec2 uv = gl_FragCoord.xy / u_res.xy;
        // Cursor-driven micro lens warp (CRT "gravity")
        if (u_cursor_on > 0.5) {
          vec2 c = u_cursor / u_res; // normalized
          float rad = 120.0 / min(u_res.x, u_res.y); // ~120px radius
          uv = lensWarp(uv, c, rad, 0.08);
        }
        // Solid near-black base with very subtle monochrome grain
        float n = noise(uv*160.0 + u_time*0.05);
        float grain = (n - 0.5) * 0.02; // +/-1% around black
        float v = clamp(grain, 0.0, 1.0);
        gl_FragColor = vec4(vec3(v), 1.0);
      }
    `;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("Shader compile error:", gl.getShaderInfoLog(sh));
      }
      return sh;
    };

    const vs = compile(gl.VERTEX_SHADER, vertSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const posLoc = gl.getAttribLocation(prog, "position");
    const timeLoc = gl.getUniformLocation(prog, "u_time");
    const resLoc = gl.getUniformLocation(prog, "u_res");
    const cursorLoc = gl.getUniformLocation(prog, "u_cursor");
    const cursorOnLoc = gl.getUniformLocation(prog, "u_cursor_on");

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    window.addEventListener("resize", resize);
    resize();

    let rafId = 0;
    const render = (t: number) => {
      if (timeLoc) gl.uniform1f(timeLoc, t * 0.001);
      if (resLoc) gl.uniform2f(resLoc, canvas.width, canvas.height);
      // Update cursor uniforms
      const { x, y, inside } = cursorPosRef.current;
      if (cursorLoc) gl.uniform2f(cursorLoc, x, canvas.height - y); // flip Y to GL coords
      if (cursorOnLoc) gl.uniform1f(cursorOnLoc, inside ? 1.0 : 0.0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!reduce) rafId = requestAnimationFrame(render);
    };
    // Draw one frame if reduced motion, else animate
    if (reduce) {
      render(performance.now());
    } else {
      rafId = requestAnimationFrame(render);
    }

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  useEffect(() => {
    // Cursor overlay and tilt interactions
    const scene = document.getElementById("crt-scene");
    const canvas = canvasRef.current;
    const cursorEl = cursorElRef.current;
    if (!scene || !canvas || !cursorEl) return;

    const show = () => {
      scene.classList.add("hover-cursor");
      cursorEl.style.opacity = scene.classList.contains("cursor-native") ? "0" : "1";
    };
    const hide = () => {
      scene.classList.remove("hover-cursor");
      cursorEl.style.opacity = "0";
      cursorPosRef.current.inside = false;
    };

    // Coalesce mousemove -> single rAF style write
    let cursorRaf: number | null = null;
    const flushCursor = () => {
      cursorRaf = null;
      const { x, y, inside } = cursorPosRef.current;
      if (inside) {
        cursorEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
        show();
      } else {
        hide();
      }
    };
    const scheduleCursor = () => {
      if (cursorRaf) return;
      cursorRaf = requestAnimationFrame(flushCursor);
    };
    const updateCursor = (e: MouseEvent) => {
      const r = scene.getBoundingClientRect();
      const x = e.clientX;
      const y = e.clientY;
      const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      cursorPosRef.current = { x, y, inside };
      scheduleCursor();
    };

    window.addEventListener("mousemove", updateCursor);
    document.addEventListener("pointerleave", hide);
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", hide);

    const links = document.querySelectorAll<HTMLElement>(".nfo-item a");
    const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
    const cbs: Array<() => void> = [];
    links.forEach((el) => {
      let raf = 0 as number | null;
      const onMove = (e: MouseEvent) => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        const rotY = clamp((px - 0.5) * 8, -8, 8);
        const rotX = clamp((0.5 - py) * 6, -6, 6);
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          el.style.setProperty("--tiltX", rotX.toFixed(2) + "deg");
          el.style.setProperty("--tiltY", rotY.toFixed(2) + "deg");
        });
      };
      const reset: EventListener = () => {
        if (raf) cancelAnimationFrame(raf);
        el.style.setProperty("--tiltX", "0deg");
        el.style.setProperty("--tiltY", "0deg");
      };
      el.addEventListener("mousemove", onMove);
      el.addEventListener("mouseleave", reset);
      el.addEventListener("touchstart", reset, { passive: true });
      el.addEventListener("touchend", reset, { passive: true });
      cbs.push(() => {
        el.removeEventListener("mousemove", onMove as EventListener);
        el.removeEventListener("mouseleave", reset);
        el.removeEventListener("touchstart", reset);
        el.removeEventListener("touchend", reset);
      });
    });
    return () => {
      if (cursorRaf) cancelAnimationFrame(cursorRaf);
      window.removeEventListener("mousemove", updateCursor);
      document.removeEventListener("pointerleave", hide);
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", hide);
      cbs.forEach((fn) => fn());
    };
  }, []);

  return (
    <>
      {/* BACKGROUND_CANVAS + FOG_OVERLAY */}
      <canvas ref={canvasRef} id="bgCanvas" className="bg webgl" data-section={Sections.BACKGROUND_CANVAS} />
      <div id="fogOverlay" className="bg fog" data-section={Sections.FOG_OVERLAY} />
      {/* Custom CRT cursor overlay (ring) */}
      <div ref={cursorElRef} className="crt-cursor" aria-hidden data-ignore-snapshot />
    </>
  );
}
