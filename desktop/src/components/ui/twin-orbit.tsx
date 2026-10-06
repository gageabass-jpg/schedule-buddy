// twin-orbit - a loading-ui component, used as-is.
// Requires: a `cn` helper at @/lib/utils (clsx + tailwind-merge).
// Shown beside the sidebar lockup while a refresh runs (Sidebar.tsx); the
// colour comes from the wrapper's `color`, since the dots are bg-current.
import { cn } from "@/lib/utils";

function TwinOrbit({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <>
      <style>{`
        @keyframes loading-ui-twin-orbit-rotate {
          100% {
            transform: rotate(360deg) translate(155%);
          }
        }
      `}</style>
      <span
        role="status"
        className={cn(
          "relative inline-block aspect-square rounded-full bg-current",
          className,
        )}
        {...props}
      >
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-current"
          style={{
            transform: "rotate(0deg) translate(155%)",
            animation:
              "loading-ui-twin-orbit-rotate var(--duration, 1s) ease infinite",
          }}
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-current"
          style={{
            transform: "rotate(0deg) translate(155%)",
            animation:
              "loading-ui-twin-orbit-rotate var(--duration, 1s) ease infinite",
            animationDelay: "calc(var(--duration, 1s) / 2)",
          }}
        />
        <span className="sr-only">Loading</span>
      </span>
    </>
  );
}

export { TwinOrbit };

export default TwinOrbit;
