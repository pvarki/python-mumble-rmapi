import * as React from "react";

import { cn } from "@/lib/utils";

function Badge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="badge"
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border border-border/50 bg-muted/50 px-3 text-xs",
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
