// User links. Replace the '#' with your URLs.
window.LINKS = {
  faceit:   "#",
  leetify:  "#",
  deadlock: "#",
  valorant: "#",
  overwatch:"#",
  marvel:   "#",
  youtube:  "#"
};

// Apply links
(function applyLinks(){
  const ids = ["faceit","leetify","deadlock","valorant","overwatch","marvel","youtube"];
  ids.forEach((id) => {
    const a = document.getElementById(id);
    const url = window.LINKS[id];
    if (a && url && typeof url === 'string') a.href = url;
  });
})();

// Theme toggle with persistence
(function themeToggle(){
  const root = document.documentElement;
  const btn = document.getElementById('themeToggle');
  const metaTheme = document.querySelector('meta[name="theme-color"]');

  const setTheme = (mode) => {
    const isLight = mode === 'light';
    root.setAttribute('data-theme', isLight ? 'light' : 'dark');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    if (metaTheme) metaTheme.content = isLight ? '#f6f7fb' : '#0b0f1a';
  };

  const saved = localStorage.getItem('theme');
  if (saved === 'light' || saved === 'dark') setTheme(saved);

  btn?.addEventListener('click', () => {
    const next = (root.getAttribute('data-theme') === 'light') ? 'dark' : 'light';
    setTheme(next);
  });
})();

// WebGL background animation
(function webglBG(){
  const canvas = document.getElementById('bgCanvas');
  const gl = canvas?.getContext('webgl');
  if (!canvas || !gl) return;

  const vertSrc = `
    attribute vec2 position;
    void main(){
      gl_Position = vec4(position, 0.0, 1.0);
    }
  `;
  const fragSrc = `
    precision mediump float;
    uniform vec2 u_res;
    uniform float u_time;
    uniform vec3 u_color1;
    uniform vec3 u_color2;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
    float noise(vec2 p){
      vec2 i = floor(p);
      vec2 f = fract(p);
      float a = hash(i);
      float b = hash(i + vec2(1.0,0.0));
      float c = hash(i + vec2(0.0,1.0));
      float d = hash(i + vec2(1.0,1.0));
      vec2 u = f*f*(3.0-2.0*f);
      return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
    }
    void main(){
      vec2 uv = gl_FragCoord.xy / u_res.xy;
      float n = noise(uv*3.0 + u_time*0.05);
      vec3 col = mix(u_color1, u_color2, n);
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function compile(type, src){
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  }

  const vs = compile(gl.VERTEX_SHADER, vertSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const posLoc = gl.getAttribLocation(prog, 'position');
  const timeLoc = gl.getUniformLocation(prog, 'u_time');
  const resLoc = gl.getUniformLocation(prog, 'u_res');
  const color1Loc = gl.getUniformLocation(prog, 'u_color1');
  const color2Loc = gl.getUniformLocation(prog, 'u_color2');

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1,-1, 1,-1, -1,1,
    -1,1, 1,-1, 1,1
  ]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc,2,gl.FLOAT,false,0,0);

  function resize(){
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    gl.viewport(0,0,canvas.width,canvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const root = document.documentElement;
  function setPalette(){
    const dark = [[96/255,165/255,250/255],[167/255,139/255,250/255]];
    const light = [[224/255,242/255,254/255],[237/255,233/255,254/255]];
    const isDark = root.getAttribute('data-theme') === 'dark' || (root.getAttribute('data-theme') !== 'light' && mq.matches);
    const palette = isDark ? dark : light;
    gl.uniform3fv(color1Loc, palette[0]);
    gl.uniform3fv(color2Loc, palette[1]);
  }
  mq.addEventListener('change', setPalette);
  new MutationObserver(setPalette).observe(root, {attributes:true, attributeFilter:['data-theme']});
  setPalette();

  function render(t){
    gl.uniform1f(timeLoc, t*0.001);
    gl.uniform2f(resLoc, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES,0,6);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
})();

// Subtle 3D tilt on hover
(function tilt(){
  const links = document.querySelectorAll('.link');
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  links.forEach((el) => {
    let raf = null;

    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      const rotY = clamp((px - 0.5) * 8, -8, 8);  // rotateY around vertical axis
      const rotX = clamp((0.5 - py) * 6, -6, 6);  // rotateX around horizontal axis
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
    el.addEventListener('touchstart', reset, {passive:true});
    el.addEventListener('touchend', reset, {passive:true});
  });
})();

// Ambient breathing of text weight
(function breathe(){
  const root = document.documentElement;
  let t = 0;
  setInterval(() => {
    const base = parseFloat(getComputedStyle(root).getPropertyValue('--wght-base')) || 600;
    const weight = base + Math.sin(t) * 50;
    root.style.setProperty('--wght', weight.toFixed(0));
    t += 0.04;
  }, 100);
})();