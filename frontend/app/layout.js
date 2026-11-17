import { Lato } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const lato = Lato({
  subsets: ["latin"],
  weight: ["300", "400", "700", "900"],
  variable: "--font-lato",
});

export const metadata = {
  title: "SatarkID | Document and Face Evidence Analysis",
  description:
    "Local Aadhaar and PAN analysis with PaddleOCR, independent face comparison, and manual review.",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={lato.variable}
      suppressHydrationWarning
    >
      <body
        className={`${lato.className} min-h-screen text-[var(--ink)] antialiased`}
      >
        {children}
        <Script id="theme-init" strategy="beforeInteractive">
          {`try {
            const preference = localStorage.getItem("satarkid-theme");
            const useDark = preference === "dark" ||
              (preference !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
            document.documentElement.dataset.theme = useDark ? "dark" : "light";
          } catch {
            document.documentElement.dataset.theme =
              window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
          }`}
        </Script>
      </body>
    </html>
  );
}
