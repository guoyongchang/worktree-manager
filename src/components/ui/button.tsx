import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--color-accent)] text-[var(--color-accent-fg)] shadow-sm hover:bg-[var(--color-accent-hover)] active:scale-[0.98]",
        destructive:
          "bg-[var(--color-error)] text-[var(--color-error-fg)] shadow-sm hover:bg-[var(--color-error-light)] active:scale-[0.98]",
        warning:
          "bg-[var(--color-warning)] text-[var(--color-warning-fg)] shadow-sm hover:bg-[var(--color-warning-light)] active:scale-[0.98]",
        outline:
          "border border-[var(--color-border)] bg-transparent text-[var(--color-text-primary)] shadow-sm hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]",
        secondary:
          "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-sm hover:bg-[var(--color-bg-elevated)] border border-[var(--color-border)]",
        ghost:
          "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)]",
        link:
          "text-[var(--color-accent)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
