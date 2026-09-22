import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paper screener",
  description: "Score papers against a project brief from a URL, file, or abstract.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
