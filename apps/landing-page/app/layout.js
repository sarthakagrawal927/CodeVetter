import "./globals.css";

export const metadata = {
  title: "Sarthak AI Code Reviewer",
  description:
    "Sarthak AI Code Reviewer reviews pull requests with practical, inline feedback and policy-aware CI gating.",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
