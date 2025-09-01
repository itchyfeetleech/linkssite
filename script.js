"use strict";

// ========================= UTILS =========================
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function isDef(v){ return v !== undefined && v !== null; }

// ========================= MAIN =========================
window.addEventListener("DOMContentLoaded", () => {
  // User links
  const LINKS = {
    faceit: "https://www.faceit.com/en/players/HoppCX",
    leetify: "https://leetify.com/app/profile/76561198198305361",
    deadlock: "https://tracklock.gg/players/238039633",
    valorant: "https://tracker.gg/valorant/profile/riot/HoppCX%23000/",
    overwatch: "https://www.overbuff.com/players/HoppCX-1509",
    marvel: "https://tracker.gg/marvel-rivals/profile/ign/HoppCX/",
    youtube: "https://www.youtube.com/@HoppCX"
  };
  for (const id of Object.keys(LINKS)) {
    const a = document.getElementById(id);
    if (a) a.href = LINKS[id];
  }

  // WebGL bg
  initBG();
});

// ========================= WEBGL BG =========================
function initBG(){
  const canvas = document.getElementById('bgCanvas');
  const gl = canvas?.getContext('webgl');
  if (!canvas || !gl) return;

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

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  const vs = compile(gl.VERTEX_SHADER, vertSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);

  const posLoc = gl.getAttribLocation(prog, 'position');
  const timeLoc = gl.getUniformLocation(prog, 'u_time');
  const resLoc = gl.getUniformLocation(prog, 'u_res');

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1,-1,  1,-1,  -1,1,
    -1,1,   1,-1,   1,1
  ]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  function resize(){
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0,0,canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  function render(t){
    gl.uniform1f(timeLoc, t*0.001);
    gl.uniform2f(resLoc, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}

// ========================= Tilt =========================
(function tilt(){
  const links = document.querySelectorAll('.link');
  const clampv = (n, a, b)=>Math.max(a, Math.min(b, n));
  links.forEach((el)=>{
    let raf = null;
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      const rotY = clampv((px - 0.5) * 8, -8, 8);
      const rotX = clampv((0.5 - py) * 6, -6, 6);
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty('--tiltX', rotX.toFixed(2) + 'deg');
        el.style.setProperty('--tiltY', rotY.toFixed(2) + 'deg');
      });
    };
    const reset = () => {
      if (raf) cancelAnimationFrame(raf);
      el.style.setProperty('--tiltX', '0deg');
      el.style.setProperty('--tiltY', '0deg');
    };
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', reset);
    el.addEventListener('touchstart', reset, { passive: true });
    el.addEventListener('touchend', reset, { passive: true });
  });
})();
