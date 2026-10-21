import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-brand text-brand-fg",
        secondary: "border bg-secondary text-text-2",
        outline: "text-foreground",
        success: "border-success-soft bg-success-tint text-success-text",
        warning: "border-warning-soft bg-warning-tint text-warning-text",
        destructive: "border-danger-soft bg-danger-tint text-danger-text",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
