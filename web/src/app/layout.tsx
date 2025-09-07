import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, VT323 } from "next/font/google";
import "./globals.css";

const jetbrains = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const vt323 = VT323({
  variable: "--font-vt323",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HoppCX .NFO",
  description: "Retro ANSI/ASCII terminal profile",
  icons: {
    icon: "/assets/icons/faceit.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark">
      <head />
      <body className={`${jetbrains.variable} ${vt323.variable} antialiased`}>
        {children}
        {/* SVG filter defs for CRT warp/vignette */}
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
          <defs>
            <filter id="crt-barrel">
              {/* Radial displacement map: bright center -> dark edges */}
              <feImage
                result="rad"
                href={
                  "data:image/svg+xml;utf8," +
                  encodeURIComponent(
                    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>\n` +
                      `<defs><radialGradient id='g' cx='50%' cy='50%' r='80%'>\n` +
                        `<stop offset='0%' stop-color='rgb(200,200,200)'/>\n` +
                        `<stop offset='70%' stop-color='rgb(120,120,120)'/>\n` +
                        `<stop offset='100%' stop-color='rgb(0,0,0)'/>\n` +
                      `</radialGradient></defs>\n` +
                      `<rect width='100' height='100' fill='url(#g)'/>\n` +
                    `</svg>`
                  )
                }
                preserveAspectRatio="none"
                x="0" y="0" width="100%" height="100%"
              />
              <feDisplacementMap in="SourceGraphic" in2="rad" scale="7" xChannelSelector="R" yChannelSelector="G"/>
            </filter>
            <filter id="crt-split" colorInterpolationFilters="sRGB">
              {/* Edge-strength mask: 0 center -> 1 edges */}
              <feImage
                result="edge"
                href={
                  "data:image/svg+xml;utf8," +
                  encodeURIComponent(
                    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>\n` +
                      `<defs><radialGradient id='g' cx='50%' cy='50%' r='75%'>\n` +
                        `<stop offset='0%' stop-color='rgb(0,0,0)'/>\n` +
                        `<stop offset='65%' stop-color='rgb(50,50,50)'/>\n` +
                        `<stop offset='100%' stop-color='rgb(255,255,255)'/>\n` +
                      `</radialGradient></defs>\n` +
                      `<rect width='100' height='100' fill='url(#g)'/>\n` +
                    `</svg>`
                  )
                }
                preserveAspectRatio="none"
                x="0" y="0" width="100%" height="100%"
              />
              {/* Isolate channels */}
              <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="R"/>
              <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="G"/>
              <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="B"/>
              {/* Small per-channel offsets */}
              <feOffset in="R" dx="0.35" dy="0.2" result="Rshift"/>
              <feOffset in="B" dx="-0.35" dy="-0.2" result="Bshift"/>
              {/* Mask stronger at edges */}
              <feComposite in="Rshift" in2="edge" operator="in" result="Redge"/>
              <feComposite in="Bshift" in2="edge" operator="in" result="Bedge"/>
              {/* Merge channels */}
              <feMerge>
                <feMergeNode in="Redge"/>
                <feMergeNode in="G"/>
                <feMergeNode in="Bedge"/>
              </feMerge>
            </filter>
          </defs>
        </svg>
      </body>
    </html>
  );
}
