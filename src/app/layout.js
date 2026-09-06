import { Inter, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { Providers } from "@/components/providers";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
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

const themeScript = `
  (function() {
    try {
      var theme = localStorage.getItem('fleetops-theme') || 'light';
      if (theme === 'system') {
        theme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
      }
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
      className={`${inter.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* beforeInteractive keeps the synchronous before-paint execution of a
            blocking head script (no theme flash). It must live inside <head>:
            a sync script as a direct child of <html> breaks React resource
            ordering ("cannot be a child of <html>"). next/script emits it into
            the head HTML and renders null on the client, so React's "script
            tag while rendering component" dev warning stays silent. */}
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        <Providers>
          <DashboardLayout>{children}</DashboardLayout>
        </Providers>
      </body>
    </html>
  );
}
