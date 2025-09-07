import type { Metadata, Viewport } from "next";
import { Manrope, Nabla } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const nabla = Nabla({
  variable: "--font-nabla",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "hoppcx.top",
  description: "Brief description of hoppcx.top",
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
      <body className={`${manrope.variable} ${nabla.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
