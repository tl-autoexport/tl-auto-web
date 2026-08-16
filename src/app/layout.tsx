import type { Metadata } from "next";
import { Geist_Mono, Manrope } from "next/font/google";
import { YandexMetrika } from "@/components/analytics/YandexMetrika";
import { SiteFooter } from "@/components/site/SiteFooter";
import { getSiteUrl, isIndexableSite } from "@/lib/site-url";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["cyrillic", "latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteDescription =
  "Каталог автомобилей из Кореи: реальные объявления Encar, история, диагностика и расчёт стоимости до Владивостока.";

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: {
    default: "TL Auto — автомобили из Кореи с расчётом для РФ",
    template: "%s | TL Auto",
  },
  description: siteDescription,
  applicationName: "TL Auto",
  authors: [{ name: "TL Auto" }],
  creator: "TL Auto",
  publisher: "TL Auto",
  category: "automotive",
  keywords: [
    "автомобили из Кореи",
    "каталог авто Корея",
    "Encar",
    "расчёт автомобиля до Владивостока",
    "автокаталог для дилера",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "ru_RU",
    url: "/",
    siteName: "TL Auto",
    title: "TL Auto — автомобили из Кореи с расчётом для РФ",
    description: siteDescription,
  },
  twitter: {
    card: "summary_large_image",
    title: "TL Auto — автомобили из Кореи",
    description: siteDescription,
  },
  robots: {
    index: isIndexableSite(),
    follow: isIndexableSite(),
    googleBot: {
      index: isIndexableSite(),
      follow: isIndexableSite(),
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  formatDetection: {
    address: false,
    email: false,
    telephone: false,
  },
  appleWebApp: {
    capable: true,
    title: "TL Auto",
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${manrope.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <SiteFooter />
        <YandexMetrika />
      </body>
    </html>
  );
}
