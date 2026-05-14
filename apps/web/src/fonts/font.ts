import localFont from "next/font/local";

export const snProFont = localFont({
  src: [
    {
      path: "./SNPro-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./SNPro-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./SNPro-RegularItalic.woff2",
      weight: "400",
      style: "italic",
    },
  ],
  variable: "--font-sn-pro",
});
