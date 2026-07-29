import type { Metadata, Viewport } from "next";
import { Chakra_Petch, Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import "./hud.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
  display: "swap",
});

// Instrument faces for the Lifecycle console. Chakra Petch has clipped,
// angular corners that read as machined rather than typeset. JetBrains Mono
// keeps every readout on a fixed grid so figures don't jitter as they update.
const chakraPetch = Chakra_Petch({
  subsets: ["latin"],
  variable: "--font-instrument",
  weight: ["500", "600", "700"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-readout",
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Campaign Desk | Marketing Empire Group",
  description:
    "Upload HTML email campaigns, share a magic link, and collect feedback.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} ${chakraPetch.variable} ${jetbrainsMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
