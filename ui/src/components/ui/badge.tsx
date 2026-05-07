import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
  {
    variants: {
      variant: {
        default:           "bg-primary/10 text-primary ring-primary/20",
        secondary:         "bg-secondary text-secondary-foreground ring-border",
        destructive:       "bg-destructive/10 text-destructive ring-destructive/20",
        outline:           "text-foreground ring-border",
        // Status variants
        draft:             "bg-status-draft/10 text-status-draft ring-status-draft/20",
        planned:           "bg-status-planned/10 text-status-planned ring-status-planned/20",
        implementing:      "bg-status-implementing/10 text-status-implementing ring-status-implementing/20",
        reviewing:         "bg-status-reviewing/10 text-status-reviewing ring-status-reviewing/20",
        changes_requested: "bg-status-changes_requested/10 text-status-changes_requested ring-status-changes_requested/20",
        approved:          "bg-status-approved/10 text-status-approved ring-status-approved/20",
        conflict:          "bg-status-conflict/10 text-status-conflict ring-status-conflict/20",
        merged:            "bg-status-merged/10 text-status-merged ring-status-merged/20",
        abandoned:         "bg-status-abandoned/10 text-status-abandoned ring-status-abandoned/20",
        hitl:              "bg-status-hitl/10 text-status-hitl ring-status-hitl/20 animate-pulse",
        // Generic semantic
        success: "bg-status-approved/10 text-status-approved ring-status-approved/20",
        warning: "bg-status-reviewing/10 text-status-reviewing ring-status-reviewing/20",
        info:    "bg-status-planned/10 text-status-planned ring-status-planned/20",
        muted:   "bg-muted text-muted-foreground ring-border",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
