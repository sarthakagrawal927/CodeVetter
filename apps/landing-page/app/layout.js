import './globals.css';

export const metadata = {
  title: 'CodeReviewAI — Review Code 10x Faster with AI',
  description: 'Automate code quality checks and security scanning directly in your GitHub PR workflow.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
