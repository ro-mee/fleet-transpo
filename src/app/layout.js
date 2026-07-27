import { Geist, Geist_Mono, IBM_Plex_Mono } from "next/font/google";
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

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata = {
  title: "FleetOps - Fleet Transportation Management System",
  description:
    "AI-Driven Fleet Transportation Management System for Hotel and Restaurant Operations",
};

const themeScript = `
  (function() {
    try {
      var theme = localStorage.getItem('fleetops-theme');
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      }
    } catch(e) {}
  })()
`;

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${ibmPlexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        <Providers>
          <DashboardLayout>{children}</DashboardLayout>
        </Providers>
      </body>
    </html>
  );
}
