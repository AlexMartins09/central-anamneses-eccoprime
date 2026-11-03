import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { getSettings } from "@/lib/settings";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Central de Agendamento de Anamneses", template: "%s · Eccoprime" },
  description: "Agende a anamnese do seu filho com a equipe de psicologia da Eccoprime.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1e3a6b" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const s = await getSettings();
  // Cores da marca vêm do banco (Configurações > Identidade visual); valores validados por regex no salvamento.
  const brandCss = `:root{--primary:${s.colorPrimary};--ring:${s.colorPrimary};--accent:${s.colorAccent};}`;
  return (
    <html lang="pt-BR" className={inter.variable}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: brandCss }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
