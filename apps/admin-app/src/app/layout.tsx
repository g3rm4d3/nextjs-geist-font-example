import type { Metadata } from 'next';
import { AdminAuthProvider } from '@/context/AdminAuthContext';
import './globals.css';

export const metadata: Metadata = {
  title: 'Rideshare Admin — Stage 1 (Development)',
  description: 'Internal administrative console for the rideshare platform. Development build.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <AdminAuthProvider>{children}</AdminAuthProvider>
      </body>
    </html>
  );
}
