"use client";

import { forwardRef } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, Check } from "lucide-react";

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = forwardRef(({ className, children, hideIcon = false, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-10 w-full items-center justify-between rounded-xl border border-border bg-surface px-3 py-2 text-xs font-semibold text-foreground placeholder:text-foreground-muted/60 transition-all",
      "hover:border-primary/40 focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  >
    {children}
    {!hideIcon && <ChevronDown className="h-4 w-4 text-foreground-muted shrink-0 transition-transform duration-200" />}
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1 text-foreground-muted", className)}
    {...props}
  >
    <ChevronUp className="h-3.5 w-3.5" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1 text-foreground-muted", className)}
    {...props}
  >
    <ChevronDown className="h-3.5 w-3.5" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

const SelectContent = forwardRef(({ className, children, position = "popper", portal = true, ...props }, ref) => {
  const content = (
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-50 max-h-80 min-w-[8rem] overflow-hidden rounded-2xl border border-border/80 bg-surface/95 backdrop-blur-md text-foreground shadow-2xl",
        "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
        position === "popper" && "translate-y-1.5",
        className
      )}
      position={position}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          "p-1.5 custom-scrollbar",
          position === "popper" && "w-full min-w-[var(--radix-select-trigger-width)]"
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  );

  return portal ? <SelectPrimitive.Portal>{content}</SelectPrimitive.Portal> : content;
});
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-2.5 py-1.5 text-[11px] font-bold text-foreground-muted tracking-wider uppercase", className)}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = forwardRef(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-pointer select-none items-center rounded-xl py-2 pl-8 pr-2.5 text-xs font-semibold outline-hidden transition-colors",
      "hover:bg-hover hover:text-primary focus:bg-hover focus:text-primary data-[highlighted]:bg-hover data-[highlighted]:text-primary",
      "data-[state=checked]:font-bold data-[state=checked]:text-primary",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
      className
    )}
    {...props}
  >
    <span className="absolute left-2.5 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-3.5 w-3.5 text-primary stroke-[2.5]" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-border/60", className)}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
