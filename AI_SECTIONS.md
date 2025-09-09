Canonical UI Sections

These identifiers name the core displayed sections/elements of the site. They are applied to DOM nodes via the `data-section` attribute and exported in `web/src/lib/sections.ts` for reuse in code, tests, and tooling.

Primary Layout
- SHELL_ROOT: Main page container (`main.shell.crt`).
- TERMINAL_WINDOW: Window chrome around content (`div.terminal`).
- TERMINAL_TITLEBAR: The terminal titlebar row.
- TITLEBAR_DOTS: The three dots on the titlebar.
- TITLEBAR_TITLE: The title text in the titlebar.
- SCREEN_VIEWPORT: Scrollable content area inside the terminal (`div.screen`).

Content
- ASCII_BANNER: Preformatted ASCII/NFO banner (`<pre.nfo>`).
- LINKS_LIST: The single list of all links (`<ul.nfo-list>`).
- LINK_ITEM: An individual link row (`<li.nfo-item>`). Carries `data-group` of `profile | games | other`.
- LINK_LABEL: The label cell in a link row (`<span.nfo-key>`).
- LINK_ARROW: The arrow glyph between label and URL (`<span.nfo-arrow>`).
- LINK_ANCHOR: The clickable link (`<a>`).

Visual Layers / Effects
- BACKGROUND_CANVAS: Fullscreen WebGL background (`#bgCanvas`).
- FOG_OVERLAY: Optional fog overlay on background (`#fogOverlay`).
- LENS_WARP_CANVAS: WebGL canvas that lens-warps the screen content.
- BOOT_OVERLAY: Initial black overlay that hides the DOM until WebGL is ready.

See also
- TS constants: `web/src/lib/sections.ts`
- Usage examples: `web/src/app/page.tsx`, `web/src/components/*.tsx`
