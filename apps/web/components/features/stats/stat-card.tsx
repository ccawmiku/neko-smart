"use client";
import type { ElementType, ReactNode } from "react";
export function StatCard({
  label,
  subvalue,
  icon: Icon,
  color,
  children,
}: {
  label: string;
  subvalue?: string;
  icon: ElementType;
  color: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border bg-card p-3.5 shadow-xs">
      <div
        className="mb-2.5 flex h-8 w-8 items-center justify-center rounded-md"
        style={{ backgroundColor: `${color}15` }}
      >
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-[11px] font-medium tracking-wide text-muted-foreground"
          title={label}
        >
          {label}
        </p>
        {children}
        {subvalue && (
          <p
            className="mt-1.5 truncate text-xs text-muted-foreground"
            title={subvalue}
          >
            {subvalue}
          </p>
        )}
      </div>
    </div>
  );
}
