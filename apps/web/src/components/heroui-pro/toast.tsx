"use client";

import * as React from "react";
import { Toast, toast } from "@heroui/react/toast";

type ToastType = "success" | "error" | "info" | "warning" | "loading";

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toast.Provider placement="bottom end" />
    </>
  );
}

export const toastManager = {
  add(input: {
    type?: ToastType;
    title: React.ReactNode;
    description?: React.ReactNode;
    timeout?: number;
    priority?: "high" | "normal";
  }) {
    const message = input.description ? (
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{input.title}</span>
        <span className="text-sm text-muted-foreground">{input.description}</span>
      </span>
    ) : input.title;
    const options = { timeout: input.timeout };
    if (input.type === "success") return toast.success(message, options);
    if (input.type === "error") return toast.danger(message, options);
    if (input.type === "warning") return toast.warning(message, options);
    if (input.type === "info") return toast.info(message, options);
    return toast(message, options);
  },
};
