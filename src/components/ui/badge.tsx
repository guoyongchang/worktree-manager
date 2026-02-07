import * as React from "react";
import { cn } from "@/lib/utils";

const Badge = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    variant?: "default" | "secondary" | "success" | "warning" | "destructive" | "outline";
  }
>(({ className, variant = "default", ...props }, ref) => {
  const variants = {
    default: "border-transparent bg-blue-600 text-white",
    secondary: "border-transparent bg-slate-700 text-slate-100",
    success: "border-transparent bg-emerald-900/50 text-emerald-400",
    warning: "border-transparent bg-amber-900/50 text-amber-400",
    destructive: "border-transparent bg-red-900/50 text-red-400",
    outline: "border-slate-600 text-slate-100",
  };

  return (
    <div
      ref={ref}
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
        variants[variant],
        className
      )}
      {...props}
    />
  );
});
Badge.displayName = "Badge";

export { Badge };
