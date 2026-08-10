import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-hover text-foreground",
        primary: "bg-foreground text-surface",
        secondary: "bg-hover text-foreground-secondary",
        success: "bg-success-bg text-success",
        warning: "bg-warning-bg text-warning",
        danger: "bg-danger-bg text-danger",
        info: "bg-info-bg text-info",
        outline: "border border-border text-foreground-secondary",
      },
      size: {
        sm: "px-2 text-[11px]",
        default: "",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

function Badge({ className, variant, size, ...props }) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

export { Badge, badgeVariants };
