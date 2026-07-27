"use client";

import { forwardRef } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97]",
  {
    variants: {
      variant: {
        default: "bg-primary text-white hover:bg-primary-dark shadow-sm hover:shadow-md",
        destructive: "bg-danger text-white hover:bg-red-600 shadow-sm",
        outline: "border border-border bg-surface hover:bg-hover hover:text-primary",
        secondary: "bg-secondary text-white hover:bg-secondary/90 shadow-sm",
        ghost: "hover:bg-hover hover:text-primary",
        link: "text-primary underline-offset-4 hover:underline",
        success: "bg-success text-white hover:bg-emerald-600 shadow-sm",
        warning: "bg-warning text-white hover:bg-amber-600 shadow-sm",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-lg px-3 text-xs",
        lg: "h-11 rounded-xl px-8 text-base",
        icon: "h-10 w-10 rounded-xl",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

const Button = forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  );
});

Button.displayName = "Button";

export { Button, buttonVariants };
