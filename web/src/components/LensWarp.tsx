"use client";

import { useEffect, useRef } from "react";
import { Sections } from "@/lib/sections";
import * as htmlToImage from "html-to-image";

// External control: update CRT micro-effects strength and mains Hz
export function setCRTAlive(alive: number, mainsHz?: number) {
  const a = Math.max(0, Math.min(1, alive));
  window.dispatchEvent(
    new CustomEvent("crt-alive", { detail: { alive: a, mainsHz } })
  );
}

type Props = {
  // Optional: tweak curvature
  k1?: number; // primary distortion coefficient
  k2?: number; // secondary term
  center?: { x: number; y: number }; // normalized center, default 0.5,0.5
};

type AnisoExt = {
  TEXTURE_MAX_ANISOTROPY_EXT: number;
  MAX_TEXTURE_MAX_ANISOTROPY_EXT: number;
};

export default function LensWarp({ k1 = 0.012, k2 = 0.002, center = { x: 0.5, y: 0.5 } }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const texRef = useRef<WebGLTexture | null>(null);
  const progRef = useRef<WebGLProgram | null>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const reduceRef = useRef<boolean>(false);
  const dprRef = useRef<number>(1);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<number | null>(null);
  const lastCaptureAtRef = useRef<number>(0);
  const announcedReadyRef = useRef<boolean>(false);
  // Live micro-effects controls
  const aliveRef = useRef<number>(0); // 0..1; default static
  const mainsHzRef = useRef<number>(60);
  // Performance gating
  const gateRef = useRef<boolean>(false);
  const fpsEMARef = useRef<number>(60);
  const lastRenderAtRef = useRef<number>(performance.now());
  const belowSinceRef = useRef<number | null>(null);
  const aboveSinceRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    reduceRef.current = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

    // Guess mains Hz by locale/timezone (coarse)
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      if (/^(Europe|Africa|Australia|Indian|Pacific)/i.test(tz)) {
        mainsHzRef.current = 50;
      } else {
        mainsHzRef.current = 60;
      }
    } catch {}

    // Listen for external control of alive/mainsHz
    const onAlive = (ev: Event) => {
      const e = ev as CustomEvent<{ alive?: number; mainsHz?: number }>;
      if (typeof e.detail?.alive === "number") {
        aliveRef.current = Math.max(0, Math.min(1, e.detail.alive));
      }
      if (typeof e.detail?.mainsHz === "number") {
        mainsHzRef.current = e.detail.mainsHz;
      }
    };
    window.addEventListener("crt-alive", onAlive);

    // The lens covers the parent `.screen` container
    const container = canvas.parentElement as HTMLElement | null;
    if (!container) return;

    // Setup GL
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true });
    if (!gl) return;
    glRef.current = gl;

    const vertSrc = `
      attribute vec2 position;
      varying vec2 vUv;
      void main(){
        vUv = (position + 1.0) * 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;
    const fragSrc = `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D u_tex;
      uniform vec2 u_res;
      uniform vec2 u_center;
      uniform float u_k1;
      uniform float u_k2;
      uniform float u_time;  // seconds
      uniform float u_alive; // 0..1 micro-effects strength
      uniform float u_mainsHz; // 50 or 60
      uniform float u_motion; // 0 = reduced, 1 = animate
      uniform float u_intensity; // global strength
      
      // Small hash for phase noise
      float hash1(float x){ return fract(sin(x*127.1) * 43758.5453123); }
      // Distort coordinates using Brown-Conrady barrel model
      vec2 barrel(vec2 uv, float k1, float k2){
        vec2 p = (uv - u_center) * 2.0; // roughly [-1,1]
        // normalize to aspect so distortion is radially symmetric
        float aspect = u_res.x / u_res.y;
        p.x *= aspect;
        float r2 = dot(p, p);
        float f = 1.0 + k1 * r2 + k2 * r2 * r2;
        p *= f;
        p.x /= aspect;
        return u_center + p * 0.5;
      }
      void main(){
        // Slight chromatic aberration: offset R/B samples inwards/outwards
        float dr = 0.0002 * u_intensity; // very subtle for readability
        vec2 baseUv = vUv; // texture already flipped via UNPACK_FLIP_Y_WEBGL
        vec2 uvR = barrel(baseUv + vec2( dr, 0.0), u_k1, u_k2);
        vec2 uvG = barrel(baseUv,                  u_k1, u_k2);
        vec2 uvB = barrel(baseUv + vec2(-dr, 0.0), u_k1, u_k2);
        
        // Time-based micro-effects (horizontal)
        float phase = 6.2831853 * u_mainsHz * u_time;
        float line = gl_FragCoord.y;
        // Effect 1: mains-rate beam jitter
        float jitter = (0.25 / u_res.x) * sin(phase + line * 0.015) * u_alive;
        // Effect 2: scanline phase noise (slow drift + tiny hashed jitter)
        float drift = sin(phase * 0.07 + line * 0.011) * (0.15 / u_res.x) * u_alive;
        float t2 = floor(u_time * 2.0);
        float n = hash1(line + t2 * 31.7);
        drift += (n - 0.5) * (0.05 / u_res.x) * u_alive; // ≤ 0.05px extra
        float dX = clamp(jitter + drift, -0.4 / u_res.x, 0.4 / u_res.x);
        uvR.x += dX; uvG.x += dX; uvB.x += dX;
        // Clamp to avoid wrapping
        uvR = clamp(uvR, vec2(0.0), vec2(1.0));
        uvG = clamp(uvG, vec2(0.0), vec2(1.0));
        uvB = clamp(uvB, vec2(0.0), vec2(1.0));
        vec3 col;
        col.r = texture2D(u_tex, uvR).r;
        col.g = texture2D(u_tex, uvG).g;
        col.b = texture2D(u_tex, uvB).b;

        // Effect 3: triad shimmer (mix at low weight)
        if (u_alive > 0.0005) {
          float triad = fract((uvG.x * u_res.x) / 3.0);
          float sPx = 0.002 * sin(phase * 0.5 + triad * 6.2831853) * u_alive; // very subtle
          float px = 1.0 / u_res.x;
          float rShift = (sPx + 0.15) * px;
          float bShift = -(sPx + 0.15) * px;
          vec3 triadCol;
          triadCol.r = texture2D(u_tex, clamp(uvG + vec2(rShift, 0.0), vec2(0.0), vec2(1.0))).r;
          triadCol.g = col.g;
          triadCol.b = texture2D(u_tex, clamp(uvG + vec2(bShift, 0.0), vec2(0.0), vec2(1.0))).b;
          float w = 0.20 * u_alive; // keep luminance modulation small
          col = mix(col, triadCol, w);
        }

        // CRT effects in shader (subtle by default)
        float I = u_intensity; // shorthand

        // Scanlines (horizontal darkening)
        float pxY = uvG.y * u_res.y;
        float scan = 0.5 + 0.5 * cos(6.28318 * (pxY / 3.0)); // 3px period
        float scanAmp = 0.06 * I;
        col *= mix(1.0 - scanAmp, 1.0, scan);

        // Aperture grille (vertical faint dark stripes)
        float pxX = uvG.x * u_res.x;
        float grille = 0.5 + 0.5 * cos(6.28318 * (pxX / 3.0));
        float grilleAmp = 0.04 * I;
        col *= mix(1.0 - grilleAmp, 1.0, grille);

        // Rolling band (very subtle, moves only if motion enabled)
        float bandAmp = 0.04 * I;
        float pos = fract(uvG.y + (u_motion * u_time * 0.03));
        float band = smoothstep(0.45, 0.5, pos) * smoothstep(0.55, 0.5, pos);
        col *= 1.0 + bandAmp * band;

        // Vignette / edge falloff
        vec2 c = (uvG - u_center) * vec2(u_res.x / u_res.y, 1.0);
        float r = length(c);
        float vig = smoothstep(0.9, 0.2, r); // 1 center -> 0 edges
        float vigAmp = 0.06 * I;
        col *= mix(1.0 - vigAmp, 1.0, vig);

        // Refresh flicker (tiny amplitude)
        float flick = 1.0 + (0.02 * I) * (u_motion * (sin(u_time*8.0) * 0.5));
        col *= flick;

        // Mild unsharp mask to restore crisp glyph edges
        vec2 texel = 1.0 / u_res;
        vec3 c0 = texture2D(u_tex, uvG).rgb;
        vec3 c1 = texture2D(u_tex, clamp(uvG + vec2(texel.x, 0.0), vec2(0.0), vec2(1.0))).rgb;
        vec3 c2 = texture2D(u_tex, clamp(uvG + vec2(-texel.x, 0.0), vec2(0.0), vec2(1.0))).rgb;
        vec3 c3 = texture2D(u_tex, clamp(uvG + vec2(0.0, texel.y), vec2(0.0), vec2(1.0))).rgb;
        vec3 c4 = texture2D(u_tex, clamp(uvG + vec2(0.0, -texel.y), vec2(0.0), vec2(1.0))).rgb;
        vec3 blur = (c0 + c1 + c2 + c3 + c4) * 0.2;
        float sharpen = 0.10; // keep subtle to avoid halos
        col = clamp(col * (1.0 + sharpen) - blur * sharpen, 0.0, 1.0);

        gl_FragColor = vec4(col, 1.0);
      }
    `;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("Lens shader compile error:", gl.getShaderInfoLog(sh));
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, vertSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("Lens program link error:", gl.getProgramInfoLog(prog));
      return;
    }
    progRef.current = prog;
    gl.useProgram(prog);

    // Quad buffer
    const posLoc = gl.getAttribLocation(prog, "position");
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Uniforms
    const resLoc = gl.getUniformLocation(prog, "u_res");
    const texLoc = gl.getUniformLocation(prog, "u_tex");
    const k1Loc = gl.getUniformLocation(prog, "u_k1");
    const k2Loc = gl.getUniformLocation(prog, "u_k2");
    const ctrLoc = gl.getUniformLocation(prog, "u_center");
    const timeLoc = gl.getUniformLocation(prog, "u_time");
    const aliveLoc = gl.getUniformLocation(prog, "u_alive");
    const mainsLoc = gl.getUniformLocation(prog, "u_mainsHz");
    const motionLoc = gl.getUniformLocation(prog, "u_motion");
    const intensityLoc = gl.getUniformLocation(prog, "u_intensity");
    if (texLoc) gl.uniform1i(texLoc, 0);
    if (k1Loc) gl.uniform1f(k1Loc, k1);
    if (k2Loc) gl.uniform1f(k2Loc, k2);
    if (ctrLoc) gl.uniform2f(ctrLoc, center.x, center.y);
    if (motionLoc) gl.uniform1f(motionLoc, reduceRef.current ? 0.0 : 1.0);
    const cssIntensity = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--crt-intensity")) || 0.1;
    if (intensityLoc) gl.uniform1f(intensityLoc, cssIntensity);
    if (aliveLoc) gl.uniform1f(aliveLoc, 0.0);
    if (mainsLoc) gl.uniform1f(mainsLoc, mainsHzRef.current || 60);

    // Texture
    const tex = gl.createTexture();
    texRef.current = tex;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // Ensure uploaded image matches DOM orientation
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Enable anisotropic filtering if available for better angled sampling
    const aniso = (gl.getExtension('EXT_texture_filter_anisotropic') ||
                  gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
                  gl.getExtension('MOZ_EXT_texture_filter_anisotropic')) as unknown as AnisoExt | null;
    if (aniso) {
      const maxAniso = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 4;
      gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, maxAniso));
    }

    // Render pass
    const render = () => {
      if (!prog || !gl) return;
      const now = performance.now();
      // Time uniform (seconds)
      if (timeLoc) gl.uniform1f(timeLoc, now * 0.001);
      // FPS monitor for auto-gate
      const dt = Math.max(0.0001, (now - lastRenderAtRef.current) * 0.001);
      lastRenderAtRef.current = now;
      const fps = 1.0 / dt;
      fpsEMARef.current = fpsEMARef.current * 0.9 + fps * 0.1;
      if (fpsEMARef.current < 30) {
        if (belowSinceRef.current == null) belowSinceRef.current = now;
        if (!gateRef.current && belowSinceRef.current && now - belowSinceRef.current > 3000) {
          gateRef.current = true;
        }
      } else {
        belowSinceRef.current = null;
        if (gateRef.current) {
          // Require ~1.5s of good FPS to lift gate
          if (aboveSinceRef.current == null) aboveSinceRef.current = now;
          if (now - aboveSinceRef.current > 1500) gateRef.current = false;
        } else {
          aboveSinceRef.current = null;
        }
      }
      const requested = reduceRef.current ? 0 : aliveRef.current;
      const effectiveAlive = Math.min(requested, gateRef.current ? 0.3 : 1.0);
      if (aliveLoc) gl.uniform1f(aliveLoc, effectiveAlive);
      if (mainsLoc) gl.uniform1f(mainsLoc, mainsHzRef.current || 60);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!reduceRef.current) {
        rafRef.current = requestAnimationFrame(render);
      }
    };

    // Snapshot underlying container into texture
    let capturing = false;
    const capture = async () => {
      if (capturing) return;
      capturing = true;
      // Do not toggle visibility; we already exclude the warp canvas in html-to-image filter
      try {
        const dataUrl = await htmlToImage.toPng(container, {
          pixelRatio: dprRef.current,
          cacheBust: true,
          filter: (node) => {
            if (!(node instanceof Element)) return true;
            if (node === canvas) return false;
            return !node.classList.contains("lens-warp");
          },
        });
        const img = new Image();
        img.onload = () => {
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          render();
          // Announce the very first successful WebGL draw so we can reveal the UI
          if (!announcedReadyRef.current) {
            announcedReadyRef.current = true;
            // ensure the draw hit the screen first
            requestAnimationFrame(() => {
              window.dispatchEvent(new Event("webgl-ready"));
            });
          }
        };
        img.src = dataUrl;
      } catch (e) {
        console.warn("Lens capture failed", e);
      } finally {
        lastCaptureAtRef.current = performance.now();
        capturing = false;
      }
    };

    const scheduleCapture = () => {
      if (pendingRef.current) return;
      // throttle if we captured very recently
      const since = performance.now() - lastCaptureAtRef.current;
      const delay = Math.max(200, 200 - since);
      pendingRef.current = window.setTimeout(() => {
        pendingRef.current = null;
        capture();
      }, delay);
    };

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 2), 2.5);
      dprRef.current = dpr;
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (resLoc) gl.uniform2f(resLoc, canvas.width, canvas.height);
      scheduleCapture();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    // Observe DOM changes inside `.screen`
    const mo = new MutationObserver((list) => {
      // Ignore mutations originating from the lens canvas
      for (const m of list) {
        const t = m.target as Element;
        if (t && t instanceof Element && t.classList.contains("lens-warp")) continue;
        scheduleCapture();
        break;
      }
    });
    mo.observe(container, { subtree: true, childList: true, characterData: true, attributes: false });
    window.addEventListener("resize", scheduleCapture);
    window.addEventListener("ascii-ready", capture);

    // Initial capture now triggered via 'ascii-ready' event

    return () => {
      window.removeEventListener("crt-alive", onAlive);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", scheduleCapture);
      window.removeEventListener("ascii-ready", capture);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (gl && texRef.current) gl.deleteTexture(texRef.current);
      if (gl && progRef.current) gl.deleteProgram(progRef.current);
    };
  }, [k1, k2, center.x, center.y]);

  return <canvas ref={canvasRef} className="lens-warp" aria-hidden data-ignore-snapshot data-section={Sections.LENS_WARP_CANVAS} />;
}
