import type { Metadata } from "next";
import "@/app/globals.css";
import { DemoBanner } from "@/components/demo";
import { Nav } from "@/components/nav";
import { ToastProvider } from "@/components/toast";

export const metadata: Metadata = {
  title: "JobPilot",
  description: "Job application agent and tracker",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NZ">
      <body>
        <ToastProvider>
          <Nav />
          <DemoBanner />
          <main className="shell">{children}</main>
        </ToastProvider>
      </body>
    </html>
  );
}
