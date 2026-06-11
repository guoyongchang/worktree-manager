import * as React from "react";
import { cn } from "@/lib/utils";

const Badge = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    variant?: "default" | "secondary" | "success" | "warning" | "destructive" | "outline";
  }
>(({ className, variant = "default", ...props }, ref) => {
  const variants = {
    default: "border-transparent bg-[var(--color-accent)]/15 text-[var(--color-accent-hover)]",
    secondary: "border-transparent bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]",
    success: "border-transparent bg-[var(--color-success)]/15 text-[var(--color-success-light)]",
    warning: "border-transparent bg-[var(--color-warning)]/15 text-[var(--color-warning-light)]",
    destructive: "border-transparent bg-[var(--color-error)]/15 text-[var(--color-error-light)]",
    outline: "border-[var(--color-border)] text-[var(--color-text-secondary)]",
  };

  return (
    <div
      ref={ref}
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
        variants[variant],
        className
      )}
      {...props}
    />
  );
});
Badge.displayName = "Badge";

export { Badge };
