"use client";

import * as React from "react";
import { NativeSelect } from "@heroui-pro/react/native-select";
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
  selectClassName?: string;
  triggerClassName?: string;
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
  selectClassName,
  triggerClassName,
  disabled,
  required,
  ...props
}: SelectProps) {
  const items = options ?? optionsFromChildren(children);
  const hasEmptyOption = items.some((item) => item.value === "");
  const controlProps = value !== undefined
    ? { value }
    : { defaultValue: defaultValue ?? (hasEmptyOption ? "" : undefined) };

  return (
    <NativeSelect.Root
      fullWidth
      variant="primary"
      className={cn("min-w-36", className)}
    >
      <NativeSelect.Trigger
        {...props}
        {...controlProps}
        disabled={disabled}
        required={required}
        className={selectClassName}
        wrapperClassName={triggerClassName}
        onChange={(event) => {
          const next = event.target.value;
          onValueChange?.(next);
          onChange?.({ target: { value: next } });
        }}
      >
        {!hasEmptyOption && placeholder && (
          <NativeSelect.Option value="" disabled hidden>
            {placeholder}
          </NativeSelect.Option>
        )}
        {items.map((item) => (
          <NativeSelect.Option
            key={item.value}
            value={item.value}
            disabled={item.disabled}
          >
            {typeof item.label === "string" || typeof item.label === "number"
              ? item.label
              : item.value}
          </NativeSelect.Option>
        ))}
        <NativeSelect.Indicator />
      </NativeSelect.Trigger>
    </NativeSelect.Root>
  );
}
