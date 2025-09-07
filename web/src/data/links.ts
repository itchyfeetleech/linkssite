export type LinkItem = {
  id: string;
  label?: string;
  href: string;
  icon?: string; // path under /public
  ariaLabel?: string;
};

export const profileLinks: LinkItem[] = [
  {
    id: "faceit",
    label: "FaceIT",
    href: "https://www.faceit.com/en/players/HoppCX",
    icon: "/assets/icons/faceit.svg",
  },
  {
    id: "leetify",
    label: "Leetify",
    href: "https://leetify.com/app/profile/76561198198305361",
    icon: "/assets/icons/leetify.svg",
  },
];

export const gameLinks: LinkItem[] = [
  {
    id: "deadlock",
    ariaLabel: "Deadlock",
    href: "https://tracklock.gg/players/238039633",
    icon: "/assets/icons/deadlock.svg",
  },
  {
    id: "valorant",
    ariaLabel: "Valorant",
    href: "https://tracker.gg/valorant/profile/riot/HoppCX%23000/",
    icon: "/assets/icons/valorant.svg",
  },
  {
    id: "overwatch",
    ariaLabel: "Overwatch",
    href: "https://www.overbuff.com/players/HoppCX-1509",
    icon: "/assets/icons/overwatch.svg",
  },
  {
    id: "marvel",
    ariaLabel: "Marvel Rivals",
    href: "https://tracker.gg/marvel-rivals/profile/ign/HoppCX/",
    icon: "/assets/icons/marvel-rivals.svg",
  },
];

export const otherLinks: LinkItem[] = [
  {
    id: "youtube",
    label: "YouTube",
    href: "https://www.youtube.com/@HoppCX",
    icon: "/assets/icons/youtube.svg",
  },
];

export const allLinks = {
  profile: profileLinks,
  games: gameLinks,
  other: otherLinks,
};

