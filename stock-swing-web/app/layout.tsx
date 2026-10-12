import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: '企業を読むノート部' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ja"><body>{children}</body></html>;
}
