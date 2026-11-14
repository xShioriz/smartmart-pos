import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong bg-card px-6 py-16 text-center">
      <span aria-hidden className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-lavender-100 text-blue"><Icon className="size-7" strokeWidth={1.8} /></span>
      <p className="font-heading text-lg font-semibold text-navy">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
