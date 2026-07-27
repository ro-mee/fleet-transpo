import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "FleetOps - Fleet Transportation Management System",
  description:
    "AI-Driven Fleet Transportation Management System for Hotel and Restaurant Operations",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans antialiased">
        <Providers>
          <DashboardLayout>{children}</DashboardLayout>
        </Providers>
      </body>
    </html>
  );
}
