import ClientEffects from "@/components/ClientEffects";
import { profileLinks, gameLinks, otherLinks } from "@/data/links";
import Image from "next/image";

export default function Home() {
  return (
    <>
      <ClientEffects />
      <main className="shell">
        <section className="hero">
          <h1 className="brand" aria-label="HoppCX">HoppCX</h1>
        </section>

        <nav className="link-grid" aria-label="Profile Links">
          <div className="link info-box" contentEditable={false}>
            <span>
              9800X3D @ 5.7GHZ
              <br />
              op1we + obsidian dots @ 50cm on glass pad
              <br />
              Fun60proHE + 240hz
            </span>
          </div>

          {profileLinks.map((l) => (
            <a
              key={l.id}
              id={l.id}
              className={`link brand-${l.id}`}
              href={l.href}
              target="_blank"
              rel="noopener"
            >
              {l.icon && (
                <Image
                  className="icon"
                  src={l.icon}
                  alt=""
                  aria-hidden
                  width={32}
                  height={32}
                />
              )}
              <span>{l.label}</span>
            </a>
          ))}

          <div className="game-grid">
            {gameLinks.map((l) => (
              <a
                key={l.id}
                id={l.id}
                className={`link brand-${l.id}`}
                href={l.href}
                target="_blank"
                rel="noopener"
                aria-label={l.ariaLabel}
              >
                {l.icon && (
                  <Image
                    className="icon game-icon"
                    src={l.icon}
                    alt=""
                    aria-hidden
                    width={56}
                    height={56}
                  />
                )}
              </a>
            ))}
          </div>

          {otherLinks.map((l) => (
            <a
              key={l.id}
              id={l.id}
              className={`link brand-${l.id}`}
              href={l.href}
              target="_blank"
              rel="noopener"
            >
              {l.icon && (
                <Image
                  className="icon"
                  src={l.icon}
                  alt=""
                  aria-hidden
                  width={32}
                  height={32}
                />
              )}
              <span>{l.label}</span>
            </a>
          ))}
        </nav>
      </main>
    </>
  );
}

