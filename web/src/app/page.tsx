import ClientEffects from "@/components/ClientEffects";
import NfoBanner from "@/components/NfoBanner";
import LensWarp from "@/components/LensWarp";
import { profileLinks, gameLinks, otherLinks } from "@/data/links";

export default function Home() {
  return (
    <>
      <ClientEffects />
      <main className="shell crt">
        <div className="terminal" role="region" aria-label="NFO Viewer">
          <div className="titlebar">
            <span className="dots"><span className="dot" /><span className="dot" /><span className="dot" /></span>
            <span className="title">HOPPCX.NFO — ansi/2025</span>
          </div>
          <div className="screen">
            <NfoBanner />
            <ul className="nfo-list" aria-label="Links">
              {profileLinks.map((l) => (
                <li key={l.id} className="nfo-item">
                  <span className="nfo-key">{l.label}</span>
                  <span className="nfo-arrow">→</span>
                  <a href={l.href} target="_blank" rel="noopener noreferrer">
                    {l.href}
                  </a>
                </li>
              ))}
              {gameLinks.map((l) => (
                <li key={l.id} className="nfo-item">
                  <span className="nfo-key">{l.ariaLabel}</span>
                  <span className="nfo-arrow">→</span>
                  <a href={l.href} target="_blank" rel="noopener noreferrer">
                    {l.href}
                  </a>
                </li>
              ))}
              {otherLinks.map((l) => (
                <li key={l.id} className="nfo-item">
                  <span className="nfo-key">{l.label}</span>
                  <span className="nfo-arrow">→</span>
                  <a href={l.href} target="_blank" rel="noopener noreferrer">
                    {l.href}
                  </a>
                </li>
              ))}
            </ul>
            {/* WebGL lens warp overlay (visual only, clicks pass through) */}
            <LensWarp />
          </div>
        </div>
      </main>
    </>
  );
}
