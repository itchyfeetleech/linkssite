import ClientEffects from "@/components/ClientEffects";
import NfoBanner from "@/components/NfoBanner";
import LensWarp from "@/components/LensWarp";
import { profileLinks, gameLinks, otherLinks } from "@/data/links";
import { Sections, LinkGroups } from "@/lib/sections";

export default function Home() {
  return (
    <>
      {/* Wrap the entire scene so the CRT can postprocess full viewport */}
      <div id="crt-scene" className="crt-scene" data-section={Sections.SHELL_ROOT}>
        <ClientEffects />
        <main className="desktop crt" role="application" aria-label="Desktop Shell">
          {/* Simple OS-like top bar */}
          <div className="topbar" aria-hidden>
            <div className="brand">linksshell</div>
            <div className="status">
              <span className="badge hq">CRT HQ</span>
            </div>
          </div>

          {/* Program window: terminal content */}
          <div className="terminal window" role="region" aria-label="NFO Viewer" data-section={Sections.TERMINAL_WINDOW}>
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
                    <span className="nfo-arrow">\u001a</span>
                    <a href={l.href} target="_blank" rel="noopener noreferrer">
                      {l.href}
                    </a>
                  </li>
                ))}
                {gameLinks.map((l) => (
                  <li key={l.id} className="nfo-item" data-section={Sections.LINK_ITEM} data-group={LinkGroups.GAMES}>
                    <span className="nfo-key">{l.ariaLabel}</span>
                    <span className="nfo-arrow">\u001a</span>
                    <a href={l.href} target="_blank" rel="noopener noreferrer">
                      {l.href}
                    </a>
                  </li>
                ))}
                {otherLinks.map((l) => (
                  <li key={l.id} className="nfo-item" data-section={Sections.LINK_ITEM} data-group={LinkGroups.OTHER}>
                    <span className="nfo-key">{l.label}</span>
                    <span className="nfo-arrow">\u001a</span>
                    <a href={l.href} target="_blank" rel="noopener noreferrer">
                      {l.href}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Optional: simple dock placeholder */}
          <div className="dock" aria-hidden>
            <div className="icon" title="Links" />
            <div className="icon" title="Games" />
            <div className="icon" title="Other" />
          </div>
        </main>

        {/* Full-viewport CRT pipeline overlay: captures crt-scene excluding itself */}
        <LensWarp />
      </div>
    </>
  );
}
