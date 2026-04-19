import { headers } from "next/headers";
import "./globals.css";
import RootClientLayout from "./root-client";

// Use a system font stack so the build never requires network access to
// Google Fonts. The CSS variables --font-inter and --font-space-grotesk are
// defined in globals.css and consumed by Tailwind via font-sans/font-display.
const inter = { variable: "", className: "" } as const;
const spaceGrotesk = { variable: "" } as const;

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
