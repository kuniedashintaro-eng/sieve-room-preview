import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Room Furniture Preview",
  description: "Upload a room photo and preview furniture placement with OpenAI image editing.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
