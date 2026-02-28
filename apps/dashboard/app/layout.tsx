import type { Metadata } from 'next';
import { Theme } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Code Reviewer Dashboard',
  description: 'Enterprise control plane for GitHub review automation.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Theme accentColor="blue" grayColor="slate" radius="large" scaling="100%">
          {children}
        </Theme>
      </body>
    </html>
  );
}
