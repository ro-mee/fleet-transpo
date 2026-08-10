"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className = "", ...props }) {
  return (
    <TabsPrimitive.List
      className={`inline-flex items-center justify-center rounded-xl bg-muted p-1 text-foreground-muted ${className}`}
      {...props}
    />
  );
}

export function TabsTrigger({ className = "", ...props }) {
  return (
    <TabsPrimitive.Trigger
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:shadow-sm ${className}`}
      {...props}
    />
  );
}

export function TabsContent({ className = "", ...props }) {
  return (
    <TabsPrimitive.Content
      className={`mt-2 focus-visible:outline-none ${className}`}
      {...props}
    />
  );
}
