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
  const aliveRef = useRef<number>(1.0); // default micro-effects strength
  const mainsHzRef = useRef<number>(5); // default mains (Hz)
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
    window.addEventListener("crt-alive", onAlive);

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

      const vsrc = `#version 300 es\nprecision highp float; layout(location=0) in vec2 position; out vec2 vUv; void main(){ vUv=(position+1.0)*0.5; gl_Position=vec4(position,0.0,1.0);} `;
      const fs1 = `#version 300 es\nprecision highp float; layout(location=0) out vec4 oPhi; layout(location=1) out vec4 oBright; in vec2 vUv;\nuniform sampler2D u_tex; uniform sampler2D u_prevPhi; uniform sampler2D u_beamMask;\nuniform vec2 u_res; uniform vec2 u_center; uniform float u_k1; uniform float u_k2; uniform float u_time; uniform float u_dt; uniform float u_alive; uniform float u_mainsHz; uniform vec3 u_decayF;\nuniform float u_beamOn; uniform float u_beamPx; uniform float u_modDepth; uniform float u_interlace;\nfloat hash1(float x){ return fract(sin(x*127.1)*43758.5453123); }\nvec2 barrel(vec2 uv, float k1, float k2){ vec2 p=(uv-u_center)*2.0; float aspect=u_res.x/u_res.y; p.x*=aspect; float r2=dot(p,p); float f=1.0 + k1*r2 + k2*r2*r2; p*=f; p.x/=aspect; return u_center + p*0.5; }\nvoid main(){ float phase=6.2831853*u_mainsHz*u_time; float line=float(int(gl_FragCoord.y)); float jitter=(0.25/u_res.x)*sin(phase+line*0.015)*u_alive; float drift=sin(phase*0.07+line*0.011)*(0.15/u_res.x)*u_alive; float t2=floor(u_time*2.0); float n=hash1(line+t2*31.7); drift+=(n-0.5)*(0.05/u_res.x)*u_alive; float dX=clamp(jitter+drift,-0.4/u_res.x,0.4/u_res.x); vec2 uvR=barrel(vUv+vec2( 0.0002,0.0),u_k1,u_k2); vec2 uvG=barrel(vUv,u_k1,u_k2); vec2 uvB=barrel(vUv+vec2(-0.0002,0.0),u_k1,u_k2); uvR.x+=dX; uvG.x+=dX; uvB.x+=dX; uvR=clamp(uvR,vec2(0.0),vec2(1.0)); uvG=clamp(uvG,vec2(0.0),vec2(1.0)); uvB=clamp(uvB,vec2(0.0),vec2(1.0)); vec3 src; src.r=texture(u_tex,uvR).r; src.g=texture(u_tex,uvG).g; src.b=texture(u_tex,uvB).b; vec3 baseLin=pow(max(src,vec3(0.0)), vec3(2.2));\n  // Dynamic beam and scanline mask in linear space\n  float px = uvG.x * u_res.x; float py = uvG.y * u_res.y;\n  float sweep = fract(u_time * (u_mainsHz * 0.05)); float py0 = sweep * u_res.y + (u_interlace>0.5 ? 0.5 : 0.0);\n  float s = fract(px / 3.0); float t = clamp(0.5 + (py - py0) / max(1.0, 6.0*u_beamPx), 0.0, 1.0);\n  vec3 beamRGB = texture(u_beamMask, vec2(s, t)).rgb;\n  float beamW = clamp(u_beamOn * u_modDepth * max(max(beamRGB.r, beamRGB.g), beamRGB.b), 0.0, 1.0);\n  baseLin *= (1.0 + u_beamOn * u_modDepth * beamRGB);\n  float sigma = max(1.0, 3.0 * u_beamPx);\n  float dy = (py - py0);\n  float beamLine = exp(-0.5 * (dy*dy) / (sigma*sigma));\n  vec3 beamAdd = beamRGB * beamLine * (0.12 * u_alive) * beamW;\n  // vertical retrace highlight (~3% additive, ~4px wide) near left edge\n  float dx = abs(px - 2.0); float retrace = 0.03 * exp(-0.5 * (dx*dx) / (2.0*2.0));\n  baseLin += retrace * u_beamOn;\n  // Beam persistence (slight) so background gets afterglow
  vec3 beamPersist = beamRGB * beamLine * (0.015 * u_alive) * beamW;\n  vec3 prev=texture(u_prevPhi, vUv).rgb; vec3 decayVec = u_decayF * (1.0 - 0.35 * beamW); vec3 newPhi=max(baseLin + beamPersist, mix(vec3(0.0), prev*decayVec, u_alive)); vec3 bright=max(newPhi-vec3(0.6), vec3(0.0)); bright += beamAdd; oPhi=vec4(newPhi,1.0); oBright=vec4(bright,1.0);} `;
      const fs2 = `#version 300 es\nprecision highp float; out vec4 frag; in vec2 vUv;\nuniform sampler2D u_phi; uniform sampler2D u_bright; uniform sampler2D u_blue; uniform sampler2D u_normal; uniform sampler2D u_dirt;\nuniform vec2 u_res; uniform float u_alive; uniform float u_halo; uniform float u_time; uniform vec2 u_center; uniform float u_k1; uniform float u_k2;\nvec3 bloom(vec2 uv){ vec2 px=1.0/u_res; vec3 s=vec3(0.0); for(int i=0;i<8;i++){ float a=6.2831853*float(i)/8.0; vec2 d=vec2(cos(a),sin(a)); s+=textureLod(u_bright, uv+d*px*1.5,1.0).rgb*0.20; s+=textureLod(u_bright, uv+d*px*2.5,2.0).rgb*0.12; s+=textureLod(u_bright, uv+d*px*4.0,3.0).rgb*0.08; } return s; }\nvec2 barrel(vec2 uv, float k1, float k2){ vec2 p=(uv-u_center)*2.0; float aspect=u_res.x/u_res.y; p.x*=aspect; float r2=dot(p,p); float f=1.0 + k1*r2 + k2*r2*r2; p*=f; p.x/=aspect; return u_center + p*0.5; }\nvoid main(){ vec3 phi=texture(u_phi,vUv).rgb; vec2 uv=vUv; vec2 uvD = barrel(uv, u_k1, u_k2);\n  float dirt = texture(u_dirt, uvD*1.0).r; vec3 bloomAll=bloom(uv); bloomAll *= mix(1.0, dirt*1.6, 0.6*u_alive);\n  vec3 haloText=clamp(bloomAll*(0.7*u_alive)*u_halo, vec3(0.0), 0.06*max(phi,vec3(0.0))*u_alive);\n  float luma = dot(phi, vec3(0.2126,0.7152,0.0722)); float dark = smoothstep(0.35, 0.0, luma); vec3 beamGlow=min(bloomAll*(mix(0.18,0.45,dark)*u_alive), vec3(mix(0.05,0.12,dark)));\n  vec3 colLin=phi+haloText+beamGlow;\n  vec3 nrm = texture(u_normal, uvD*1.0).xyz * 2.0 - 1.0; nrm = normalize(nrm*vec3(0.6,0.6,1.0)); vec3 L = normalize(vec3(0.25,0.6,1.0)); vec3 V = vec3(0.0,0.0,1.0); vec3 H = normalize(L+V); float spec = pow(max(dot(nrm,H),0.0), 64.0); float specW = smoothstep(0.2, 0.7, luma); colLin += spec * (0.05*u_alive) * specW;\n  float tri=fract((uvD.x*u_res.x)/3.0); vec3 mask=normalize(vec3(smoothstep(0.0,0.33,tri), smoothstep(0.33,0.66,tri), smoothstep(0.66,1.0,tri))+1e-3); colLin*=mix(vec3(1.0), mask*3.0, 0.03*u_alive);\n  float bn = texture(u_blue, uvD*8.0 + vec2(0.017*u_time, -0.013*u_time)).r; colLin *= (1.0 + (bn-0.5)*(0.015*u_alive));\n  vec3 srgb=pow(max(colLin,vec3(0.0)), vec3(1.0/2.2)); float d=texture(u_blue, uvD*6.0 + vec2(0.007*u_time, 0.011*u_time)).r; srgb += (d-0.5)*(0.7/255.0);\n  frag=vec4(clamp(srgb,0.0,1.0),1.0);} `;

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
      const baseTex = gl2.createTexture()!; gl2.bindTexture(gl2.TEXTURE_2D, baseTex); gl2.pixelStorei(gl2.UNPACK_FLIP_Y_WEBGL, 1); gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MIN_FILTER, gl2.LINEAR); gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MAG_FILTER, gl2.LINEAR); gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_S, gl2.CLAMP_TO_EDGE); gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_T, gl2.CLAMP_TO_EDGE);
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
      const resizeAll = () => { const rect = container.getBoundingClientRect(); const dpr = Math.min(Math.max(window.devicePixelRatio||1,2),2.5); dprRef.current=dpr; const w=Math.max(1,Math.floor(rect.width)); const h=Math.max(1,Math.floor(rect.height)); canvas.width=Math.floor(w*dpr); canvas.height=Math.floor(h*dpr); canvas.style.width=`${w}px`; canvas.style.height=`${h}px`; gl2.viewport(0,0,canvas.width,canvas.height); cw=canvas.width; ch=canvas.height; resizeTex(phiA,cw,ch); resizeTex(phiB,cw,ch); resizeTex(brightTex,cw,ch); };
      resizeAll();

      // Uniform locations
      const u1 = { tex: gl2.getUniformLocation(prog1,"u_tex"), prev: gl2.getUniformLocation(prog1,"u_prevPhi"), beamMask: gl2.getUniformLocation(prog1,"u_beamMask"), res: gl2.getUniformLocation(prog1,"u_res"), ctr: gl2.getUniformLocation(prog1,"u_center"), k1: gl2.getUniformLocation(prog1,"u_k1"), k2: gl2.getUniformLocation(prog1,"u_k2"), time: gl2.getUniformLocation(prog1,"u_time"), dt: gl2.getUniformLocation(prog1,"u_dt"), alive: gl2.getUniformLocation(prog1,"u_alive"), mains: gl2.getUniformLocation(prog1,"u_mainsHz"), decayF: gl2.getUniformLocation(prog1,"u_decayF"), beamOn: gl2.getUniformLocation(prog1,"u_beamOn"), beamPx: gl2.getUniformLocation(prog1,"u_beamPx"), modDepth: gl2.getUniformLocation(prog1,"u_modDepth"), interlace: gl2.getUniformLocation(prog1,"u_interlace") } as const;
      const u2 = { phi: gl2.getUniformLocation(prog2,"u_phi"), bright: gl2.getUniformLocation(prog2,"u_bright"), blue: gl2.getUniformLocation(prog2,"u_blue"), normal: gl2.getUniformLocation(prog2,"u_normal"), dirt: gl2.getUniformLocation(prog2,"u_dirt"), res: gl2.getUniformLocation(prog2,"u_res"), alive: gl2.getUniformLocation(prog2,"u_alive"), halo: gl2.getUniformLocation(prog2,"u_halo"), time: gl2.getUniformLocation(prog2,"u_time"), ctr: gl2.getUniformLocation(prog2,"u_center"), k1: gl2.getUniformLocation(prog2,"u_k1"), k2: gl2.getUniformLocation(prog2,"u_k2") } as const;

      // Render
      const render = () => {
        const now = performance.now(); const dt = Math.max(0.0001, (now - lastRenderAtRef.current) * 0.001); lastRenderAtRef.current = now; const fps = 1.0/dt; fpsEMARef.current = fpsEMARef.current*0.9 + fps*0.1;
        if (fpsEMARef.current < 30) { if (belowSinceRef.current==null) belowSinceRef.current=now; if (!gateRef.current && belowSinceRef.current && now - belowSinceRef.current > 3000) gateRef.current = true; } else { belowSinceRef.current=null; if (gateRef.current) { if (aboveSinceRef.current==null) aboveSinceRef.current=now; if (now - aboveSinceRef.current > 1500) gateRef.current=false; } else { aboveSinceRef.current=null; } }
        const requested = reduceRef.current ? 0 : aliveRef.current; const effectiveAlive = Math.min(requested, gateRef.current ? 0.3 : 1.0);

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
        if (u2.res) gl2.uniform2f(u2.res, cw, ch); if (u2.alive) gl2.uniform1f(u2.alive, effectiveAlive); if (u2.halo) gl2.uniform1f(u2.halo, haloRef.current); if (u2.time) gl2.uniform1f(u2.time, now*0.001); if (u2.ctr) gl2.uniform2f(u2.ctr, center.x, center.y); if (u2.k1) gl2.uniform1f(u2.k1, k1); if (u2.k2) gl2.uniform1f(u2.k2, k2);
        gl2.drawArrays(gl2.TRIANGLES, 0, 6);

        if (now - lastStateEmitRef.current > 500) { lastStateEmitRef.current = now; try { window.dispatchEvent(new CustomEvent("crt-state", { detail: { alive: aliveRef.current, effectiveAlive, mainsHz: mainsHzRef.current, fps: fpsEMARef.current, gated: gateRef.current, reduced: reduceRef.current, mode: "HQ", buffers: (use16F?"rgba16f":"rgba8")+"+mrt+mip", decayMs: { ...decayMsRef.current }, halo: haloRef.current, beam: { on: beamOnRef.current, beamPx: beamPxRef.current, modDepth: beamModDepthRef.current, interlace: beamInterlaceRef.current } } })); } catch {} }

        const t=readPhi; readPhi=writePhi; writePhi=t;
        if (!reduceRef.current) rafRef.current = requestAnimationFrame(render);
      };

      // Capture
      let capturing=false; const capture = async () => { if (capturing) return; capturing=true; try { canvas.style.opacity = "0"; const dataUrl = await htmlToImage.toPng(container, { pixelRatio: dprRef.current, cacheBust: true, filter: (node) => { if (!(node instanceof Element)) return true; if (node === canvas) return false; if (node.hasAttribute("data-ignore-snapshot")) return false; return !node.classList.contains("lens-warp"); } }); const img = new Image(); img.onload = () => { gl2.activeTexture(gl2.TEXTURE0); gl2.bindTexture(gl2.TEXTURE_2D, baseTex); gl2.texImage2D(gl2.TEXTURE_2D,0,gl2.RGBA,gl2.RGBA,gl2.UNSIGNED_BYTE,img); canvas.style.opacity = ""; render(); if (!announcedReadyRef.current) { announcedReadyRef.current=true; requestAnimationFrame(() => window.dispatchEvent(new Event("webgl-ready"))); } }; img.src = dataUrl; } catch(e){ console.warn("Lens capture failed", e);} finally { lastCaptureAtRef.current = performance.now(); capturing=false; if (canvas.style.opacity === "0") { canvas.style.opacity = ""; } } };
      const scheduleCapture = () => { if (pendingRef.current) return; const since = performance.now() - lastCaptureAtRef.current; const delay = Math.max(200, 200 - since); pendingRef.current = window.setTimeout(() => { pendingRef.current=null; capture(); }, delay); };

      const ro = new ResizeObserver(() => { const dpr=Math.min(Math.max(window.devicePixelRatio||1,2),2.5); dprRef.current=dpr; resizeAll(); scheduleCapture(); }); ro.observe(container);
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

    // Snapshot underlying container into texture
    let capturing = false;
    const capture = async () => {
      if (capturing) return;
      capturing = true;
      // Do not toggle visibility; we already exclude the warp canvas in html-to-image filter
      try {
        canvas.style.opacity = "0";
        const dataUrl = await htmlToImage.toPng(container, {
          pixelRatio: dprRef.current,
          cacheBust: true,
          filter: (node) => {
            if (!(node instanceof Element)) return true;
            if (node === canvas) return false;
            if (node.hasAttribute("data-ignore-snapshot")) return false;
            return !node.classList.contains("lens-warp");
          },
        });
        const img = new Image();
        img.onload = () => {
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          canvas.style.opacity = "";
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
        if (canvas.style.opacity === "0") canvas.style.opacity = "";
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
      canvas.removeEventListener("webglcontextlost", onContextLost as EventListener);
      canvas.removeEventListener("webglcontextrestored", onContextRestored as EventListener);
    };
  }, [k1, k2, center.x, center.y]);

  return <canvas ref={canvasRef} className="lens-warp" aria-hidden data-ignore-snapshot data-section={Sections.LENS_WARP_CANVAS} />;
}
