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
            <filter id="crt-warp">
              <feTurbulence type="fractalNoise" baseFrequency="0.002 0.003" numOctaves="1" seed="2" result="noise"/>
              <feColorMatrix type="saturate" values="0" in="SourceGraphic" result="gray"/>
              <feGaussianBlur in="gray" stdDeviation="80" result="blur"/>
              <feDisplacementMap in="SourceGraphic" in2="blur" scale="6" xChannelSelector="R" yChannelSelector="G"/>
            </filter>
          </defs>
        </svg>
      </body>
    </html>
  );
}
