import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
