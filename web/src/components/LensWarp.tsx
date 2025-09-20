"use client";

import { useCallback, useEffect, useRef } from "react";
import { Sections } from "@/lib/sections";
import * as htmlToImage from "html-to-image";

const DEFAULT_K1 = -0.006;
const DEFAULT_K2 = 0.0;
const SLIDER_K1 = -0.012;
const SLIDER_K2 = 0.004;
const MAX_ABS_K1 = 0.02;
const MAX_ABS_K2 = 0.005;
const WARP_EVENT = "crt-warp";

type Vec2 = { x: number; y: number };

type WarpCoefficients = { k1: number; k2: number };

type WarpEventDetail = {
  slider?: number;
  k1?: number;
  k2?: number;
  enabled?: boolean;
  showGrid?: boolean;
};

type WarpState = {
  current: WarpCoefficients;
  desired: WarpCoefficients;
  slider: number | null;
  enabled: boolean;
  clampLogged: boolean;
  showGrid: boolean;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const sanitizeWarpCoefficients = (k1: number, k2: number) => {
  const safeK1 = Number.isFinite(k1) ? k1 : 0;
  const safeK2 = Number.isFinite(k2) ? k2 : 0;
  if (Math.abs(safeK1) > MAX_ABS_K1 || Math.abs(safeK2) > MAX_ABS_K2) {
    return { values: { k1: 0, k2: 0 }, clamped: true } as const;
  }
  return { values: { k1: safeK1, k2: safeK2 }, clamped: false } as const;
};

const sliderToWarp = (slider: number): WarpCoefficients => ({
  k1: SLIDER_K1 * slider,
  k2: SLIDER_K2 * slider,
});

const safeAspectPx = (width: number, height: number) =>
  height > 0 ? width / height : 1;

const undistortPoint = (p: Vec2, coeffs: WarpCoefficients): Vec2 => {
  let ux = p.x;
  let uy = p.y;
  for (let i = 0; i < 3; i += 1) {
    const r2 = ux * ux + uy * uy;
    const f = Math.max(1e-3, 1 + coeffs.k1 * r2 + coeffs.k2 * r2 * r2);
    ux = p.x / f;
    uy = p.y / f;
  }
  return { x: ux, y: uy };
};

const lensSample = (
  uv: Vec2,
  center: Vec2,
  aspect: number,
  coeffs: WarpCoefficients
): Vec2 => {
  const px = (uv.x - center.x) * 2.0;
  const py = (uv.y - center.y) * 2.0;
  const scaled: Vec2 = { x: px * aspect, y: py };
  const undistorted = undistortPoint(scaled, coeffs);
  return {
    x: center.x + (undistorted.x / aspect) * 0.5,
    y: center.y + undistorted.y * 0.5,
  };
};

const dispatchWarpEvent = (detail: WarpEventDetail) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WARP_EVENT, { detail }));
};

export const setCRTWarpSlider = (slider: number) => {
  dispatchWarpEvent({ slider });
};

export const setCRTWarpEnabled = (enabled: boolean) => {
  dispatchWarpEvent({ enabled });
};

export const setCRTWarpGrid = (show: boolean) => {
  dispatchWarpEvent({ showGrid: show });
};

// External control: update CRT micro-effects strength and mains Hz
export function setCRTAlive(alive: number, mainsHz?: number) {
  const a = Math.max(0, Math.min(1, alive));
  window.dispatchEvent(
    new CustomEvent("crt-alive", { detail: { alive: a, mainsHz } })
  );
}

// External control: update phosphor decay (ms) and halo gain
export function setPhosphor(opts: { rMs?: number; gMs?: number; bMs?: number; halo?: number }) {
  window.dispatchEvent(new CustomEvent("crt-phosphor", { detail: opts }));
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

export default function LensWarp({ k1 = DEFAULT_K1, k2 = DEFAULT_K2, center = { x: 0.5, y: 0.5 } }: Props) {
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
  const aliveRef = useRef<number>(1.0); // default micro-effects strength
  const mainsHzRef = useRef<number>(5); // default mains (Hz)
  const interactingRef = useRef<boolean>(false);
  const debugRef = useRef<boolean>(false);
  const roCountRef = useRef<number>(0);
  const moCountRef = useRef<number>(0);
  // Performance gating
  const gateRef = useRef<boolean>(false);
  const fpsEMARef = useRef<number>(60);
  const lastRenderAtRef = useRef<number>(performance.now());
  const belowSinceRef = useRef<number | null>(null);
  const aboveSinceRef = useRef<number | null>(null);
  const lastStateEmitRef = useRef<number>(0);
  const decayMsRef = useRef<{ r: number; g: number; b: number }>({ r: 12.0, g: 14.0, b: 10.0 });
  const haloRef = useRef<number>(0.6);
  // Beam/scanline controls (HQ only)
  const beamOnRef = useRef<boolean>(true);
  const beamPxRef = useRef<number>(6.0);
  const beamModDepthRef = useRef<number>(1.0);
  const beamInterlaceRef = useRef<boolean>(false);
  const initialWarp = sanitizeWarpCoefficients(k1, k2);
  const warpStateRef = useRef<WarpState>({
    current: { ...initialWarp.values },
    desired: { ...initialWarp.values },
    slider: null,
    enabled: !(initialWarp.values.k1 === 0 && initialWarp.values.k2 === 0),
    clampLogged: initialWarp.clamped,
    showGrid: false,
  });
  const showGridExplicitRef = useRef<boolean | null>(null);
  const lastDiagAtRef = useRef<number>(0);
  const pointerDispatchingRef = useRef<Set<number>>(new Set());
  const mouseDispatchingRef = useRef<boolean>(false);
  const wheelDispatchingRef = useRef<boolean>(false);
  const centerRef = useRef(center);
  centerRef.current = center;

  const updateDesiredWarp = useCallback(
    (
      nextK1: number,
      nextK2: number,
      opts?: { allowClampLog?: boolean }
    ) => {
      const sanitized = sanitizeWarpCoefficients(nextK1, nextK2);
      warpStateRef.current.desired = { ...sanitized.values };
      if (warpStateRef.current.enabled) {
        warpStateRef.current.current = { ...sanitized.values };
      }
      if (sanitized.clamped) {
        if (opts?.allowClampLog !== false && !warpStateRef.current.clampLogged) {
          try {
            console.warn("clamped", { k1: nextK1, k2: nextK2 });
          } catch {}
          warpStateRef.current.clampLogged = true;
        }
      } else {
        warpStateRef.current.clampLogged = false;
      }
    },
    [warpStateRef]
  );

  const setWarpEnabled = useCallback(
    (enabled: boolean) => {
      if (warpStateRef.current.enabled === enabled) return;
      warpStateRef.current.enabled = enabled;
      warpStateRef.current.current = enabled
        ? { ...warpStateRef.current.desired }
        : { k1: 0, k2: 0 };
    },
    [warpStateRef]
  );

  const applyWarpSlider = useCallback(
    (slider: number) => {
      const clampedSlider = clamp01(slider);
      warpStateRef.current.slider = clampedSlider;
      const coeffs = sliderToWarp(clampedSlider);
      updateDesiredWarp(coeffs.k1, coeffs.k2, { allowClampLog: true });
    },
    [updateDesiredWarp, warpStateRef]
  );

  const maybeLogWarpDiagnostics = (width: number, height: number) => {
    if (!debugRef.current) return;
    const now = performance.now();
    if (now - lastDiagAtRef.current < 1000) return;
    lastDiagAtRef.current = now;
    const aspect = safeAspectPx(width, height);
    const warp = warpStateRef.current.enabled
      ? warpStateRef.current.current
      : ({ k1: 0, k2: 0 } as WarpCoefficients);
    const c = centerRef.current;
    const pts = [0.0, 0.5, 1.0];
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const py of pts) {
      for (const px of pts) {
        const sample = lensSample({ x: px, y: py }, c, aspect, warp);
        if (sample.x < minX) minX = sample.x;
        if (sample.x > maxX) maxX = sample.x;
        if (sample.y < minY) minY = sample.y;
        if (sample.y > maxY) maxY = sample.y;
      }
    }
    const rounded = {
      minX: Number(minX.toFixed(4)),
      maxX: Number(maxX.toFixed(4)),
      minY: Number(minY.toFixed(4)),
      maxY: Number(maxY.toFixed(4)),
    };
    const minBound = -0.02;
    const maxBound = 1.02;
    const within =
      rounded.minX >= minBound &&
      rounded.maxX <= maxBound &&
      rounded.minY >= minBound &&
      rounded.maxY <= maxBound;
    try {
      console.log("[CRT] warp uvSample diag", { ...rounded, within });
      if (!within) {
        console.warn("[CRT] warp uvSample out of range", {
          ...rounded,
          minBound,
          maxBound,
        });
      }
    } catch {}
  };

  useEffect(() => {
    const onWarp = (ev: Event) => {
      const detail = (ev as CustomEvent<WarpEventDetail>).detail;
      if (!detail) return;
      if (typeof detail.slider === "number") {
        applyWarpSlider(detail.slider);
      }
      if (typeof detail.k1 === "number" || typeof detail.k2 === "number") {
        const nextK1 = typeof detail.k1 === "number" ? detail.k1 : warpStateRef.current.desired.k1;
        const nextK2 = typeof detail.k2 === "number" ? detail.k2 : warpStateRef.current.desired.k2;
        warpStateRef.current.slider = null;
        updateDesiredWarp(nextK1, nextK2, { allowClampLog: true });
      }
      if (typeof detail.showGrid === "boolean") {
        showGridExplicitRef.current = detail.showGrid;
        warpStateRef.current.showGrid = detail.showGrid;
      }
      if (typeof detail.enabled === "boolean") {
        setWarpEnabled(detail.enabled);
      }
    };
    window.addEventListener(WARP_EVENT, onWarp as EventListener);
    return () => window.removeEventListener(WARP_EVENT, onWarp as EventListener);
  }, [applyWarpSlider, setWarpEnabled, updateDesiredWarp]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    reduceRef.current = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

    // Guard against context loss causing a black full-screen overlay.
    const onContextLost = (e: Event) => {
      e.preventDefault?.();
      // Hide the lens so the raw DOM remains visible
      (e.currentTarget as HTMLCanvasElement).style.opacity = "0";
    };
    const onContextRestored = () => {
      // Easiest reliable recovery: reload and let the pipeline re-init
      try { location.reload(); } catch {}
    };
    canvas.addEventListener("webglcontextlost", onContextLost as EventListener, { passive: false } as AddEventListenerOptions);
    canvas.addEventListener("webglcontextrestored", onContextRestored as EventListener);

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
    // Debug toggle via ?debug=1 or localStorage['crt-debug'] or event 'crt-debug'
    try {
      const url = new URL(window.location.href);
      const dbg = url.searchParams.get("debug");
      const ls = localStorage.getItem("crt-debug");
      debugRef.current = (dbg === "1" || dbg?.toLowerCase() === "true" || ls === "1");
      if (showGridExplicitRef.current === null) {
        warpStateRef.current.showGrid = debugRef.current;
      }
    } catch {}
    const onDebug = (ev: Event) => {
      const e = ev as CustomEvent<{ debug?: boolean; persist?: boolean }>;
      if (typeof e.detail?.debug === "boolean") {
        debugRef.current = e.detail.debug;
        if (e.detail.persist) {
          try { localStorage.setItem("crt-debug", debugRef.current ? "1" : "0"); } catch {}
        }
        if (showGridExplicitRef.current === null) {
          warpStateRef.current.showGrid = debugRef.current;
        }
      }
    };
    window.addEventListener("crt-debug", onDebug as EventListener);

    window.addEventListener("crt-alive", onAlive);
    const onInteract = (ev: Event) => {
      const e = ev as CustomEvent<{ active?: boolean }>;
      const was = interactingRef.current;
      interactingRef.current = !!e.detail?.active;
      if (debugRef.current) { try { console.log("[CRT] interact:", interactingRef.current ? "start" : "end"); } catch {} }
      if (was && !interactingRef.current) {
        try { scheduleCapture(); } catch {}
      }
    };
    window.addEventListener("crt-interact", onInteract as EventListener);

    // The lens covers the parent `.screen` container
    const container = canvas.parentElement as HTMLElement | null;
    if (!container) return;

    // Mode override via query or localStorage: crt=HQ|LQ or localStorage['crt-mode']
    let forceMode: "HQ" | "LQ" | null = null;
    try {
      const url = new URL(window.location.href);
      const p = url.searchParams.get("crt");
      if (p) {
        const pm = p.toUpperCase();
        if (pm === "HQ" || pm === "LQ") forceMode = pm as "HQ" | "LQ";
      }
      if (!forceMode) {
        const s = localStorage.getItem("crt-mode");
        if (s) {
          const sm = s.toUpperCase();
          if (sm === "HQ" || sm === "LQ") forceMode = sm as "HQ" | "LQ";
        }
      }
    } catch {}

    // Try HQ (WebGL2) pipeline. If initialized, skip LQ path below.
    const tryInitHQ = () => {
      const gl2 = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true }) as WebGL2RenderingContext | null;
      if (!gl2) return false;

      // Listen for phosphor/halo updates
      const onPhosphor = (ev: Event) => {
        const e = ev as CustomEvent<{ rMs?: number; gMs?: number; bMs?: number; halo?: number }>;
        if (typeof e.detail?.rMs === "number") decayMsRef.current.r = Math.max(0.01, e.detail.rMs);
        if (typeof e.detail?.gMs === "number") decayMsRef.current.g = Math.max(0.01, e.detail.gMs);
        if (typeof e.detail?.bMs === "number") decayMsRef.current.b = Math.max(0.01, e.detail.bMs);
        if (typeof e.detail?.halo === "number") haloRef.current = Math.max(0, e.detail.halo);
      };
      window.addEventListener("crt-phosphor", onPhosphor);
      // Listen for beam controls
      const onBeam = (ev: Event) => {
        const e = ev as CustomEvent<{ on?: boolean; beamPx?: number; modDepth?: number; interlace?: boolean }>;
        if (typeof e.detail?.on === "boolean") beamOnRef.current = e.detail.on;
        if (typeof e.detail?.beamPx === "number") beamPxRef.current = Math.max(0.5, Math.min(3.0, e.detail.beamPx));
        if (typeof e.detail?.modDepth === "number") beamModDepthRef.current = Math.max(0, Math.min(0.3, e.detail.modDepth));
        if (typeof e.detail?.interlace === "boolean") beamInterlaceRef.current = e.detail.interlace;
      };
      window.addEventListener("crt-beam", onBeam);

      const extCBF = gl2.getExtension("EXT_color_buffer_float");
      const use16F = !!extCBF;

      // Quad
      const vbo = gl2.createBuffer()!;
      gl2.bindBuffer(gl2.ARRAY_BUFFER, vbo);
      gl2.bufferData(gl2.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1,  -1,1, 1,-1, 1,1]), gl2.STATIC_DRAW);

      const vsrc = `#version 300 es
precision highp float;
layout(location=0) in vec2 position;
out vec2 vUv;
void main(){
  vUv = (position + 1.0) * 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;
      const fs1 = `#version 300 es
