import type { Metadata } from "next";
import { Noto_Sans_Thai, Prompt } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// เนื้อหา/ตาราง/ฟอร์ม
const notoThai = Noto_Sans_Thai({
  variable: "--font-noto-thai",
  subsets: ["thai", "latin"],
});

// หัวข้อ ตัวเลขเด่น ปุ่ม (DESIGN.md §2) — Prompt มีอักษรไทย
const prompt = Prompt({
  variable: "--font-prompt",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "SmartMart POS",
  description: "ระบบขายหน้าร้านสำหรับร้านสะดวกซื้อ",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={`${notoThai.variable} ${prompt.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
