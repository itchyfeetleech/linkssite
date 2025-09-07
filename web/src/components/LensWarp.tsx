"use client";

import { useEffect, useRef } from "react";
import * as htmlToImage from "html-to-image";

type Props = {
  // Optional: tweak curvature
  k1?: number; // primary distortion coefficient
  k2?: number; // secondary term
  center?: { x: number; y: number }; // normalized center, default 0.5,0.5
};

export default function LensWarp({ k1 = 0.06, k2 = 0.015, center = { x: 0.5, y: 0.5 } }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const texRef = useRef<WebGLTexture | null>(null);
  const progRef = useRef<WebGLProgram | null>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const reduceRef = useRef<boolean>(false);
  const dprRef = useRef<number>(1);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<number | null>(null);
  const lastCaptureAtRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    reduceRef.current = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

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
        float dr = 0.0009; // tune for subtlety
        vec2 uvR = barrel(vUv + vec2( dr, 0.0), u_k1, u_k2);
        vec2 uvG = barrel(vUv,                  u_k1, u_k2);
        vec2 uvB = barrel(vUv + vec2(-dr, 0.0), u_k1, u_k2);
        // Clamp to avoid wrapping
        uvR = clamp(uvR, vec2(0.0), vec2(1.0));
        uvG = clamp(uvG, vec2(0.0), vec2(1.0));
        uvB = clamp(uvB, vec2(0.0), vec2(1.0));
        vec3 col;
        col.r = texture2D(u_tex, uvR).r;
        col.g = texture2D(u_tex, uvG).g;
        col.b = texture2D(u_tex, uvB).b;
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
    if (texLoc) gl.uniform1i(texLoc, 0);
    if (k1Loc) gl.uniform1f(k1Loc, k1);
    if (k2Loc) gl.uniform1f(k2Loc, k2);
    if (ctrLoc) gl.uniform2f(ctrLoc, center.x, center.y);

    // Texture
    const tex = gl.createTexture();
    texRef.current = tex;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Render pass
    const render = () => {
      if (!prog || !gl) return;
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
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
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

    // Initial capture & render
    capture();

    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", scheduleCapture);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (gl && texRef.current) gl.deleteTexture(texRef.current);
      if (gl && progRef.current) gl.deleteProgram(progRef.current);
    };
  }, [k1, k2, center.x, center.y]);

  return <canvas ref={canvasRef} className="lens-warp" aria-hidden data-ignore-snapshot />;
}