precision highp float;
layout(location=0) out vec4 oPhi;
layout(location=1) out vec4 oBright;
in vec2 vUv;
uniform sampler2D u_tex;
uniform sampler2D u_prevPhi;
uniform sampler2D u_beamMask;
uniform vec2 u_res;
uniform vec2 u_center;
uniform float u_k1;
uniform float u_k2;
uniform float u_time;
uniform float u_dt;
uniform float u_alive;
uniform float u_mainsHz;
uniform vec3 u_decayF;
uniform float u_beamOn;
uniform float u_beamPx;
uniform float u_modDepth;
uniform float u_interlace;

float hash1(float x){ return fract(sin(x*127.1)*43758.5453123); }
float safeAspect(vec2 res){ return res.y > 0.0 ? res.x / res.y : 1.0; }
vec2 undistort(vec2 p, float k1, float k2){
  vec2 u = p;
  for(int i=0;i<3;i++){
    float r2 = dot(u,u);
    float f = max(1.0 + k1*r2 + k2*r2*r2, 1e-3);
    u = p / f;
  }
  return u;
}
vec2 lensSample(vec2 uv, vec2 center, vec2 res, float k1, float k2){
  float aspect = safeAspect(res);
  vec2 p = (uv - center) * 2.0;
  p.x *= aspect;
  vec2 u = undistort(p, k1, k2);
  u.x /= aspect;
  return center + u * 0.5;
}

void main(){
  float phase = 6.2831853 * u_mainsHz * u_time;
  float line = float(int(gl_FragCoord.y));
  float jitter = (0.25 / u_res.x) * sin(phase + line * 0.015) * u_alive;
  float drift = sin(phase * 0.07 + line * 0.011) * (0.15 / u_res.x) * u_alive;
  float t2 = floor(u_time * 2.0);
  float n = hash1(line + t2 * 31.7);
  drift += (n - 0.5) * (0.05 / u_res.x) * u_alive;
  float dX = clamp(jitter + drift, -0.4 / u_res.x, 0.4 / u_res.x);

  vec2 uvBase = vUv;
  vec2 uvR = lensSample(uvBase + vec2( 0.0002, 0.0), u_center, u_res, u_k1, u_k2);
  vec2 uvG = lensSample(uvBase,                 u_center, u_res, u_k1, u_k2);
  vec2 uvB = lensSample(uvBase + vec2(-0.0002, 0.0), u_center, u_res, u_k1, u_k2);
  uvR.x += dX;
  uvG.x += dX;
  uvB.x += dX;

  bool inR = all(greaterThanEqual(uvR, vec2(0.0))) && all(lessThanEqual(uvR, vec2(1.0)));
  bool inG = all(greaterThanEqual(uvG, vec2(0.0))) && all(lessThanEqual(uvG, vec2(1.0)));
  bool inB = all(greaterThanEqual(uvB, vec2(0.0))) && all(lessThanEqual(uvB, vec2(1.0)));

  if (!inG) {
    oPhi = vec4(0.0);
    oBright = vec4(0.0);
    return;
  }

  vec3 src = vec3(0.0);
  if (inR) src.r = texture(u_tex, uvR).r;
  if (inG) src.g = texture(u_tex, uvG).g;
  if (inB) src.b = texture(u_tex, uvB).b;
  vec3 baseLin = pow(max(src, vec3(0.0)), vec3(2.2));

  float px = uvG.x * u_res.x;
  float py = uvG.y * u_res.y;
  float sweep = fract(u_time * (u_mainsHz * 0.05));
  float py0 = sweep * u_res.y + (u_interlace > 0.5 ? 0.5 : 0.0);
  float s = fract(px / 3.0);
  float t = clamp(0.5 + (py - py0) / max(1.0, 6.0 * u_beamPx), 0.0, 1.0);
  vec3 beamRGB = texture(u_beamMask, vec2(s, t)).rgb;
  float beamW = clamp(u_beamOn * u_modDepth * max(max(beamRGB.r, beamRGB.g), beamRGB.b), 0.0, 1.0);
  baseLin *= (1.0 + u_beamOn * u_modDepth * beamRGB);
  float sigma = max(1.0, 3.0 * u_beamPx);
  float dy = py - py0;
  float beamLine = exp(-0.5 * (dy*dy) / (sigma*sigma));
  vec3 beamAdd = beamRGB * beamLine * (0.12 * u_alive) * beamW;
  float dx = abs(px - 2.0);
  float retrace = 0.03 * exp(-0.5 * (dx*dx) / (2.0*2.0));
  baseLin += retrace * u_beamOn;
  vec3 beamPersist = beamRGB * beamLine * (0.015 * u_alive) * beamW;
  vec3 prev = texture(u_prevPhi, vUv).rgb;
  vec3 decayVec = u_decayF * (1.0 - 0.35 * beamW);
  vec3 newPhi = max(baseLin + beamPersist, mix(vec3(0.0), prev * decayVec, u_alive));
  vec3 bright = max(newPhi - vec3(0.6), vec3(0.0));
  bright += beamAdd;
  oPhi = vec4(newPhi, 1.0);
  oBright = vec4(bright, 1.0);
}`;
      const fs2 = `#version 300 es
