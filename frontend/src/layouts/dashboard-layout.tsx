import type { ReactNode } from "react";
import { Sidebar } from "@/components/layout/sidebar";

export function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-background">
      <Sidebar />
      {/* lg:pl-64 compensa a sidebar fixa de w-64 no desktop */}
      <div className="lg:pl-64">
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
