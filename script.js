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