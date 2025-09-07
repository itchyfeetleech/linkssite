"use client";

import { useEffect, useRef } from "react";

export default function ClientEffects() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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
      void main(){
        vec2 uv = gl_FragCoord.xy / u_res.xy;
        float n = noise(uv*3.0 + u_time*0.02);
        vec3 c1 = vec3(0.06,0.07,0.10);
        vec3 c2 = vec3(0.10,0.11,0.14);
        vec3 col = mix(c1, c2, n);
        gl_FragColor = vec4(col, 1.0);
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
    // Tilt interactions
    const links = document.querySelectorAll<HTMLElement>(".link");
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
      cbs.forEach((fn) => fn());
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} id="bgCanvas" className="bg webgl" />
      <div id="fogOverlay" className="bg fog" />
    </>
  );
}
