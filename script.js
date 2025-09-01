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

// Subtle 3D tilt with spring physics
function tilt(){
  const links = document.querySelectorAll('.link');
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  let orientX = 0, orientY = 0;
  if (typeof DeviceOrientationEvent !== 'undefined') {
    window.addEventListener('deviceorientation', (e) => {
      orientX = clamp(e.beta / 10, -6, 6);
      orientY = clamp(e.gamma / 10, -8, 8);
    });
  }

  links.forEach((el) => {
    let tiltX = 0, tiltY = 0;
    let targetX = 0, targetY = 0;
    let vx = 0, vy = 0;
    let usingPointer = false;
    let lastTX = 0, lastTY = 0;

    const animate = () => {
      const tx = usingPointer ? targetX : orientX;
      const ty = usingPointer ? targetY : orientY;

      const ax = (tx - tiltX) * 0.1;
      const ay = (ty - tiltY) * 0.1;
      vx = (vx + ax) * 0.8;
      vy = (vy + ay) * 0.8;
      tiltX += vx;
      tiltY += vy;

      el.style.setProperty('--tiltX', tiltX.toFixed(2) + 'deg');
      el.style.setProperty('--tiltY', tiltY.toFixed(2) + 'deg');
      requestAnimationFrame(animate);
    };
    animate();

    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      const nx = clamp((0.5 - py) * 6, -6, 6);
      const ny = clamp((px - 0.5) * 8, -8, 8);

      vx += (nx - lastTX) * 0.2;
      vy += (ny - lastTY) * 0.2;
      lastTX = nx;
      lastTY = ny;

      targetX = nx;
      targetY = ny;
      usingPointer = true;
    };

    const onLeave = () => { usingPointer = false; };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onLeave);
    el.addEventListener('touchstart', onLeave, {passive:true});
    el.addEventListener('touchend', onLeave, {passive:true});
  });
}

tilt();