precision highp float;
out vec4 frag;
in vec2 vUv;
uniform sampler2D u_phi;
uniform sampler2D u_bright;
uniform sampler2D u_blue;
uniform sampler2D u_normal;
uniform sampler2D u_dirt;
uniform vec2 u_res;
uniform float u_alive;
uniform float u_halo;
uniform float u_time;
uniform vec2 u_center;
uniform float u_k1;
uniform float u_k2;
uniform float u_showGrid;

vec3 bloom(vec2 uv){
  vec2 px = 1.0 / u_res;
  vec3 s = vec3(0.0);
  for(int i=0;i<8;i++){
    float a = 6.2831853 * float(i) / 8.0;
    vec2 d = vec2(cos(a), sin(a));
    s += textureLod(u_bright, uv + d * px * 1.5, 1.0).rgb * 0.20;
    s += textureLod(u_bright, uv + d * px * 2.5, 2.0).rgb * 0.12;
    s += textureLod(u_bright, uv + d * px * 4.0, 3.0).rgb * 0.08;
  }
  return s;
}
float safeAspect(vec2 res){ return res.y > 0.0 ? res.x / res.y : 1.0; }
vec2 undistort(vec2 p, float k1, float k2){
  vec2 u = p;
  for(int i=0;i<3;i++){
    float r2 = dot(u,u);
    float f = max(1.0 + k1*r2 + k2*r2*r2, 1e-3);
    u = p / f;
  }
  return u;
}
vec2 lensSample(vec2 uv, vec2 center, vec2 res, float k1, float k2){
  float aspect = safeAspect(res);
  vec2 p = (uv - center) * 2.0;
  p.x *= aspect;
  vec2 u = undistort(p, k1, k2);
  u.x /= aspect;
  return center + u * 0.5;
}

