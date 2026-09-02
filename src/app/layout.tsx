import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Poppins, Space_Grotesk } from "next/font/google";
import "./globals.css";
import "./hud.css";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

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

const poppins = Poppins({
  subsets: ["latin"],
  variable: "--font-poppins",
  weight: ["600", "700", "800"],
  display: "swap",
});

// Kept for figures only: a fixed grid stops columns of numbers jittering as
// they update. Chakra Petch went with the Lifecycle console styling — nothing
// references --font-instrument any more.
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
      className={`${inter.variable} ${spaceGrotesk.variable} ${poppins.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Stamps data-theme before first paint, so a dark-mode user never gets
            a white flash. It has to be inline and blocking for that to hold;
            anything React-driven runs after the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
