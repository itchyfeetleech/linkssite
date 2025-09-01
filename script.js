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

  // Site scale for consistent framing when zooming
  const BASE = { w: 1920, h: 1080 };
  function updateScale(){
    const s = Math.min(window.innerWidth/BASE.w, window.innerHeight/BASE.h);
    document.documentElement.style.setProperty('--site-scale', String(s));
  }
  window.addEventListener('resize', updateScale);
  updateScale();

  // WebGL bg
  initBG();

  // Fluid smoke
  initSmoke();
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

// ========================= FLUID SMOKE (WebGL2) =========================
function initSmoke(){
  const canvas = document.getElementById('smokeCanvas');
  const gl = canvas?.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: false });
  if (!canvas || !gl) return;

  // Resize
  let dpr = Math.max(1, window.devicePixelRatio || 1);
  function resize(){
    const w = window.innerWidth|0, h = window.innerHeight|0;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    sim.resize();
  }
  window.addEventListener('resize', ()=>{ dpr = Math.max(1, window.devicePixelRatio||1); resize(); });
  // Obstacles may move due to hover tilt. Sample frequently.
  setInterval(()=>sim.measureObstacles(), 60);

  // GL helpers
  gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('OES_texture_float_linear');
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);

  // Formats
  const HALF = gl.HALF_FLOAT;
  const fmt = {
    vel:   { int: gl.RG16F,   format: gl.RG,   type: HALF },
    dye:   { int: gl.RGBA16F, format: gl.RGBA, type: HALF },
    pres:  { int: gl.R16F,    format: gl.RED,  type: HALF },
    scal:  { int: gl.R16F,    format: gl.RED,  type: HALF }
  };

  // Fullscreen quad VAO
  const quadVAO = gl.createVertexArray();
  const quadVBO = gl.createBuffer();
  gl.bindVertexArray(quadVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1,-1,  1,-1,  -1,1,
    -1,1,   1,-1,   1,1
  ]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  function compile(type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s));
    }
    return s;
  }
  function program(vs, fs){
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(p));
    }
    return p;
  }

  const vtx = `#version 300 es
    layout(location=0) in vec2 a_pos;
    out vec2 v_uv;
    void main(){
      v_uv = a_pos * 0.5 + 0.5;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }`;
  // Sampler helpers
  const COMMON = `#version 300 es
    precision highp float;
    precision highp sampler2D;
    in vec2 v_uv;
    out vec4 frag;
    uniform vec2 u_texel; // 1/size
    vec2 clampUV(vec2 uv){ return clamp(uv, u_texel*0.5, 1.0 - u_texel*0.5); }
  `;

  const FS_ADVECT = COMMON + `
    uniform sampler2D u_velocity;
    uniform sampler2D u_source;
    uniform sampler2D u_obstacles; // R8 mask: 1 fluid, 0 solid
    uniform float u_dt;
    uniform float u_dissipation;
    void main(){
      vec2 vel = texture(u_velocity, v_uv).xy;
      vec2 uv = v_uv - u_dt * vel; // texel space
      uv = clampUV(uv);
      float obst = texture(u_obstacles, uv).r;
      vec4 src = texture(u_source, uv);
      src *= obst;
      frag = mix(src, vec4(0.0), u_dissipation * u_dt);
    }
  `;

  const FS_FORCE = COMMON + `
    uniform sampler2D u_velocity;
    uniform sampler2D u_curl; // scalar
    uniform sampler2D u_obstacles;
    uniform float u_dt;
    uniform float u_gravity; // downward +
    uniform float u_vorticity;
    void main(){
      vec2 texel = u_texel;
      float C = texture(u_curl, v_uv).r;
      float L = texture(u_curl, v_uv - vec2(texel.x,0.)).r;
      float R = texture(u_curl, v_uv + vec2(texel.x,0.)).r;
      float B = texture(u_curl, v_uv - vec2(0.,texel.y)).r;
      float T = texture(u_curl, v_uv + vec2(0.,texel.y)).r;
      vec2 grad = 0.5 * vec2(abs(T)-abs(B), abs(R)-abs(L));
      grad = normalize(grad + 1e-5);
      vec2 vortF = u_vorticity * vec2(grad.y, -grad.x) * C;
      vec2 vel = texture(u_velocity, v_uv).xy;
      vel += vec2(0.0, u_gravity) * u_dt;
      vel += vortF * u_dt;
      float obst = texture(u_obstacles, v_uv).r;
      vel *= obst;
      frag = vec4(vel, 0.0, 1.0);
    }
  `;

  const FS_DIVERGENCE = COMMON + `
    uniform sampler2D u_velocity;
    uniform sampler2D u_obstacles;
    void main(){
      vec2 texel = u_texel;
      vec2 vL = texture(u_velocity, v_uv - vec2(texel.x,0.)).xy;
      vec2 vR = texture(u_velocity, v_uv + vec2(texel.x,0.)).xy;
      vec2 vB = texture(u_velocity, v_uv - vec2(0.,texel.y)).xy;
      vec2 vT = texture(u_velocity, v_uv + vec2(0.,texel.y)).xy;
      float oC = texture(u_obstacles, v_uv).r;
      float oL = texture(u_obstacles, v_uv - vec2(texel.x,0.)).r;
      float oR = texture(u_obstacles, v_uv + vec2(texel.x,0.)).r;
      float oB = texture(u_obstacles, v_uv - vec2(0.,texel.y)).r;
      float oT = texture(u_obstacles, v_uv + vec2(0.,texel.y)).r;
      vL.x *= oL; vR.x *= oR; vB.y *= oB; vT.y *= oT;
      float div = 0.5 * ((vR.x - vL.x) + (vT.y - vB.y));
      div *= oC;
      frag = vec4(div, 0.,0.,1.);
    }
  `;

  const FS_PRESSURE = COMMON + `
    uniform sampler2D u_pressure;
    uniform sampler2D u_divergence;
    uniform sampler2D u_obstacles;
    void main(){
      vec2 texel = u_texel;
      float pL = texture(u_pressure, v_uv - vec2(texel.x,0.)).r;
      float pR = texture(u_pressure, v_uv + vec2(texel.x,0.)).r;
      float pB = texture(u_pressure, v_uv - vec2(0.,texel.y)).r;
      float pT = texture(u_pressure, v_uv + vec2(0.,texel.y)).r;
      float div = texture(u_divergence, v_uv).r;
      float oC = texture(u_obstacles, v_uv).r;
      float oL = texture(u_obstacles, v_uv - vec2(texel.x,0.)).r;
      float oR = texture(u_obstacles, v_uv + vec2(texel.x,0.)).r;
      float oB = texture(u_obstacles, v_uv - vec2(0.,texel.y)).r;
      float oT = texture(u_obstacles, v_uv + vec2(0.,texel.y)).r;
      float sum = pL*oL + pR*oR + pB*oB + pT*oT;
      float count = oL + oR + oB + oT + 1e-5;
      float p = (sum - div) / count;
      p *= oC;
      frag = vec4(p,0.,0.,1.);
    }
  `;

  const FS_GRADIENT = COMMON + `
    uniform sampler2D u_velocity;
    uniform sampler2D u_pressure;
    uniform sampler2D u_obstacles;
    void main(){
      vec2 texel = u_texel;
      float pL = texture(u_pressure, v_uv - vec2(texel.x,0.)).r;
      float pR = texture(u_pressure, v_uv + vec2(texel.x,0.)).r;
      float pB = texture(u_pressure, v_uv - vec2(0.,texel.y)).r;
      float pT = texture(u_pressure, v_uv + vec2(0.,texel.y)).r;
      vec2 grad = 0.5 * vec2(pR - pL, pT - pB);
      vec2 v = texture(u_velocity, v_uv).xy - grad;
      float obst = texture(u_obstacles, v_uv).r;
      v *= obst;
      frag = vec4(v,0.,1.);
    }
  `;

  const FS_CURL = COMMON + `
    uniform sampler2D u_velocity;
    void main(){
      vec2 texel = u_texel;
      float vxT = texture(u_velocity, v_uv + vec2(0., texel.y)).x;
      float vxB = texture(u_velocity, v_uv - vec2(0., texel.y)).x;
      float vyR = texture(u_velocity, v_uv + vec2(texel.x, 0.)).y;
      float vyL = texture(u_velocity, v_uv - vec2(texel.x, 0.)).y;
      float curl = 0.5 * ((vyR - vyL) - (vxT - vxB));
      frag = vec4(curl,0.,0.,1.);
    }
  `;

  const FS_RENDER = `#version 300 es
    precision highp float;
    in vec2 v_uv;
    out vec4 frag;
    uniform sampler2D u_dye;
    uniform float u_gamma;
    void main(){
      float d = texture(u_dye, v_uv).r;
      float c = 1.0 - exp(-3.5 * d);
      c = pow(c, 1.0/u_gamma);
      frag = vec4(vec3(c), c * 0.95);
    }
  `;

  const FS_BRUSH_DYE = COMMON + `
    uniform sampler2D u_target;
    uniform vec4 u_brush; // x,y,r,strength in UV
    uniform float u_decay;
    void main(){
      vec4 t = texture(u_target, v_uv);
      t *= (1.0 - u_decay);
      float dist = distance(v_uv, u_brush.xy);
      float add = smoothstep(u_brush.z, 0.0, dist) * u_brush.w;
      frag = t + vec4(add);
    }
  `;

  const FS_BRUSH_VEL = COMMON + `
    uniform sampler2D u_target;
    uniform vec4 u_brush; // x,y,r,strength in UV
    uniform vec2 u_dir;   // velocity to add
    void main(){
      vec2 v = texture(u_target, v_uv).xy;
      float dist = distance(v_uv, u_brush.xy);
      float s = smoothstep(u_brush.z, 0.0, dist) * u_brush.w;
      v += u_dir * s;
      frag = vec4(v,0.,1.);
    }
  `;

  // Programs
  const P_ADVECT = program(vtx, FS_ADVECT);
  const P_FORCE  = program(vtx, FS_FORCE);
  const P_DIVER  = program(vtx, FS_DIVERGENCE);
  const P_PRESS  = program(vtx, FS_PRESSURE);
  const P_GRAD   = program(vtx, FS_GRADIENT);
  const P_CURL   = program(vtx, FS_CURL);
  const P_REND   = program(vtx, FS_RENDER);
  const P_BRDYE  = program(vtx, FS_BRUSH_DYE);
  const P_BRVEL  = program(vtx, FS_BRUSH_VEL);

  // FBO helper
  function makeFBO(w,h, {int,format,type}, filter=gl.LINEAR){
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, int, w, h, 0, format, type, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }
  function makePingPong(w,h,fmt,filter){
    const a = makeFBO(w,h,fmt,filter);
    const b = makeFBO(w,h,fmt,filter);
    return {
      read: a, write: b,
      swap(){ const t = this.read; this.read = this.write; this.write = t; }
    };
  }

  // Simulation parameters
  const params = {
    SIM_OVERSAMPLE: 2.0,   // >1.0 increases internal resolution for finer eddies
    DYE_OVERSAMPLE: 2.0,
    dtClamp: 1/60,
    dissipationVel: 0.000,
    dissipationDye: 0.006,
    gravity: 0.45,         // downward accel
    vorticity: 30.0,
    pressureIters: 50,
    obstacleInflate: 6     // px
  };

  const sim = {
    vel: null, dye: null, pres: null, div: null, curl: null, obst: null,
    obstCanvas: document.createElement('canvas'),
    obstCtx: null,
    lastT: performance.now(),
    resize(){
      const W = (canvas.width)|0, H = (canvas.height)|0;

      const sw = clamp(Math.floor(W * params.SIM_OVERSAMPLE), 16, maxTex);
      const sh = clamp(Math.floor(H * params.SIM_OVERSAMPLE), 16, maxTex);
      const dw = clamp(Math.floor(W * params.DYE_OVERSAMPLE), 16, maxTex);
      const dh = clamp(Math.floor(H * params.DYE_OVERSAMPLE), 16, maxTex);

      // Create or recreate targets
      this.vel  = makePingPong(sw, sh, fmt.vel);
      this.dye  = makePingPong(dw, dh, fmt.dye);
      this.pres = makePingPong(sw, sh, fmt.pres, gl.NEAREST);
      this.div  = makeFBO(sw, sh, fmt.scal, gl.NEAREST);
      this.curl = makeFBO(sw, sh, fmt.scal, gl.NEAREST);
      this.obst = makeFBO(sw, sh, { int: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE }, gl.NEAREST);

      // Obstacles canvas
      this.obstCanvas.width = sw;
      this.obstCanvas.height = sh;
      this.obstCtx = this.obstCanvas.getContext('2d', { alpha: false });
      this.measureObstacles();
    },

    measureObstacles(){
      const ctx2 = this.obstCtx;
      if (!ctx2) return;
      const sw = this.vel.read.w, sh = this.vel.read.h;
      ctx2.clearRect(0,0,sw,sh);
      // fluid = white
      ctx2.fillStyle = 'white';
      ctx2.fillRect(0,0,sw,sh);

      const inflate = params.obstacleInflate;
      const els = [document.querySelector('.brand'), ...document.querySelectorAll('.link')].filter(Boolean);
      const ww = window.innerWidth, hh = window.innerHeight;
      ctx2.fillStyle = 'black';
      for (const el of els){
        const r = el.getBoundingClientRect();
        const x = (Math.max(0, r.left - inflate) / ww) * sw;
        const y = (Math.max(0, r.top  - inflate) / hh) * sh;
        const w = ((r.width  + inflate*2) / ww) * sw;
        const h = ((r.height + inflate*2) / hh) * sh;
        ctx2.fillRect(x, y, w, h);
      }
      // Add a thin floor so smoke pools
      ctx2.fillRect(0, sh - Math.max(2, Math.floor(2 * params.SIM_OVERSAMPLE)), sw, sh);

      // Upload to GL
      gl.bindTexture(gl.TEXTURE_2D, this.obst.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, sw, sh, 0, gl.RED, gl.UNSIGNED_BYTE, ctx2.getImageData(0,0,sw,sh).data);
    },

    step(now){
      const dt = Math.min(params.dtClamp, (now - this.lastT) / 1000);
      this.lastT = now;

      gl.bindVertexArray(quadVAO);

      // Curl
      gl.useProgram(P_CURL);
      set2(P_CURL, 'u_texel', 1/this.vel.read.w, 1/this.vel.read.h);
      bindTex(P_CURL, 'u_velocity', 0, this.vel.read.tex);
      drawTo(this.curl.fbo, this.vel.read.w, this.vel.read.h);

      // Forces
      gl.useProgram(P_FORCE);
      set2(P_FORCE, 'u_texel', 1/this.vel.read.w, 1/this.vel.read.h);
      set1(P_FORCE, 'u_dt', dt);
      set1(P_FORCE, 'u_gravity', params.gravity);
      set1(P_FORCE, 'u_vorticity', params.vorticity);
      bindTex(P_FORCE, 'u_velocity', 0, this.vel.read.tex);
      bindTex(P_FORCE, 'u_curl',     1, this.curl.tex);
      bindTex(P_FORCE, 'u_obstacles',2, this.obst.tex);
      drawTo(this.vel.write.fbo, this.vel.read.w, this.vel.read.h); this.vel.swap();

      // Advect velocity
      gl.useProgram(P_ADVECT);
      set2(P_ADVECT, 'u_texel', 1/this.vel.read.w, 1/this.vel.read.h);
      set1(P_ADVECT, 'u_dt', dt);
      set1(P_ADVECT, 'u_dissipation', params.dissipationVel);
      bindTex(P_ADVECT, 'u_velocity', 0, this.vel.read.tex);
      bindTex(P_ADVECT, 'u_source',   1, this.vel.read.tex);
      bindTex(P_ADVECT, 'u_obstacles',2, this.obst.tex);
      drawTo(this.vel.write.fbo, this.vel.read.w, this.vel.read.h); this.vel.swap();

      // Divergence
      gl.useProgram(P_DIVER);
      set2(P_DIVER, 'u_texel', 1/this.vel.read.w, 1/this.vel.read.h);
      bindTex(P_DIVER, 'u_velocity', 0, this.vel.read.tex);
      bindTex(P_DIVER, 'u_obstacles',1, this.obst.tex);
      drawTo(this.div.fbo, this.vel.read.w, this.vel.read.h);

      // Pressure solve
      gl.useProgram(P_PRESS);
      set2(P_PRESS, 'u_texel', 1/this.vel.read.w, 1/this.vel.read.h);
      bindTex(P_PRESS, 'u_divergence', 1, this.div.tex);
      bindTex(P_PRESS, 'u_obstacles',  2, this.obst.tex);
      // Clear pressure
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.pres.read.fbo);
      gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
      for (let i=0;i<params.pressureIters;i++){
        bindTex(P_PRESS, 'u_pressure', 0, this.pres.read.tex);
        drawTo(this.pres.write.fbo, this.vel.read.w, this.vel.read.h);
        this.pres.swap();
      }

      // Subtract gradient
      gl.useProgram(P_GRAD);
      set2(P_GRAD, 'u_texel', 1/this.vel.read.w, 1/this.vel.read.h);
      bindTex(P_GRAD, 'u_velocity', 0, this.vel.read.tex);
      bindTex(P_GRAD, 'u_pressure', 1, this.pres.read.tex);
      bindTex(P_GRAD, 'u_obstacles',2, this.obst.tex);
      drawTo(this.vel.write.fbo, this.vel.read.w, this.vel.read.h); this.vel.swap();

      // Emit ultra-fine dye and downward velocity along the top in multiple wispy jets
      const time = now * 0.001;
      const jets = 7;
      for (let i=0;i<jets;i++){
        const ph = i / jets;
        const u = 0.1 + 0.8 * ph + 0.05*Math.sin(time*0.9 + i*1.13);
        const r = 0.025 + 0.015*Math.sin(time*1.7 + i*2.3);
        const str = 0.9 + 0.4*Math.sin(time*2.1 + i*0.7);

        // Velocity brush (downward)
        gl.useProgram(P_BRVEL);
        set2(P_BRVEL, 'u_texel', 1/this.vel.read.w, 1/this.vel.read.h);
        bindTex(P_BRVEL, 'u_target', 0, this.vel.read.tex);
        set4(P_BRVEL, 'u_brush', u, 0.02, r, 1.0);
        gl.uniform2f(gl.getUniformLocation(P_BRVEL, 'u_dir'), 0.0, 0.65);
        drawTo(this.vel.write.fbo, this.vel.read.w, this.vel.read.h); this.vel.swap();

        // Dye brush
        gl.useProgram(P_BRDYE);
        set2(P_BRDYE, 'u_texel', 1/this.dye.read.w, 1/this.dye.read.h);
        bindTex(P_BRDYE, 'u_target', 0, this.dye.read.tex);
        set4(P_BRDYE, 'u_brush', u, 0.02, r, str * 0.8);
        set1(P_BRDYE, 'u_decay', 0.005);
        drawTo(this.dye.write.fbo, this.dye.read.w, this.dye.read.h); this.dye.swap();
      }

      // Advect dye
      gl.useProgram(P_ADVECT);
      set2(P_ADVECT, 'u_texel', 1/this.dye.read.w, 1/this.dye.read.h);
      set1(P_ADVECT, 'u_dt', dt);
      set1(P_ADVECT, 'u_dissipation', params.dissipationDye);
      bindTex(P_ADVECT, 'u_velocity', 0, this.vel.read.tex);
      bindTex(P_ADVECT, 'u_source',   1, this.dye.read.tex);
      bindTex(P_ADVECT, 'u_obstacles',2, this.obst.tex);
      drawTo(this.dye.write.fbo, this.dye.read.w, this.dye.read.h); this.dye.swap();

      // Render
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0,0,canvas.width, canvas.height);
      gl.useProgram(P_REND);
      bindTex(P_REND, 'u_dye', 0, this.dye.read.tex);
      set1(P_REND, 'u_gamma', 1.6);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  };

  function set1(p, name, v){ gl.uniform1f(gl.getUniformLocation(p, name), v); }
  function set2(p, name, x,y){ gl.uniform2f(gl.getUniformLocation(p, name), x,y); }
  function set4(p, name, a,b,c,d){ gl.uniform4f(gl.getUniformLocation(p, name), a,b,c,d); }
  function bindTex(p, name, unit, tex){
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(p, name), unit);
  }
  function drawTo(fbo, w, h){
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0,0,w,h);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // Kick
  let last = performance.now();
  function loop(now){
    sim.step(now);
    requestAnimationFrame(loop);
  }
  function kick(){ resize(); requestAnimationFrame(loop); }
  // initial resize
  dpr = Math.max(1, window.devicePixelRatio||1);
  kick();
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
