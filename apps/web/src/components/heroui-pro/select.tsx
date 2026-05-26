"use client";

import * as React from "react";
import { Select as HeroSelect } from "@heroui/react/select";
import { ListBox, ListBoxItem } from "react-aria-components";
import { cn } from "@/lib/utils";

interface SelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onChange?: (event: { target: { value: string } }) => void;
  options?: SelectOption[];
  children?: React.ReactNode;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
}

function optionsFromChildren(children: React.ReactNode): SelectOption[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement(child) || child.type !== "option") return [];
    const props = child.props as {
      value?: string | number;
      children?: React.ReactNode;
      disabled?: boolean;
    };
    return [{
      value: props.value == null ? "" : String(props.value),
      label: props.children,
      disabled: props.disabled,
    }];
  });
}

export function Select({
  value,
  defaultValue,
  onValueChange,
  onChange,
  options,
  children,
  placeholder = "Select...",
  className,
  disabled,
  required,
  ...props
}: SelectProps) {
  const items = options ?? optionsFromChildren(children);
  const selectedKey = value ?? defaultValue ?? null;
  const selected = items.find((item) => item.value === selectedKey);

  return (
    <HeroSelect.Root
      {...props}
      selectedKey={selectedKey}
      onSelectionChange={(key) => {
        const next = key == null ? "" : String(key);
        onValueChange?.(next);
        onChange?.({ target: { value: next } });
      }}
      isDisabled={disabled}
      isRequired={required}
      fullWidth
      variant="primary"
      className={cn("min-w-36", className)}
    >
      <HeroSelect.Trigger>
        <HeroSelect.Value>{selected?.label ?? placeholder}</HeroSelect.Value>
        <HeroSelect.Indicator />
      </HeroSelect.Trigger>
      <HeroSelect.Popover className="max-h-72 overflow-auto">
        <ListBox
          className="p-1 outline-none"
          items={items}
          selectionMode="single"
        >
          {(item) => (
            <ListBoxItem
              id={item.value}
              textValue={typeof item.label === "string" ? item.label : item.value}
              className={({ isFocusVisible, isSelected }) => cn(
                "flex cursor-default items-center rounded-md px-2.5 py-1.5 text-sm outline-none",
                "text-foreground hover:bg-accent",
                isFocusVisible && "bg-accent",
                isSelected && "bg-cyan-500/10 text-cyan-700",
                item.disabled && "pointer-events-none opacity-50",
              )}
            >
              {item.label}
            </ListBoxItem>
          )}
        </ListBox>
      </HeroSelect.Popover>
    </HeroSelect.Root>
  );
}