void main(){
  vec3 phi = texture(u_phi, vUv).rgb;
  vec2 uvSample = lensSample(vUv, u_center, u_res, u_k1, u_k2);
  if (any(lessThan(uvSample, vec2(0.0))) || any(greaterThan(uvSample, vec2(1.0)))) {
    frag = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float dirt = texture(u_dirt, uvSample).r;
  vec3 bloomAll = bloom(vUv);
  bloomAll *= mix(1.0, dirt * 1.6, 0.6 * u_alive);
  vec3 haloText = clamp(bloomAll * (0.7 * u_alive) * u_halo, vec3(0.0), 0.06 * max(phi, vec3(0.0)) * u_alive);
  float luma = dot(phi, vec3(0.2126, 0.7152, 0.0722));
  float dark = smoothstep(0.35, 0.0, luma);
  vec3 beamGlow = min(bloomAll * (mix(0.18, 0.45, dark) * u_alive), vec3(mix(0.05, 0.12, dark)));
  vec3 colLin = phi + haloText + beamGlow;

  vec3 nrm = texture(u_normal, uvSample).xyz * 2.0 - 1.0;
  nrm = normalize(nrm * vec3(0.6, 0.6, 1.0));
  vec3 L = normalize(vec3(0.25, 0.6, 1.0));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(nrm, H), 0.0), 64.0);
  float specW = smoothstep(0.2, 0.7, luma);
  colLin += spec * (0.05 * u_alive) * specW;

  float tri = fract((uvSample.x * u_res.x) / 3.0);
  vec3 mask = normalize(vec3(
    smoothstep(0.0, 0.33, tri),
    smoothstep(0.33, 0.66, tri),
    smoothstep(0.66, 1.0, tri)
  ) + 1e-3);
  colLin *= mix(vec3(1.0), mask * 3.0, 0.03 * u_alive);

  float bn = texture(u_blue, uvSample * 8.0 + vec2(0.017 * u_time, -0.013 * u_time)).r;
  colLin *= (1.0 + (bn - 0.5) * (0.015 * u_alive));

  vec3 srgb = pow(max(colLin, vec3(0.0)), vec3(1.0 / 2.2));
  float d = texture(u_blue, uvSample * 6.0 + vec2(0.007 * u_time, 0.011 * u_time)).r;
  srgb += (d - 0.5) * (0.7 / 255.0);

  if (u_showGrid > 0.5) {
    vec2 grid = fract(uvSample * vec2(20.0, 12.0));
    vec2 gridDist = min(grid, 1.0 - grid);
    float gridLine = max(step(gridDist.x, 0.01), step(gridDist.y, 0.01));
    vec3 gridColor = vec3(0.85, 0.95, 1.0);
    srgb = mix(srgb, gridColor, gridLine * 0.35);
  }

  frag = vec4(clamp(srgb, 0.0, 1.0), 1.0);
}`;

      const compile = (type: number, src: string) => { const sh = gl2.createShader(type)!; gl2.shaderSource(sh, src); gl2.compileShader(sh); if (!gl2.getShaderParameter(sh, gl2.COMPILE_STATUS)) { console.error(gl2.getShaderInfoLog(sh)); } return sh; };
      const vs = compile(gl2.VERTEX_SHADER, vsrc);
      const ps1 = compile(gl2.FRAGMENT_SHADER, fs1);
      const ps2 = compile(gl2.FRAGMENT_SHADER, fs2);
      const prog1 = gl2.createProgram()!; gl2.attachShader(prog1, vs); gl2.attachShader(prog1, ps1); gl2.linkProgram(prog1);
      if (!gl2.getProgramParameter(prog1, gl2.LINK_STATUS)) { console.error(gl2.getProgramInfoLog(prog1)); window.removeEventListener("crt-phosphor", onPhosphor); return false; }
      const prog2 = gl2.createProgram()!; gl2.attachShader(prog2, vs); gl2.attachShader(prog2, ps2); gl2.linkProgram(prog2);
      if (!gl2.getProgramParameter(prog2, gl2.LINK_STATUS)) { console.error(gl2.getProgramInfoLog(prog2)); window.removeEventListener("crt-phosphor", onPhosphor); return false; }

      gl2.enableVertexAttribArray(0); gl2.vertexAttribPointer(0, 2, gl2.FLOAT, false, 0, 0);

      // Textures & FBOs
      const createTex = (mip: boolean) => { const t = gl2.createTexture()!; gl2.bindTexture(gl2.TEXTURE_2D, t); gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_S, gl2.CLAMP_TO_EDGE); gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_T, gl2.CLAMP_TO_EDGE); gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MIN_FILTER, mip?gl2.LINEAR_MIPMAP_LINEAR:gl2.LINEAR); gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MAG_FILTER, gl2.LINEAR); return t; };
      const phiA = createTex(false), phiB = createTex(false), brightTex = createTex(true);
      const baseTex = gl2.createTexture()!; gl2.bindTexture(gl2.TEXTURE_2D, baseTex); gl2.pixelStorei(gl2.UNPACK_FLIP_Y_WEBGL, 0); gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MIN_FILTER, gl2.LINEAR); gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MAG_FILTER, gl2.LINEAR); gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_S, gl2.CLAMP_TO_EDGE); gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_T, gl2.CLAMP_TO_EDGE);
      // Blue-noise (approx) texture
      const blueTex = gl2.createTexture()!; gl2.bindTexture(gl2.TEXTURE_2D, blueTex); { const N=128; const data=new Uint8Array(N*N); for(let y=0;y<N;y++){ for(let x=0;x<N;x++){ const j=((x*73)^(y*199))&255; const r=Math.sin((j+1)*12.9898)*43758.5453; const v=r-Math.floor(r); data[y*N+x]=Math.floor(v*255); } } gl2.texImage2D(gl2.TEXTURE_2D,0,gl2.R8,N,N,0,gl2.RED,gl2.UNSIGNED_BYTE,data);} gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MIN_FILTER, gl2.LINEAR); gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MAG_FILTER, gl2.LINEAR); gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_S, gl2.REPEAT); gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_T, gl2.REPEAT);
      // Micro-surface normal map (tile)
      const normalTex = gl2.createTexture()!; gl2.bindTexture(gl2.TEXTURE_2D, normalTex); { const S=64; const data=new Uint8Array(S*S*3); for(let y=0;y<S;y++){ for(let x=0;x<S;x++){ const i=(y*S+x)*3; const a = Math.sin((x*12.3+y*7.7))*0.5 + Math.sin((x*3.7-y*9.1))*0.5; const b = Math.cos((x*4.9+y*5.3))*0.5 + Math.cos((x*8.1-y*2.7))*0.5; const nx=Math.max(-1,Math.min(1,a*0.2)); const ny=Math.max(-1,Math.min(1,b*0.2)); const nz=Math.sqrt(Math.max(0.0,1.0-nx*nx-ny*ny)); data[i+0]=Math.floor((nx*0.5+0.5)*255); data[i+1]=Math.floor((ny*0.5+0.5)*255); data[i+2]=Math.floor((nz*0.5+0.5)*255); } } gl2.texImage2D(gl2.TEXTURE_2D,0,gl2.RGB8,S,S,0,gl2.RGB,gl2.UNSIGNED_BYTE,data);} gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MIN_FILTER, gl2.LINEAR); gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MAG_FILTER, gl2.LINEAR); gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_S, gl2.REPEAT); gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_T, gl2.REPEAT);
      // Lens dirt mask (tile)
      const dirtTex = gl2.createTexture()!; gl2.bindTexture(gl2.TEXTURE_2D, dirtTex); { const S=256; const f=new Float32Array(S*S); const add=(cx:number,cy:number,r:number,amp:number)=>{ const sig=r*0.45; const two=2.0*sig*sig; for(let y=0;y<S;y++){ for(let x=0;x<S;x++){ let dx=x-cx, dy=y-cy; if (dx> S/2) dx-=S; if (dx<-S/2) dx+=S; if (dy> S/2) dy-=S; if (dy<-S/2) dy+=S; const d=dx*dx+dy*dy; f[y*S+x]+=amp*Math.exp(-d/two); } } }; for(let i=0;i<140;i++){ add(Math.random()*S, Math.random()*S, 14+Math.random()*70, 0.08+Math.random()*0.25); } let mn=1e9,mx=-1e9; for(let i=0;i<f.length;i++){ const v=f[i]; if(v<mn) mn=v; if(v>mx) mx=v; } const data=new Uint8Array(S*S); const inv=(mx-mn)>1e-5?1.0/(mx-mn):1.0; for(let i=0;i<S*S;i++){ const v=(f[i]-mn)*inv; data[i]=Math.floor(Math.max(0,Math.min(1,v))*255); } gl2.texImage2D(gl2.TEXTURE_2D,0,gl2.R8,S,S,0,gl2.RED,gl2.UNSIGNED_BYTE,data);} gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MIN_FILTER, gl2.LINEAR); gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MAG_FILTER, gl2.LINEAR); gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_S, gl2.REPEAT); gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_T, gl2.REPEAT);
      // Beam mask 512x512 with RGB subpixel stripes and vertical Gaussian profile
      const BM=512; const beamData = new Uint8Array(BM*BM*3);
      const sigma = BM*0.10;
      for (let y=0; y<BM; y++){
        const dy = y - BM*0.5; const g = Math.exp(-0.5 * (dy*dy) / (sigma*sigma));
        for (let x=0; x<BM; x++){
          const tri = Math.floor((x*3)/BM) % 3;
          const o = (y*BM + x)*3;
          beamData[o+0] = tri===0 ? Math.min(255, Math.floor(255*g)) : 0;
          beamData[o+1] = tri===1 ? Math.min(255, Math.floor(255*g)) : 0;
          beamData[o+2] = tri===2 ? Math.min(255, Math.floor(255*g)) : 0;
        }
      }
      const beamTex = gl2.createTexture()!; gl2.bindTexture(gl2.TEXTURE_2D, beamTex);
      gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.RGB8, BM, BM, 0, gl2.RGB, gl2.UNSIGNED_BYTE, beamData);
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MIN_FILTER, gl2.LINEAR);
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MAG_FILTER, gl2.LINEAR);
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_S, gl2.REPEAT);
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_T, gl2.CLAMP_TO_EDGE);
      const fbo = gl2.createFramebuffer()!;

      let cw=1, ch=1; let readPhi = phiA, writePhi = phiB;
      const resizeTex = (t: WebGLTexture, w: number, h: number) => { gl2.bindTexture(gl2.TEXTURE_2D, t); const ifmt = use16F ? gl2.RGBA16F : gl2.RGBA8; const type = use16F ? gl2.HALF_FLOAT : gl2.UNSIGNED_BYTE; gl2.texImage2D(gl2.TEXTURE_2D, 0, ifmt, w, h, 0, gl2.RGBA, type, null); };
      const resizeAll = () => {
        const rect = container.getBoundingClientRect();
        const dpr = Math.min(Math.max(window.devicePixelRatio||1,2),2.0);
        dprRef.current=dpr;
        const w=Math.max(1,Math.floor(rect.width));
        const h=Math.max(1,Math.floor(rect.height));
        const newW = Math.floor(w*dpr);
        const newH = Math.floor(h*dpr);
        if (canvas.width !== newW || canvas.height !== newH) {
          canvas.width=newW; canvas.height=newH;
          canvas.style.width=`${w}px`; canvas.style.height=`${h}px`;
          gl2.viewport(0,0,canvas.width,canvas.height);
          cw=canvas.width; ch=canvas.height;
          resizeTex(phiA,cw,ch); resizeTex(phiB,cw,ch); resizeTex(brightTex,cw,ch);
          if (debugRef.current) { try { console.log("[CRT] resizeAll HQ:", {w:canvas.width,h:canvas.height,dpr}); } catch {} }
        } else {
          gl2.viewport(0,0,canvas.width,canvas.height);
        }
      };
      resizeAll();

      // Uniform locations
      const u1 = { tex: gl2.getUniformLocation(prog1,"u_tex"), prev: gl2.getUniformLocation(prog1,"u_prevPhi"), beamMask: gl2.getUniformLocation(prog1,"u_beamMask"), res: gl2.getUniformLocation(prog1,"u_res"), ctr: gl2.getUniformLocation(prog1,"u_center"), k1: gl2.getUniformLocation(prog1,"u_k1"), k2: gl2.getUniformLocation(prog1,"u_k2"), time: gl2.getUniformLocation(prog1,"u_time"), dt: gl2.getUniformLocation(prog1,"u_dt"), alive: gl2.getUniformLocation(prog1,"u_alive"), mains: gl2.getUniformLocation(prog1,"u_mainsHz"), decayF: gl2.getUniformLocation(prog1,"u_decayF"), beamOn: gl2.getUniformLocation(prog1,"u_beamOn"), beamPx: gl2.getUniformLocation(prog1,"u_beamPx"), modDepth: gl2.getUniformLocation(prog1,"u_modDepth"), interlace: gl2.getUniformLocation(prog1,"u_interlace") } as const;
      const u2 = { phi: gl2.getUniformLocation(prog2,"u_phi"), bright: gl2.getUniformLocation(prog2,"u_bright"), blue: gl2.getUniformLocation(prog2,"u_blue"), normal: gl2.getUniformLocation(prog2,"u_normal"), dirt: gl2.getUniformLocation(prog2,"u_dirt"), res: gl2.getUniformLocation(prog2,"u_res"), alive: gl2.getUniformLocation(prog2,"u_alive"), halo: gl2.getUniformLocation(prog2,"u_halo"), time: gl2.getUniformLocation(prog2,"u_time"), ctr: gl2.getUniformLocation(prog2,"u_center"), k1: gl2.getUniformLocation(prog2,"u_k1"), k2: gl2.getUniformLocation(prog2,"u_k2"), showGrid: gl2.getUniformLocation(prog2,"u_showGrid") } as const;

      // Render
      const render = () => {
        const now = performance.now(); const dt = Math.max(0.0001, (now - lastRenderAtRef.current) * 0.001); lastRenderAtRef.current = now; const fps = 1.0/dt; fpsEMARef.current = fpsEMARef.current*0.9 + fps*0.1;
        if (fpsEMARef.current < 30) { if (belowSinceRef.current==null) belowSinceRef.current=now; if (!gateRef.current && belowSinceRef.current && now - belowSinceRef.current > 3000) gateRef.current = true; } else { belowSinceRef.current=null; if (gateRef.current) { if (aboveSinceRef.current==null) aboveSinceRef.current=now; if (now - aboveSinceRef.current > 1500) gateRef.current=false; } else { aboveSinceRef.current=null; } }
        const requested = reduceRef.current ? 0 : aliveRef.current; const effectiveAlive = Math.min(requested, gateRef.current ? 0.3 : 1.0);
        const warpState = warpStateRef.current;
        const activeWarp = warpState.enabled ? warpState.current : ({ k1: 0, k2: 0 } as WarpCoefficients);
        const k1 = activeWarp.k1;
        const k2 = activeWarp.k2;
        const showGrid = warpState.showGrid ? 1.0 : 0.0;

        maybeLogWarpDiagnostics(cw, ch);

        // Pass 1
        gl2.useProgram(prog1);
        gl2.bindFramebuffer(gl2.FRAMEBUFFER, fbo);
        gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0, gl2.TEXTURE_2D, writePhi, 0);
        gl2.framebufferTexture2D(gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT1, gl2.TEXTURE_2D, brightTex, 0);
        gl2.drawBuffers([gl2.COLOR_ATTACHMENT0, gl2.COLOR_ATTACHMENT1]);
        gl2.clearColor(0,0,0,0); gl2.clear(gl2.COLOR_BUFFER_BIT);
        gl2.activeTexture(gl2.TEXTURE0); gl2.bindTexture(gl2.TEXTURE_2D, baseTex); if (u1.tex) gl2.uniform1i(u1.tex, 0);
        gl2.activeTexture(gl2.TEXTURE1); gl2.bindTexture(gl2.TEXTURE_2D, readPhi); if (u1.prev) gl2.uniform1i(u1.prev, 1);
        gl2.activeTexture(gl2.TEXTURE2); gl2.bindTexture(gl2.TEXTURE_2D, beamTex); if (u1.beamMask) gl2.uniform1i(u1.beamMask, 2);
        if (u1.res) gl2.uniform2f(u1.res, cw, ch); if (u1.ctr) gl2.uniform2f(u1.ctr, center.x, center.y);
        if (u1.k1) gl2.uniform1f(u1.k1, k1); if (u1.k2) gl2.uniform1f(u1.k2, k2);
        if (u1.time) gl2.uniform1f(u1.time, now*0.001); if (u1.dt) gl2.uniform1f(u1.dt, dt);
        if (u1.alive) gl2.uniform1f(u1.alive, effectiveAlive); if (u1.mains) gl2.uniform1f(u1.mains, mainsHzRef.current || 60);
        const dF = [Math.exp(-dt/decayMsRef.current.r), Math.exp(-dt/decayMsRef.current.g), Math.exp(-dt/decayMsRef.current.b)]; if (u1.decayF) gl2.uniform3f(u1.decayF, dF[0], dF[1], dF[2]);
        if (u1.beamOn) gl2.uniform1f(u1.beamOn, beamOnRef.current ? 1.0 : 0.0);
        if (u1.beamPx) gl2.uniform1f(u1.beamPx, beamPxRef.current);
        if (u1.modDepth) gl2.uniform1f(u1.modDepth, beamModDepthRef.current);
        if (u1.interlace) gl2.uniform1f(u1.interlace, beamInterlaceRef.current ? 1.0 : 0.0);
        gl2.drawArrays(gl2.TRIANGLES, 0, 6);
        gl2.bindTexture(gl2.TEXTURE_2D, brightTex); gl2.generateMipmap(gl2.TEXTURE_2D);

        // Composite
        gl2.bindFramebuffer(gl2.FRAMEBUFFER, null); gl2.useProgram(prog2);
        gl2.activeTexture(gl2.TEXTURE0); gl2.bindTexture(gl2.TEXTURE_2D, writePhi); if (u2.phi) gl2.uniform1i(u2.phi, 0);
        gl2.activeTexture(gl2.TEXTURE1); gl2.bindTexture(gl2.TEXTURE_2D, brightTex); if (u2.bright) gl2.uniform1i(u2.bright, 1);
        gl2.activeTexture(gl2.TEXTURE2); gl2.bindTexture(gl2.TEXTURE_2D, blueTex); if (u2.blue) gl2.uniform1i(u2.blue, 2);
        gl2.activeTexture(gl2.TEXTURE3); gl2.bindTexture(gl2.TEXTURE_2D, normalTex); if (u2.normal) gl2.uniform1i(u2.normal, 3);
        gl2.activeTexture(gl2.TEXTURE4); gl2.bindTexture(gl2.TEXTURE_2D, dirtTex); if (u2.dirt) gl2.uniform1i(u2.dirt, 4);
        if (u2.res) gl2.uniform2f(u2.res, cw, ch); if (u2.alive) gl2.uniform1f(u2.alive, effectiveAlive); if (u2.halo) gl2.uniform1f(u2.halo, haloRef.current); if (u2.time) gl2.uniform1f(u2.time, now*0.001); if (u2.ctr) gl2.uniform2f(u2.ctr, center.x, center.y); if (u2.k1) gl2.uniform1f(u2.k1, k1); if (u2.k2) gl2.uniform1f(u2.k2, k2); if (u2.showGrid) gl2.uniform1f(u2.showGrid, showGrid);
        gl2.drawArrays(gl2.TRIANGLES, 0, 6);

        if (now - lastStateEmitRef.current > 500) { lastStateEmitRef.current = now; try { window.dispatchEvent(new CustomEvent("crt-state", { detail: { alive: aliveRef.current, effectiveAlive, mainsHz: mainsHzRef.current, fps: fpsEMARef.current, gated: gateRef.current, reduced: reduceRef.current, mode: "HQ", buffers: (use16F?"rgba16f":"rgba8")+"+mrt+mip", decayMs: { ...decayMsRef.current }, halo: haloRef.current, beam: { on: beamOnRef.current, beamPx: beamPxRef.current, modDepth: beamModDepthRef.current, interlace: beamInterlaceRef.current }, warp: { enabled: warpState.enabled, k1, k2, slider: warpState.slider, showGrid: warpState.showGrid } } })); } catch {} }

        const t=readPhi; readPhi=writePhi; writePhi=t;
        if (!reduceRef.current) rafRef.current = requestAnimationFrame(render);
      };

      // Capture (HQ): snapshot container into base texture (ImageBitmap path)
      let capturing=false; const capture = async () => {
        if (capturing) return;
        capturing=true;
        const t0 = performance.now();
        try {
          const px = interactingRef.current ? Math.min(1.25, Math.max(1, window.devicePixelRatio||1)) : dprRef.current;
          if (debugRef.current) { try { console.log("[CRT] capture:HQ:start", {px}); } catch {} }
          // Prefer toBlob -> ImageBitmap to avoid huge data URLs
          let uploaded = false;
          try {
            const blob = await htmlToImage.toBlob(container, {
              pixelRatio: px,
              cacheBust: true,
              filter: (node) => {
                if (!(node instanceof Element)) return true;
                if (node === canvas) return false;
                if (node.hasAttribute("data-ignore-snapshot")) return false;
                return !node.classList.contains("lens-warp");
              },
            });
            if (!blob) throw new Error("toBlob returned null");
            const bmp = await createImageBitmap(blob);
            gl2.pixelStorei(gl2.UNPACK_FLIP_Y_WEBGL, 0);
            gl2.activeTexture(gl2.TEXTURE0);
            gl2.bindTexture(gl2.TEXTURE_2D, baseTex);
            gl2.texImage2D(gl2.TEXTURE_2D,0,gl2.RGBA,gl2.RGBA,gl2.UNSIGNED_BYTE,bmp);
            try { bmp.close(); } catch {}
            uploaded = true;
          } catch (e) {
            if (debugRef.current) { try { console.warn("[CRT] toBlob/ImageBitmap failed (HQ), falling back", e); } catch {} }
          }
          if (!uploaded) {
            // Fallback to data URL -> object URL -> Image
            const dataUrl = await htmlToImage.toPng(container, {
              pixelRatio: px,
              cacheBust: true,
              filter: (node) => {
                if (!(node instanceof Element)) return true;
                if (node === canvas) return false;
                if (node.hasAttribute("data-ignore-snapshot")) return false;
                return !node.classList.contains("lens-warp");
              },
            });
            await new Promise<void>((resolve, reject) => {
              const img = new Image();
              img.onload = () => {
                gl2.pixelStorei(gl2.UNPACK_FLIP_Y_WEBGL, 0);
                gl2.activeTexture(gl2.TEXTURE0);
                gl2.bindTexture(gl2.TEXTURE_2D, baseTex);
                gl2.texImage2D(gl2.TEXTURE_2D,0,gl2.RGBA,gl2.RGBA,gl2.UNSIGNED_BYTE,img);
                resolve();
              };
              img.onerror = (err) => reject(err);
              img.src = dataUrl;
            });
          }
          const t1 = performance.now();
          if (debugRef.current) { try { console.log("[CRT] capture:HQ:done", {ms: Math.round(t1 - t0)}); } catch {} }
          render();
          if (!announcedReadyRef.current) { announcedReadyRef.current=true; requestAnimationFrame(() => window.dispatchEvent(new Event("webgl-ready"))); }
        } catch(e){
          console.warn("Lens capture failed", e);
        } finally { lastCaptureAtRef.current = performance.now(); capturing=false; }
      };
      const scheduleCapture = () => { if (pendingRef.current) return; const since = performance.now() - lastCaptureAtRef.current; const delay = Math.max(200, 200 - since); pendingRef.current = window.setTimeout(() => { pendingRef.current=null; capture(); }, delay); };

      const ro = new ResizeObserver(() => { roCountRef.current++; const dpr=Math.min(Math.max(window.devicePixelRatio||1,2),2.0); dprRef.current=dpr; resizeAll(); scheduleCapture(); }); ro.observe(container);
      window.addEventListener("resize", scheduleCapture); window.addEventListener("ascii-ready", capture);

      // Context loss cleanup
      const cleanup = () => { window.removeEventListener("crt-phosphor", onPhosphor); window.removeEventListener("crt-beam", onBeam); ro.disconnect(); window.removeEventListener("resize", scheduleCapture); window.removeEventListener("ascii-ready", capture); if (rafRef.current) cancelAnimationFrame(rafRef.current); gl2.deleteFramebuffer(fbo); gl2.deleteTexture(phiA); gl2.deleteTexture(phiB); gl2.deleteTexture(brightTex); gl2.deleteTexture(blueTex); gl2.deleteTexture(normalTex); gl2.deleteTexture(dirtTex); gl2.deleteTexture(baseTex); gl2.deleteProgram(prog1); gl2.deleteProgram(prog2); gl2.deleteShader(vs); gl2.deleteShader(ps1); gl2.deleteShader(ps2); gl2.deleteBuffer(vbo); };
      const onLost = (e: Event) => { e.preventDefault(); cleanup(); };
      canvas.addEventListener("webglcontextlost", onLost as EventListener, false);

      // Start
      render();
      return true;
    };

    if (forceMode !== "LQ" && tryInitHQ()) {
      return () => { /* HQ path handles its own cleanup */ };
    }

    // Setup GL (LQ fallback)
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true });
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
        uniform float u_showGrid;

        float hash1(float x){ return fract(sin(x*127.1) * 43758.5453123); }
        float safeAspect(vec2 res){ return res.y > 0.0 ? res.x / res.y : 1.0; }
        vec2 undistort(vec2 p, float k1, float k2){
          vec2 u = p;
          for(int i=0;i<3;i++){
            float r2 = dot(u,u);
            float f = max(1.0 + k1*r2 + k2*r2*r2, 1e-3);
            u = p / f;
          }
          return u;
        }
        vec2 lensSample(vec2 uv, vec2 center, vec2 res, float k1, float k2){
          float aspect = safeAspect(res);
          vec2 p = (uv - center) * 2.0;
          p.x *= aspect;
          vec2 u = undistort(p, k1, k2);
          u.x /= aspect;
          return center + u * 0.5;
        }
        bool inBounds(vec2 uv){
          return all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
        }

        void main(){
          float dr = 0.0002 * u_intensity;
          vec2 uvBase = vUv;
          vec2 uvR = lensSample(uvBase + vec2( dr, 0.0), u_center, u_res, u_k1, u_k2);
          vec2 uvG = lensSample(uvBase,                  u_center, u_res, u_k1, u_k2);
          vec2 uvB = lensSample(uvBase + vec2(-dr, 0.0), u_center, u_res, u_k1, u_k2);

          float phase = 6.2831853 * u_mainsHz * u_time;
          float line = gl_FragCoord.y;
          float jitter = (0.25 / u_res.x) * sin(phase + line * 0.015) * u_alive;
          float drift = sin(phase * 0.07 + line * 0.011) * (0.15 / u_res.x) * u_alive;
          float t2 = floor(u_time * 2.0);
          float n = hash1(line + t2 * 31.7);
          drift += (n - 0.5) * (0.05 / u_res.x) * u_alive;
          float dX = clamp(jitter + drift, -0.4 / u_res.x, 0.4 / u_res.x);
          uvR.x += dX; uvG.x += dX; uvB.x += dX;

          bool inR = inBounds(uvR);
          bool inG = inBounds(uvG);
          bool inB = inBounds(uvB);
          if (!inG) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
          }

          vec3 col = vec3(0.0);
          if (inR) col.r = texture2D(u_tex, uvR).r;
          if (inG) col.g = texture2D(u_tex, uvG).g;
          if (inB) col.b = texture2D(u_tex, uvB).b;

          if (u_alive > 0.0005) {
            float triad = fract((uvG.x * u_res.x) / 3.0);
            float sPx = 0.002 * sin(phase * 0.5 + triad * 6.2831853) * u_alive;
            float px = 1.0 / u_res.x;
            float rShift = (sPx + 0.15) * px;
            float bShift = -(sPx + 0.15) * px;
            vec3 triadCol;
            triadCol.r = texture2D(u_tex, clamp(uvG + vec2(rShift, 0.0), vec2(0.0), vec2(1.0))).r;
            triadCol.g = col.g;
            triadCol.b = texture2D(u_tex, clamp(uvG + vec2(bShift, 0.0), vec2(0.0), vec2(1.0))).b;
            float w = 0.20 * u_alive;
            col = mix(col, triadCol, w);
          }

          float I = u_intensity;

          float pxY = uvG.y * u_res.y;
          float scan = 0.5 + 0.5 * cos(6.28318 * (pxY / 3.0));
          float scanAmp = 0.06 * I;
          col *= mix(1.0 - scanAmp, 1.0, scan);

          float pxX = uvG.x * u_res.x;
          float grille = 0.5 + 0.5 * cos(6.28318 * (pxX / 3.0));
          float grilleAmp = 0.04 * I;
          col *= mix(1.0 - grilleAmp, 1.0, grille);

          float bandAmp = 0.04 * I;
          float pos = fract(uvG.y + (u_motion * u_time * 0.03));
          float band = smoothstep(0.45, 0.5, pos) * smoothstep(0.55, 0.5, pos);
          col *= 1.0 + bandAmp * band;

          vec2 c = (uvG - u_center) * vec2(u_res.x / u_res.y, 1.0);
          float r = length(c);
          float vig = smoothstep(0.9, 0.2, r);
          float vigAmp = 0.06 * I;
          col *= mix(1.0 - vigAmp, 1.0, vig);

          float flick = 1.0 + (0.02 * I) * (u_motion * (sin(u_time*8.0) * 0.5));
          col *= flick;

          vec2 texel = 1.0 / u_res;
          vec3 c0 = texture2D(u_tex, uvG).rgb;
          vec3 c1 = texture2D(u_tex, clamp(uvG + vec2(texel.x, 0.0), vec2(0.0), vec2(1.0))).rgb;
          vec3 c2 = texture2D(u_tex, clamp(uvG + vec2(-texel.x, 0.0), vec2(0.0), vec2(1.0))).rgb;
          vec3 c3 = texture2D(u_tex, clamp(uvG + vec2(0.0, texel.y), vec2(0.0), vec2(1.0))).rgb;
          vec3 c4 = texture2D(u_tex, clamp(uvG + vec2(0.0, -texel.y), vec2(0.0), vec2(1.0))).rgb;
          vec3 blur = (c0 + c1 + c2 + c3 + c4) * 0.2;
          float sharpen = 0.10;
          col = clamp(col * (1.0 + sharpen) - blur * sharpen, 0.0, 1.0);

          if (u_showGrid > 0.5) {
            vec2 grid = fract(uvG * vec2(20.0, 12.0));
            vec2 gridDist = min(grid, 1.0 - grid);
            float gridLine = max(step(gridDist.x, 0.01), step(gridDist.y, 0.01));
            vec3 gridColor = vec3(0.85, 0.95, 1.0);
            col = mix(col, gridColor, gridLine * 0.35);
          }

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
    const showGridLoc = gl.getUniformLocation(prog, "u_showGrid");
    if (texLoc) gl.uniform1i(texLoc, 0);
    if (ctrLoc) gl.uniform2f(ctrLoc, center.x, center.y);
    if (motionLoc) gl.uniform1f(motionLoc, reduceRef.current ? 0.0 : 1.0);
    const cssIntensity = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--crt-intensity")) || 0.1;
    if (intensityLoc) gl.uniform1f(intensityLoc, cssIntensity);
    if (aliveLoc) gl.uniform1f(aliveLoc, 0.0);
    if (mainsLoc) gl.uniform1f(mainsLoc, mainsHzRef.current || 60);
    const applyWarpUniforms = () => {
      const warpState = warpStateRef.current;
      const activeWarp = warpState.enabled
        ? warpState.current
        : ({ k1: 0, k2: 0 } as WarpCoefficients);
      if (k1Loc) gl.uniform1f(k1Loc, activeWarp.k1);
      if (k2Loc) gl.uniform1f(k2Loc, activeWarp.k2);
      if (showGridLoc) gl.uniform1f(showGridLoc, warpState.showGrid ? 1.0 : 0.0);
    };
    applyWarpUniforms();

    // Texture
    const tex = gl.createTexture();
    texRef.current = tex;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // Default: keep DOM snapshot orientation as-captured (no implicit flips)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
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
      applyWarpUniforms();
      maybeLogWarpDiagnostics(canvas.width, canvas.height);
      const warpState = warpStateRef.current;
      const activeWarp = warpState.enabled
        ? warpState.current
        : ({ k1: 0, k2: 0 } as WarpCoefficients);

      // Throttled state emission for dev console (every ~500ms)
      if (now - lastStateEmitRef.current > 500) {
        lastStateEmitRef.current = now;
        try {
          window.dispatchEvent(
            new CustomEvent("crt-state", {
              detail: {
                alive: aliveRef.current,
                effectiveAlive,
                mainsHz: mainsHzRef.current,
                fps: fpsEMARef.current,
                gated: gateRef.current,
                reduced: reduceRef.current,
                mode: "LQ",
                buffers: "none",
                decayMs: { ...decayMsRef.current },
                halo: haloRef.current,
                beam: { on: beamOnRef.current, beamPx: beamPxRef.current, modDepth: beamModDepthRef.current, interlace: beamInterlaceRef.current },
                warp: { enabled: warpState.enabled, k1: activeWarp.k1, k2: activeWarp.k2, slider: warpState.slider, showGrid: warpState.showGrid },
              },
            })
          );
        } catch {}
      }
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!reduceRef.current) {
        rafRef.current = requestAnimationFrame(render);
      }
    };

    // Snapshot underlying container into texture (LQ fallback)
    let capturing = false;
    const capture = async () => {
      if (capturing) return;
      capturing = true;
      const t0 = performance.now();
      try {
        const px = interactingRef.current ? Math.min(1.25, Math.max(1, window.devicePixelRatio||1)) : dprRef.current;
        if (debugRef.current) { try { console.log("[CRT] capture:LQ:start", {px}); } catch {} }
        // Try toBlob -> ImageBitmap first
        let uploaded = false;
        try {
          const blob = await htmlToImage.toBlob(container, {
            pixelRatio: px,
            cacheBust: true,
            filter: (node) => {
              if (!(node instanceof Element)) return true;
              if (node === canvas) return false;
              if (node.hasAttribute("data-ignore-snapshot")) return false;
              return !node.classList.contains("lens-warp");
            },
          });
          if (!blob) throw new Error("toBlob returned null");
          const bmp = await createImageBitmap(blob);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
          try { bmp.close(); } catch {}
          uploaded = true;
        } catch (e) {
          if (debugRef.current) { try { console.warn("[CRT] toBlob/ImageBitmap failed (LQ), falling back", e); } catch {} }
        }
        if (!uploaded) {
          const dataUrl = await htmlToImage.toPng(container, {
            pixelRatio: px,
            cacheBust: true,
            filter: (node) => {
              if (!(node instanceof Element)) return true;
              if (node === canvas) return false;
              if (node.hasAttribute("data-ignore-snapshot")) return false;
              return !node.classList.contains("lens-warp");
            },
          });
          await new Promise<void>((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
              gl.bindTexture(gl.TEXTURE_2D, tex);
              gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
              resolve();
            };
            img.onerror = (err) => reject(err);
            img.src = dataUrl;
          });
        }
        const t1 = performance.now();
        if (debugRef.current) { try { console.log("[CRT] capture:LQ:done", {ms: Math.round(t1 - t0)}); } catch {} }
        render();
        if (!announcedReadyRef.current) {
          announcedReadyRef.current = true;
          requestAnimationFrame(() => {
            window.dispatchEvent(new Event("webgl-ready"));
          });
        }
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
      if (debugRef.current) { try { console.log("[CRT] scheduleCapture", { delay }); } catch {} }
      pendingRef.current = window.setTimeout(() => {
        pendingRef.current = null;
        capture();
      }, delay);
    };

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 2), 2.0);
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

    const ro = new ResizeObserver(() => { roCountRef.current++; resize(); });
    ro.observe(container);
    resize();

    // Observe DOM changes inside `.screen`
    const mo = new MutationObserver((list) => {
      moCountRef.current += list.length;
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

    // Periodic debug emission
    let dbgTimer: number | null = null;
    if (debugRef.current) {
      dbgTimer = window.setInterval(() => {
        try { console.log("[CRT] observers:", { ro: roCountRef.current, mo: moCountRef.current }); } catch {}
        roCountRef.current = 0; moCountRef.current = 0;
      }, 1000);
    }

    return () => {
      window.removeEventListener("crt-alive", onAlive);
      window.removeEventListener("crt-interact", onInteract as EventListener);
      window.removeEventListener("crt-debug", onDebug as EventListener);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", scheduleCapture);
      window.removeEventListener("ascii-ready", capture);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (gl && texRef.current) gl.deleteTexture(texRef.current);
      if (gl && progRef.current) gl.deleteProgram(progRef.current);
      canvas.removeEventListener("webglcontextlost", onContextLost as EventListener);
      canvas.removeEventListener("webglcontextrestored", onContextRestored as EventListener);
      if (dbgTimer) window.clearInterval(dbgTimer);
    };
  }, [center.x, center.y]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement as HTMLElement | null;
    if (!canvas || !container) return;

    const remapCoordinates = (evt: MouseEvent | PointerEvent | WheelEvent) => {
      const rect = container.getBoundingClientRect();
      const { width, height, left, top } = rect;
      if (!width || !height) return null;

      const viewXRaw = (evt.clientX - left) / width;
      const viewYRaw = (evt.clientY - top) / height;
      if (!Number.isFinite(viewXRaw) || !Number.isFinite(viewYRaw)) return null;

      const viewX = clamp01(viewXRaw);
      const viewY = clamp01(viewYRaw);

      const aspect = safeAspectPx(width, height);
      const warpState = warpStateRef.current;
      const coeffs = warpState.enabled
        ? warpState.current
        : ({ k1: 0, k2: 0 } as WarpCoefficients);
      const sample = lensSample({ x: viewX, y: 1 - viewY }, centerRef.current, aspect, coeffs);

      const domX = clamp01(sample.x);
      const domYShader = clamp01(sample.y);
      const domY = 1 - domYShader;

      const clientX = left + domX * width;
      const clientY = top + domY * height;
      const deltaX = clientX - evt.clientX;
      const deltaY = clientY - evt.clientY;

      return {
        clientX,
        clientY,
        screenX: evt.screenX + deltaX,
        screenY: evt.screenY + deltaY,
        pageX: clientX + window.scrollX,
        pageY: clientY + window.scrollY,
        deltaX,
        deltaY,
      };
    };

    const previousPointerEvents = canvas.style.pointerEvents;
    canvas.style.pointerEvents = "auto";

    const pickTarget = (clientX: number, clientY: number) => {
      canvas.style.pointerEvents = "none";
      let target: Element | null = null;
      try {
        target = document.elementFromPoint(clientX, clientY);
      } finally {
        canvas.style.pointerEvents = "auto";
      }
      return (target as HTMLElement | null) ?? null;
    };

    const dispatchPointer = (evt: PointerEvent) => {
      if (!evt.isTrusted) return;
      const guard = pointerDispatchingRef.current;
      if (guard.has(evt.pointerId)) return;
      const mapped = remapCoordinates(evt);
      if (!mapped) return;
      const target = pickTarget(mapped.clientX, mapped.clientY);
      if (!target) return;

      guard.add(evt.pointerId);
      try {
        const init: PointerEventInit = {
          bubbles: evt.bubbles,
          cancelable: evt.cancelable,
          pointerId: evt.pointerId,
          pointerType: evt.pointerType,
          isPrimary: evt.isPrimary,
          width: evt.width,
          height: evt.height,
          pressure: evt.pressure,
          tangentialPressure: evt.tangentialPressure,
          tiltX: evt.tiltX,
          tiltY: evt.tiltY,
          twist: evt.twist,
          detail: evt.detail,
          button: evt.button,
          buttons: evt.buttons,
          ctrlKey: evt.ctrlKey,
          shiftKey: evt.shiftKey,
          altKey: evt.altKey,
          metaKey: evt.metaKey,
          clientX: mapped.clientX,
          clientY: mapped.clientY,
          screenX: mapped.screenX,
          screenY: mapped.screenY,
          relatedTarget: null,
        };

        try {
          target.dispatchEvent(new PointerEvent(evt.type, init));
        } catch {
          const fallbackInit: MouseEventInit = {
            bubbles: evt.bubbles,
            cancelable: evt.cancelable,
            detail: evt.detail,
            button: evt.button,
            buttons: evt.buttons,
            ctrlKey: evt.ctrlKey,
            shiftKey: evt.shiftKey,
            altKey: evt.altKey,
            metaKey: evt.metaKey,
            clientX: mapped.clientX,
            clientY: mapped.clientY,
            screenX: mapped.screenX,
            screenY: mapped.screenY,
          };
          target.dispatchEvent(new MouseEvent(evt.type, fallbackInit));
        }
      } finally {
        guard.delete(evt.pointerId);
      }

      evt.preventDefault();
      evt.stopImmediatePropagation();
    };

    const dispatchMouse = (evt: MouseEvent) => {
      if (!evt.isTrusted) return;
      if (mouseDispatchingRef.current) return;
      const mapped = remapCoordinates(evt);
      if (!mapped) return;
      const target = pickTarget(mapped.clientX, mapped.clientY);
      if (!target) return;

      mouseDispatchingRef.current = true;
      try {
        const init: MouseEventInit = {
          bubbles: evt.bubbles,
          cancelable: evt.cancelable,
          detail: evt.detail,
          button: evt.button,
          buttons: evt.buttons,
          ctrlKey: evt.ctrlKey,
          shiftKey: evt.shiftKey,
          altKey: evt.altKey,
          metaKey: evt.metaKey,
          clientX: mapped.clientX,
          clientY: mapped.clientY,
          screenX: mapped.screenX,
          screenY: mapped.screenY,
        };
        target.dispatchEvent(new MouseEvent(evt.type, init));
      } finally {
        mouseDispatchingRef.current = false;
      }

      evt.preventDefault();
      evt.stopImmediatePropagation();
    };

    const dispatchWheel = (evt: WheelEvent) => {
      if (!evt.isTrusted) return;
      if (wheelDispatchingRef.current) return;
      const mapped = remapCoordinates(evt);
      if (!mapped) return;
      const target = pickTarget(mapped.clientX, mapped.clientY);
      if (!target) return;

      wheelDispatchingRef.current = true;
      try {
        const init: WheelEventInit = {
          bubbles: evt.bubbles,
          cancelable: evt.cancelable,
          deltaX: evt.deltaX,
          deltaY: evt.deltaY,
          deltaZ: evt.deltaZ,
          deltaMode: evt.deltaMode,
          ctrlKey: evt.ctrlKey,
          shiftKey: evt.shiftKey,
          altKey: evt.altKey,
          metaKey: evt.metaKey,
          clientX: mapped.clientX,
          clientY: mapped.clientY,
          screenX: mapped.screenX,
          screenY: mapped.screenY,
        };
        target.dispatchEvent(new WheelEvent("wheel", init));
      } finally {
        wheelDispatchingRef.current = false;
      }

      evt.preventDefault();
      evt.stopImmediatePropagation();
    };

    const pointerEvents = [
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
      "pointerover",
      "pointerout",
      "pointerenter",
      "pointerleave",
    ] as const;
    pointerEvents.forEach((type) => canvas.addEventListener(type, dispatchPointer, true));

    const mouseEvents = ["click", "dblclick", "auxclick", "contextmenu"] as const;
    mouseEvents.forEach((type) => canvas.addEventListener(type, dispatchMouse, true));

    canvas.addEventListener("wheel", dispatchWheel, { capture: true, passive: false });

    return () => {
      pointerEvents.forEach((type) => canvas.removeEventListener(type, dispatchPointer, true));
      mouseEvents.forEach((type) => canvas.removeEventListener(type, dispatchMouse, true));
      canvas.removeEventListener("wheel", dispatchWheel, true);
      canvas.style.pointerEvents = previousPointerEvents;
    };
  }, [center.x, center.y]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement as HTMLElement | null;
    if (!canvas || !container) return;

    type HoverMap = Map<number, Element | null>;
    type PointerInfo = { target: Element | null; button: number; pointerType: string };
    type Coords = { clientX: number; clientY: number; normX: number; normY: number; inside: boolean };

    const pointerCaptures = new Map<number, Element>();
    const pointerDown = new Map<number, PointerInfo>();
    const hoverTargets: HoverMap = new Map();
    const hoveredElements = new Set<Element>();

    let lastClickTarget: Element | null = null;
    let lastClickButton = -1;
    let lastClickTime = 0;
    let lastClickDetail = 0;

    const clamp = (v: number, mn: number, mx: number) => Math.min(Math.max(v, mn), mx);

    const computeCoords = (clientX: number, clientY: number): Coords => {
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        return { clientX, clientY, normX: 0, normY: 0, inside: false };
      }
      const normX = (clientX - rect.left) / rect.width;
      const normY = (clientY - rect.top) / rect.height;
      const inside = normX >= 0 && normX <= 1 && normY >= 0 && normY <= 1;
      if (!inside) {
        return { clientX, clientY, normX, normY, inside: false };
      }
      const dxOut = normX - center.x;
      const dyOut = normY - center.y;
      const aspect = rect.width / rect.height || 1;
      let dx = dxOut;
      let dy = dyOut;
      for (let i = 0; i < 5; i += 1) {
        const dxAspect = dx * aspect;
        const r2 = 4 * (dxAspect * dxAspect + dy * dy);
        const f = 1 + k1 * r2 + k2 * r2 * r2;
        if (!Number.isFinite(f) || f === 0) {
          break;
        }
        dx = dxOut / f;
        dy = dyOut / f;
      }
      const nx = clamp(center.x + dx, 0, 1);
      const ny = clamp(center.y + dy, 0, 1);
      return {
        clientX: rect.left + nx * rect.width,
        clientY: rect.top + ny * rect.height,
        normX: nx,
        normY: ny,
        inside: true,
      };
    };

    const pickTarget = (coords: Coords): Element | null => {
      const prev = canvas.style.pointerEvents;
      canvas.style.pointerEvents = "none";
      const el = document.elementFromPoint(coords.clientX, coords.clientY) as Element | null;
      canvas.style.pointerEvents = prev;
      return el;
    };

    const basePointerInit = (event: PointerEvent, coords: Coords): PointerEventInit => {
      const dx = coords.clientX - event.clientX;
      const dy = coords.clientY - event.clientY;
      const anyEvent = event as unknown as { tangentialPressure?: number; altitudeAngle?: number; azimuthAngle?: number };
      return {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
        button: event.button,
        buttons: event.buttons,
        width: event.width,
        height: event.height,
        pressure: event.pressure,
        tangentialPressure: anyEvent.tangentialPressure ?? 0,
        tiltX: event.tiltX,
        tiltY: event.tiltY,
        twist: event.twist ?? 0,
        altitudeAngle: anyEvent.altitudeAngle,
        azimuthAngle: anyEvent.azimuthAngle,
        clientX: coords.clientX,
        clientY: coords.clientY,
        screenX: event.screenX + dx,
        screenY: event.screenY + dy,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        bubbles: true,
        cancelable: true,
        composed: true,
      } satisfies PointerEventInit;
    };

    const dispatchPointer = (
      type: string,
      target: Element | null,
      event: PointerEvent,
      coords: Coords,
      opts?: { bubbles?: boolean; cancelable?: boolean; relatedTarget?: Element | null }
    ) => {
      if (!target) return null;
      const init = basePointerInit(event, coords);
      if (typeof opts?.bubbles === "boolean") init.bubbles = opts.bubbles;
      if (typeof opts?.cancelable === "boolean") init.cancelable = opts.cancelable;
      init.relatedTarget = opts?.relatedTarget ?? null;
      const pointerEvent = new PointerEvent(type, init);
      target.dispatchEvent(pointerEvent);
      return pointerEvent;
    };

    const baseMouseInit = (
      event: PointerEvent | MouseEvent,
      coords: Coords,
      detail: number,
      overrides?: { button?: number; buttons?: number; relatedTarget?: Element | null; bubbles?: boolean; cancelable?: boolean }
    ): MouseEventInit => {
      const dx = coords.clientX - event.clientX;
      const dy = coords.clientY - event.clientY;
      const button = overrides?.button ?? event.button;
      return {
        detail,
        button,
        buttons: overrides?.buttons ?? event.buttons,
        clientX: coords.clientX,
        clientY: coords.clientY,
        screenX: event.screenX + dx,
        screenY: event.screenY + dy,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        relatedTarget: overrides?.relatedTarget ?? null,
        bubbles: overrides?.bubbles ?? true,
        cancelable: overrides?.cancelable ?? true,
        composed: true,
      } satisfies MouseEventInit;
    };

    const dispatchMouse = (
      type: string,
      target: Element | null,
      event: PointerEvent,
      coords: Coords,
      detail = 0,
      overrides?: { button?: number; buttons?: number; relatedTarget?: Element | null; bubbles?: boolean; cancelable?: boolean }
    ) => {
      if (!target) return null;
      const init = baseMouseInit(event, coords, detail, overrides);
      const mouseEvent = new MouseEvent(type, init);
      target.dispatchEvent(mouseEvent);
      return mouseEvent;
    };

    const getPath = (el: Element | null) => {
      const path: Element[] = [];
      let node: Element | null = el;
      while (node) {
        path.push(node);
        if (node === container) break;
        node = node.parentElement;
      }
      return path;
    };

    const updateHover = (pointerId: number, nextTarget: Element | null, event: PointerEvent, coords: Coords) => {
      const prevTarget = hoverTargets.get(pointerId) ?? null;
      if (prevTarget === nextTarget) return;

      const prevPath = getPath(prevTarget);
      const nextPath = getPath(nextTarget);
      const prevSet = new Set(prevPath);
      const nextSet = new Set(nextPath);

      for (const el of prevPath) {
        if (!nextSet.has(el)) {
          el.removeAttribute("data-crt-hover");
          hoveredElements.delete(el);
          dispatchPointer("pointerout", el, event, coords, { relatedTarget: nextTarget });
          if (event.pointerType === "mouse") {
            dispatchMouse("mouseout", el, event, coords, 0, { relatedTarget: nextTarget });
          }
          dispatchPointer("pointerleave", el, event, coords, { bubbles: false, cancelable: false, relatedTarget: nextTarget });
          if (event.pointerType === "mouse") {
            dispatchMouse("mouseleave", el, event, coords, 0, { bubbles: false, cancelable: false, relatedTarget: nextTarget });
          }
        }
      }

      for (let i = nextPath.length - 1; i >= 0; i -= 1) {
        const el = nextPath[i];
        if (!hoveredElements.has(el)) {
          el.setAttribute("data-crt-hover", "true");
          hoveredElements.add(el);
        }
        if (!prevSet.has(el)) {
          dispatchPointer("pointerenter", el, event, coords, { bubbles: false, cancelable: false, relatedTarget: prevTarget });
          if (event.pointerType === "mouse") {
            dispatchMouse("mouseenter", el, event, coords, 0, { bubbles: false, cancelable: false, relatedTarget: prevTarget });
          }
        }
      }

      if (nextTarget && nextTarget !== prevTarget) {
        dispatchPointer("pointerover", nextTarget, event, coords, { relatedTarget: prevTarget });
        if (event.pointerType === "mouse") {
          dispatchMouse("mouseover", nextTarget, event, coords, 0, { relatedTarget: prevTarget });
        }
      }

      hoverTargets.set(pointerId, nextTarget ?? null);
    };

    const recordClick = (target: Element, button: number) => {
      const now = performance.now();
      if (lastClickTarget && !document.contains(lastClickTarget)) {
        lastClickTarget = null;
        lastClickDetail = 0;
      }
      if (lastClickTarget === target && lastClickButton === button && now - lastClickTime < 500) {
        lastClickDetail += 1;
      } else {
        lastClickDetail = 1;
      }
      lastClickTarget = target;
      lastClickButton = button;
      lastClickTime = now;
      return lastClickDetail;
    };

    const originalSetPointerCapture = Element.prototype.setPointerCapture;
    const originalReleasePointerCapture = Element.prototype.releasePointerCapture;

    (Element.prototype as typeof Element.prototype & { setPointerCapture(id: number): void }).setPointerCapture = function patchedSet(
      pointerId: number
    ) {
      pointerCaptures.set(pointerId, this as Element);
      try {
        originalSetPointerCapture.call(canvas, pointerId);
      } catch {}
    };

    (Element.prototype as typeof Element.prototype & { releasePointerCapture(id: number): void }).releasePointerCapture = function patchedRelease(
      pointerId: number
    ) {
      if (pointerCaptures.get(pointerId) === this) {
        pointerCaptures.delete(pointerId);
      }
      try {
        originalReleasePointerCapture.call(canvas, pointerId);
      } catch {}
    };

    const handlePointerDown = (event: PointerEvent) => {
      const coords = computeCoords(event.clientX, event.clientY);
      const hit = pickTarget(coords) ?? container;
      updateHover(event.pointerId, hit, event, coords);
      pointerDown.set(event.pointerId, { target: hit, button: event.button, pointerType: event.pointerType });
      dispatchPointer("pointerdown", hit, event, coords);
      if (event.pointerType === "mouse") {
        dispatchMouse("mousedown", hit, event, coords, 1);
      }
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {}
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const handlePointerMove = (event: PointerEvent) => {
      const coords = computeCoords(event.clientX, event.clientY);
      const hit = pickTarget(coords);
      updateHover(event.pointerId, hit, event, coords);
      const capture = pointerCaptures.get(event.pointerId);
      const target = capture && document.contains(capture) ? capture : hit ?? container;
      dispatchPointer("pointermove", target, event, coords);
      if (event.pointerType === "mouse") {
        dispatchMouse("mousemove", target, event, coords);
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const handlePointerUp = (event: PointerEvent) => {
      const coords = computeCoords(event.clientX, event.clientY);
      const hit = pickTarget(coords);
      const capture = pointerCaptures.get(event.pointerId);
      const target = capture && document.contains(capture) ? capture : hit ?? container;
      dispatchPointer("pointerup", target, event, coords);
      if (event.pointerType === "mouse") {
        dispatchMouse("mouseup", target, event, coords);
      }
      const info = pointerDown.get(event.pointerId);
      pointerDown.delete(event.pointerId);
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {}
      updateHover(event.pointerId, hit, event, coords);

      const releaseTarget = hit ?? info?.target ?? target;
      if (
        info &&
        releaseTarget &&
        info.button === event.button &&
        document.contains(releaseTarget) &&
        info.target &&
        document.contains(info.target) &&
        (releaseTarget === info.target || releaseTarget.contains(info.target) || info.target.contains(releaseTarget))
      ) {
        const detail = recordClick(releaseTarget, event.button);
        if (event.button === 0) {
          const clickEvent = dispatchMouse("click", releaseTarget, event, coords, detail, { cancelable: true });
          if (detail === 2) {
            dispatchMouse("dblclick", releaseTarget, event, coords, 2, { cancelable: true });
          }
          if (clickEvent && !clickEvent.defaultPrevented && releaseTarget instanceof HTMLAnchorElement) {
            const href = releaseTarget.href;
            if (href) {
              const targetName = releaseTarget.target && releaseTarget.target.trim() !== "" ? releaseTarget.target : "_self";
              const rel = (releaseTarget.rel || "").toLowerCase();
              const features = rel.includes("noopener") || rel.includes("noreferrer") ? "noopener" : undefined;
              if (targetName === "_self") {
                if (features) {
                  window.open(href, targetName, features);
                } else {
                  window.location.assign(href);
                }
              } else {
                window.open(href, targetName, features);
              }
            }
          }
        } else if (event.button === 1) {
          dispatchMouse("auxclick", releaseTarget, event, coords, 1, { button: 1 });
        } else if (event.button === 2) {
          dispatchMouse("contextmenu", releaseTarget, event, coords, 1, { button: 2 });
        }
      }

      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const handlePointerCancel = (event: PointerEvent) => {
      const coords = computeCoords(event.clientX, event.clientY);
      const capture = pointerCaptures.get(event.pointerId);
      const info = pointerDown.get(event.pointerId);
      const target = capture && document.contains(capture) ? capture : info?.target ?? container;
      dispatchPointer("pointercancel", target, event, coords, { cancelable: false });
      pointerDown.delete(event.pointerId);
      pointerCaptures.delete(event.pointerId);
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {}
      updateHover(event.pointerId, null, event, coords);
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const handlePointerLeave = (event: PointerEvent) => {
      const coords = computeCoords(event.clientX, event.clientY);
      updateHover(event.pointerId, null, event, coords);
    };

    const handleLostCapture = (event: PointerEvent) => {
      pointerCaptures.delete(event.pointerId);
    };

    const handleWheel = (event: WheelEvent) => {
      const coords = computeCoords(event.clientX, event.clientY);
      const target = pickTarget(coords) ?? container;
      const wheelEvent = new WheelEvent("wheel", {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaZ: event.deltaZ,
        deltaMode: event.deltaMode,
        clientX: coords.clientX,
        clientY: coords.clientY,
        screenX: event.screenX + (coords.clientX - event.clientX),
        screenY: event.screenY + (coords.clientY - event.clientY),
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      target.dispatchEvent(wheelEvent);
      if (wheelEvent.defaultPrevented) {
        event.preventDefault();
      }
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerCancel);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    canvas.addEventListener("lostpointercapture", handleLostCapture);
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerCancel);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      canvas.removeEventListener("lostpointercapture", handleLostCapture);
      canvas.removeEventListener("wheel", handleWheel);
      Element.prototype.setPointerCapture = originalSetPointerCapture;
      Element.prototype.releasePointerCapture = originalReleasePointerCapture;
      hoveredElements.forEach((el) => {
        el.removeAttribute("data-crt-hover");
      });
      hoverTargets.clear();
      pointerDown.clear();
      pointerCaptures.clear();
    };
  }, [k1, k2, center.x, center.y]);

  return <canvas ref={canvasRef} className="lens-warp" aria-hidden data-ignore-snapshot data-section={Sections.LENS_WARP_CANVAS} />;
}

