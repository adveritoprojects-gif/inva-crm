import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PCT Project Desk",
  description: "Private CRM for tracking PCT writing projects",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
