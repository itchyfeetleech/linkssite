// Base64-embedded ASCII art to avoid any encoding/escaping issues in source.
// Decoded at runtime so backslashes and trailing spaces are preserved.
const ASCII_BANNER_B64 = "ICAgICAgICAsLS0sICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgDQogICAgICAsLS0uJ3wgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICwtLS0tLi4gICAsLS0sICAgICAsLS0sICANCiAgICwtLSwgIHwgOiAgICAgICAgICAsLS4tLS0tLiAgLC0uLS0tLS4gICAvICAgLyAgIFwgIHwnLiBcICAgLyAuYHwgIA0KLC0tLS4nfCAgOiAnICAgLC0tLS4gIFwgICAgLyAgXCBcICAgIC8gIFwgfCAgIDogICAgIDogOyBcIGBcIC8nIC8gOyAgDQp8ICAgfCA6IF8nIHwgICcgICAsJ1wgfCAgIDogICAgfHwgICA6ICAgIHwuICAgfCAgOy4gLyBgLiBcICAvICAvIC4nICANCjogICA6IHwuJyAgfCAvICAgLyAgIHx8ICAgfCAuXCA6fCAgIHwgLlwgOi4gICA7IC8tLWAgICBcICBcLyAgLyAuLyAgIA0KfCAgICcgJyAgOyA6LiAgIDsgLC4gOi4gICA6IHw6IHwuICAgOiB8OiB8OyAgIHwgOyAgICAgICBcICBcLicgIC8gICAgDQonICAgfCAgLicuIHwnICAgfCB8OiA6fCAgIHwgIFwgOnwgICB8ICBcIDp8ICAgOiB8ICAgICAgICBcICA7ICA7ICAgICANCnwgICB8IDogIHwgJycgICB8IC47IDp8ICAgOiAuICB8fCAgIDogLiAgfC4gICB8ICdfX18gICAgLyBcICBcICBcICAgIA0KJyAgIDogfCAgOiA7fCAgIDogICAgfDogICAgIHxgLSc6ICAgICB8YC0nJyAgIDsgOiAuJ3wgIDsgIC9cICBcICBcICAgDQp8ICAgfCAnICAsLyAgXCAgIFwgIC8gOiAgIDogOiAgIDogICA6IDogICAnICAgfCAnLyAgOi4vX187ICBcICA7ICBcICANCjsgICA6IDstLScgICAgYC0tLS0nICB8ICAgfCA6ICAgfCAgIHwgOiAgIHwgICA6ICAgIC8gfCAgIDogLyBcICBcICA7IA0KfCAgICwvICAgICAgICAgICAgICAgIGAtLS0nLnwgICBgLS0tJy58ICAgIFwgICBcIC4nICA7ICAgfC8gICBcICAnIHwgDQonLS0tJyAgICAgICAgICAgICAgICAgICBgLS0tYCAgICAgYC0tLWAgICAgIGAtLS1gICAgIGAtLS0nICAgICBgLS1gIA==";

function decodeBase64ToBinaryString(b64: string): string {
  // Prefer native atob in browsers
  if (typeof globalThis !== "undefined" && typeof (globalThis as unknown as { atob?: (s: string) => string }).atob === "function") {
    try {
      return (globalThis as unknown as { atob: (s: string) => string }).atob(b64);
    } catch {}
  }
  // Minimal base64 decoder (no UTF-8 conversion; returns binary string)
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const map = new Int16Array(256).fill(-1);
  for (let i = 0; i < alphabet.length; i++) map[alphabet.charCodeAt(i)] = i;
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < b64.length; i++) {
    const c = b64.charCodeAt(i);
    if (c === 61) { // '=' padding
      break;
    }
    const v = map[c];
    if (v === -1) continue; // skip whitespace or invalid
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      const byte = (buffer >> bits) & 0xff;
      out += String.fromCharCode(byte);
    }
  }
  return out;
}

export const ASCII_BANNER: string = decodeBase64ToBinaryString(ASCII_BANNER_B64);
