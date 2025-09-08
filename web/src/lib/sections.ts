/**
 * Canonical UI section identifiers used across the app.
 * Attach these via `data-section` to key DOM nodes so tools/tests/agents
 * can reliably target the same conceptual parts of the UI.
 */
export const Sections = {
  // Global overlays / effects
  BOOT_OVERLAY: "BOOT_OVERLAY",
  BACKGROUND_CANVAS: "BACKGROUND_CANVAS",
  FOG_OVERLAY: "FOG_OVERLAY",

  // Primary layout + terminal chrome
  SHELL_ROOT: "SHELL_ROOT",
  TERMINAL_WINDOW: "TERMINAL_WINDOW",
  TERMINAL_TITLEBAR: "TERMINAL_TITLEBAR",
  TITLEBAR_DOTS: "TITLEBAR_DOTS",
  TITLEBAR_TITLE: "TITLEBAR_TITLE",
  SCREEN_VIEWPORT: "SCREEN_VIEWPORT",

  // Content
  ASCII_BANNER: "ASCII_BANNER",
  LINKS_LIST: "LINKS_LIST",
  LINK_ITEM: "LINK_ITEM",
  LINK_LABEL: "LINK_LABEL",
  LINK_ARROW: "LINK_ARROW",
  LINK_ANCHOR: "LINK_ANCHOR",

  // Visual processing layers
  LENS_WARP_CANVAS: "LENS_WARP_CANVAS",
  COPPER_SCROLLER: "COPPER_SCROLLER",
} as const;

export type SectionKey = keyof typeof Sections;
export type SectionId = typeof Sections[SectionKey];

/**
 * Known logical link groups used in the single list.
 * Each <li> carries `data-group` with one of these identifiers.
 */
export const LinkGroups = {
  PROFILE: "profile",
  GAMES: "games",
  OTHER: "other",
} as const;

export type LinkGroup = typeof LinkGroups[keyof typeof LinkGroups];

