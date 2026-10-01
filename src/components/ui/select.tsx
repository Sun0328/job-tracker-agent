"use client";

/**
 * The same structure shadcn/ui gives its Select — Radix primitives underneath,
 * with our own class names in place of its Tailwind ones. Everything below the
 * trigger renders in a portal, so a menu opened inside a table is never clipped
 * by the row.
 */

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { forwardRef } from "react";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export const SelectTrigger = forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & { chevronSize?: number }
>(function SelectTrigger({ className, children, chevronSize = 14, ...props }, ref) {
  return (
    <SelectPrimitive.Trigger ref={ref} className={className} {...props}>
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown size={chevronSize} className="select-chevron" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

export const SelectContent = forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(function SelectContent({ className, children, position = "popper", ...props }, ref) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        className={"menu " + (className ?? "")}
        position={position}
        sideOffset={6}
        collisionPadding={12}
        {...props}
      >
        <SelectPrimitive.Viewport className="menu-viewport">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});

export const SelectItem = forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(function SelectItem({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Item ref={ref} className={"menu-item " + (className ?? "")} {...props}>
      <span className="menu-check">
        <SelectPrimitive.ItemIndicator>
          <Check size={13} />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
});
