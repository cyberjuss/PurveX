import { headers } from "next/headers";
import "./globals.css";
import { Geist, Space_Grotesk } from "next/font/google";
import RootClientLayout from "./root-client";

const inter = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-space-grotesk",
  weight: ["400", "500", "600", "700"],
});

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = (await headers()).get("x-nonce") || undefined;

  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} bg-background`}
      suppressHydrationWarning
    >
      <head>
        <link rel="icon" href="/purvex-favicon.svg" />
        <link rel="apple-touch-icon" sizes="180x180" href="/logo.png?v=6" />
        <link rel="shortcut icon" href="/purvex-favicon.svg" />
        {nonce ? <meta name="csp-nonce" content={nonce} /> : null}
      </head>
      <body className={`${inter.className} text-foreground`} suppressHydrationWarning>
        <RootClientLayout>{children}</RootClientLayout>
      </body>
    </html>
  );
}
