import ClientEffects from "@/components/ClientEffects";
import NfoBanner from "@/components/NfoBanner";
import LensWarp from "@/components/LensWarp";
import { profileLinks, gameLinks, otherLinks } from "@/data/links";
import { Sections, LinkGroups } from "@/lib/sections";

export default function Home() {
  return (
    <>
      <ClientEffects />
      <main className="shell crt" data-section={Sections.SHELL_ROOT}>
        <div className="terminal" role="region" aria-label="NFO Viewer" data-section={Sections.TERMINAL_WINDOW}>
          <div className="titlebar" data-section={Sections.TERMINAL_TITLEBAR}>
            <span className="dots" data-section={Sections.TITLEBAR_DOTS}><span className="dot" /><span className="dot" /><span className="dot" /></span>
            <span className="title" data-section={Sections.TITLEBAR_TITLE}>HOPPCX.NFO - ansi/2025</span>
          </div>
          <div className="screen" data-section={Sections.SCREEN_VIEWPORT}>
            {/* ASCII_BANNER */}
            <NfoBanner />
            <ul className="nfo-list" aria-label="Links" data-section={Sections.LINKS_LIST}>
              {profileLinks.map((l) => (
                <li key={l.id} className="nfo-item" data-section={Sections.LINK_ITEM} data-group={LinkGroups.PROFILE}>
                  <span className="nfo-key">{l.label}</span>
                  <span className="nfo-arrow">→</span>
                  <a href={l.href} target="_blank" rel="noopener noreferrer">
                    {l.href}
                  </a>
                </li>
              ))}
              {gameLinks.map((l) => (
                <li key={l.id} className="nfo-item" data-section={Sections.LINK_ITEM} data-group={LinkGroups.GAMES}>
                  <span className="nfo-key">{l.ariaLabel}</span>
                  <span className="nfo-arrow">→</span>
                  <a href={l.href} target="_blank" rel="noopener noreferrer">
                    {l.href}
                  </a>
                </li>
              ))}
              {otherLinks.map((l) => (
                <li key={l.id} className="nfo-item" data-section={Sections.LINK_ITEM} data-group={LinkGroups.OTHER}>
                  <span className="nfo-key">{l.label}</span>
                  <span className="nfo-arrow">→</span>
                  <a href={l.href} target="_blank" rel="noopener noreferrer">
                    {l.href}
                  </a>
                </li>
              ))}
            </ul>
            {/* WebGL lens warp overlay */}
            <LensWarp />
          </div>
        </div>
      </main>
    </>
  );
}
