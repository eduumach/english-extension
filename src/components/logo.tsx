import { logoSvg } from "@/lib/logo";
import { cn } from "@/lib/utils";

export function Logo({ size, className }: { size: number; className?: string }) {
  return <span className={cn("inline-flex shrink-0", className)} dangerouslySetInnerHTML={{ __html: logoSvg(size) }} />;
}
