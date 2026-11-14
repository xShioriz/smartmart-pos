import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-lavender-100 text-navy [a]:hover:bg-lavender",
        secondary:
          "bg-lavender-50 text-navy border-border [a]:hover:bg-lavender-100",
        destructive:
          "bg-danger-soft text-danger focus-visible:ring-danger/30",
        outline:
          "border-border-strong text-foreground [a]:hover:bg-lavender-50",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
        // ป้ายสถานะตามความหมาย (ใช้ทั้งระบบ): ตัวอักษรเข้มบนพื้นอ่อน คอนทราสต์ ≥ 7:1 — ต้องมีข้อความกำกับเสมอ ไม่ใช้สีอย่างเดียว
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        caution: "bg-warning-soft text-warning",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
