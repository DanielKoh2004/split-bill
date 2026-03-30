import type { Metadata } from "next";
import "./globals.css";
import { AppProvider } from "@/src/ThemeContext";

export const metadata: Metadata = {
  title: "SplitBill — Claim Your Share",
  description:
    "Select what you ate and pay your share. Zero sign-up, zero friction.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="SplitBill" />
      </head>
      <body>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
