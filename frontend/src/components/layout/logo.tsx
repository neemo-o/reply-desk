import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  iconOnly?: boolean;
}

export function Logo({ className, iconOnly = false }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <img
        src="/logos/logo.png"
        alt="ReplyDesk"
        className="h-full w-auto select-none"
        draggable={false}
      />
      {!iconOnly && (
        <span className="font-display text-xl font-semibold tracking-tight">
          Reply<span className="text-brand-500">Desk</span>
        </span>
      )}
    </span>
  );
}
