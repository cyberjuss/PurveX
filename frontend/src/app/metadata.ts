import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PurveX",
  description: "Help security teams move from uncertainty to confidence with validation that improves their work, growth, and long-term future.",
  icons: {
    icon: [
      { url: "/purvex-favicon.svg", type: "image/svg+xml", sizes: "any" },
      { url: "/icon.png", type: "image/png", sizes: "256x256" },
      { url: "/favicon.ico", type: "image/x-icon", sizes: "any" },
    ],
    shortcut: "/purvex-favicon.svg",
    apple: "/icon.png",
  },
};
