import ClientEffects from "@/components/ClientEffects";
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
            <pre className="nfo">{String.raw`
 _    _      ____       _____      _____      _____       __   __ 
| |  | |    / __ \     |  _  \    |  _  \    |  _  \     \ \ / / 
| |__| |   | |  | |    | |__) |   | |__) |   | |__) |     \ V /  
|  __  |   | |  | |    |  ___/    |  ___/    |  __/        > <   
| |  | |   | |__| |    | |        | |        | |          / . \  
|_|  |_|    \____/     |_|        |_|        |_|         /_/ \_\ 

   .nfo viewer re: hoppcx.top
   ───────────────────────────────────────
   sys: 9800X3D @ 5.7GHZ
   aim: op1we + obsidian dots @ 50cm on glass pad
   keys: Fun60proHE + 240hz

   links:
`}</pre>
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
          </div>
        </div>
      </main>
    </>
  );
}

