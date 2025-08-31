// 1) Edit your links here. Placeholders keep the buttons visible.


// 3) Staggered reveal
(function stagger(){
document.querySelectorAll('.link-row').forEach((row, i) => {
row.style.setProperty('--i', i + 1);
});
})();


// 4) Theme toggle with persistence
(function themeToggle(){
const root = document.documentElement;
const btn = document.getElementById('themeToggle');
const metaTheme = document.querySelector('meta[name="theme-color"]');


const setTheme = (mode) => {
const isLight = mode === 'light';
root.setAttribute('data-theme', isLight ? 'light' : 'dark');
localStorage.setItem('theme', isLight ? 'light' : 'dark');
// Match the header bg color for better mobile address bar contrast
metaTheme && (metaTheme.content = isLight ? '#f6f7fb' : '#0b0f1a');
};


// initial
const saved = localStorage.getItem('theme');
if (saved === 'light' || saved === 'dark') setTheme(saved);
// else leave as default in HTML


// click
btn?.addEventListener('click', () => {
const next = (document.documentElement.getAttribute('data-theme') === 'light') ? 'dark' : 'light';
setTheme(next);
});
})();


// 5) Copy-to-clipboard buttons
(function copyButtons(){
const toast = document.getElementById('toast');


const showToast = (msg) => {
if (!toast) return;
toast.textContent = msg;
toast.hidden = false;
clearTimeout(showToast._t);
showToast._t = setTimeout(() => { toast.hidden = true; }, 1200);
};


document.querySelectorAll('button.copy').forEach((btn) => {
btn.addEventListener('click', async () => {
const key = btn.getAttribute('data-key');
const url = window.LINKS?.[key];
if (!url || typeof url !== 'string' || url === '#') {
showToast('No link set');
return;
}
try {
await navigator.clipboard.writeText(url);
showToast('Copied');
} catch (err) {
// Fallback if clipboard API is unavailable
const ta = document.createElement('textarea');
ta.value = url; document.body.appendChild(ta); ta.select();
try { document.execCommand('copy'); showToast('Copied'); }
catch { showToast('Copy failed'); }
finally { document.body.removeChild(ta); }
}
});
});
})();
