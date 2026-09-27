// Sign-in screen, from 21st.dev's auth page. Kept: the two-column layout,
// the floating paths on the left panel, the soft radial light behind the form,
// the full-width buttons, the OR separator and the email field with its
// leading icon. Changed:
//  - the left panel is the animated Axis Blend gradient (AxisBlendGradient)
//    with white lines, the nucleus manager mark and wordmark and a tagline, in
//    place of the muted panel, "Asme" and its testimonial;
//  - the buttons are the app's real sign-ins (Apple, Google, email and
//    password), not Google / Apple / GitHub and an email-only field;
//  - the placeholder testimonial, "Home" link and Terms / Privacy links are
//    gone (there's nothing for them to point at);
//  - framer-motion is motion/react, and the radial lights use color-mix on
//    the foreground variable.
import { useState } from "react";
import { motion } from "motion/react";
import { AtSignIcon, LockIcon } from "lucide-react";
import { signInWithGoogle, signInWithApple, signInWithEmail } from "../hooks/useAuth";
import { BrandMark } from "./BrandMark";
import { AxisBlendGradient } from "@/components/ui/axis-blend-gradient";

const SHADOW = "0 1px 12px rgba(10,40,30,0.45)";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SignIn(_props: { dark?: boolean }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState<null | "apple" | "google" | "email">(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async (which: "apple" | "google" | "email", fn: () => Promise<unknown>) => {
    setErr(null);
    setBusy(which);
    try { await fn(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Sign-in failed"); }
    finally { setBusy(null); }
  };

  const onEmail = (e: React.FormEvent) => {
    e.preventDefault();
    void run("email", () => signInWithEmail(email, pw));
  };

  return (
    <main className="bg-background text-foreground relative h-screen overflow-hidden lg:grid lg:grid-cols-2">
      {/* The window has no title bar; this strip lets it be dragged. */}
      <div aria-hidden className="absolute inset-x-0 top-0 z-20 h-7" style={{ WebkitAppRegion: "drag" } as React.CSSProperties} />

      <AxisBlendGradient className="relative hidden h-full flex-col overflow-hidden border-r p-10 text-white lg:flex">
        <div className="absolute inset-0 overflow-hidden">
          <FloatingPaths position={1} />
          <FloatingPaths position={-1} />
        </div>
        {/* White type with a soft shadow, so it still reads when the gradient
            turns its grey end under it. */}
        <div className="z-10 mt-6 flex items-center gap-3" style={{ textShadow: SHADOW }}>
          <BrandMark size={30} color="#FFFFFF" style={{ filter: "drop-shadow(0 1px 8px rgba(10,40,30,0.45))" }} />
          <p className="font-display text-2xl tracking-tight">
            <span className="font-semibold">nucleus</span>
            <span className="font-normal text-white/80"> manager</span>
          </p>
        </div>
        <div className="z-10 mt-auto" style={{ textShadow: SHADOW }}>
          <p className="font-display max-w-md text-xl leading-snug">
            Real-time scheduling for a two-shift household.
          </p>
          <p className="mt-2 font-mono text-sm text-white/80">
            shifts · coverage · rest windows — synced live
          </p>
        </div>
      </AxisBlendGradient>

      <div className="absolute inset-0 flex flex-col justify-center p-4 lg:relative lg:inset-auto lg:h-full">
        <div aria-hidden className="absolute inset-0 isolate -z-10 opacity-60 contain-strict">
          <div className="absolute top-0 right-0 h-320 w-140 -translate-y-87.5 rounded-full bg-[radial-gradient(68.54%_68.72%_at_55.02%_31.46%,color-mix(in_oklab,var(--foreground)_6%,transparent)_0,hsla(0,0%,55%,.02)_50%,color-mix(in_oklab,var(--foreground)_1%,transparent)_80%)]" />
          <div className="absolute top-0 right-0 h-320 w-60 [translate:5%_-50%] rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,color-mix(in_oklab,var(--foreground)_4%,transparent)_0,color-mix(in_oklab,var(--foreground)_1%,transparent)_80%,transparent_100%)]" />
          <div className="absolute top-0 right-0 h-320 w-60 -translate-y-87.5 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,color-mix(in_oklab,var(--foreground)_4%,transparent)_0,color-mix(in_oklab,var(--foreground)_1%,transparent)_80%,transparent_100%)]" />
        </div>

        <div className="mx-auto w-full space-y-4 sm:w-sm">
          <div className="flex items-center gap-2 lg:hidden">
            <BrandMark size={24} />
            <p className="font-display text-xl font-semibold">nucleus</p>
          </div>
          <div className="flex flex-col space-y-1">
            <h1 className="font-display text-2xl font-bold tracking-tight">Sign in</h1>
            <p className="text-muted-foreground text-base">Use the account you set up on the Nucleus app.</p>
          </div>

          <div className="space-y-2">
            <Button type="button" size="lg" className="w-full cursor-pointer" disabled={!!busy}
              onClick={() => void run("apple", signInWithApple)}>
              <AppleGlyph className="me-2 size-4" />
              {busy === "apple" ? "Signing in…" : "Continue with Apple"}
            </Button>
            <Button type="button" size="lg" className="w-full cursor-pointer" disabled={!!busy}
              onClick={() => void run("google", signInWithGoogle)}>
              <GoogleIcon className="me-2 size-4" />
              {busy === "google" ? "Signing in…" : "Continue with Google"}
            </Button>
          </div>

          <AuthSeparator />

          <form className="space-y-2" onSubmit={onEmail}>
            <p className="text-muted-foreground text-start text-xs">Or sign in with your email and password</p>
            <div className="relative h-max">
              <Input
                placeholder="your.email@example.com"
                className="peer ps-9"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <div className="text-muted-foreground pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 peer-disabled:opacity-50">
                <AtSignIcon className="size-4" aria-hidden="true" />
              </div>
            </div>
            <div className="relative h-max">
              <Input
                placeholder="Password"
                className="peer ps-9"
                type="password"
                autoComplete="current-password"
                required
                value={pw}
                onChange={(e) => setPw(e.target.value)}
              />
              <div className="text-muted-foreground pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 peer-disabled:opacity-50">
                <LockIcon className="size-4" aria-hidden="true" />
              </div>
            </div>
            <Button type="submit" variant="outline" className="w-full cursor-pointer" disabled={!!busy}>
              {busy === "email" ? "Signing in…" : "Continue with email"}
            </Button>
          </form>

          {err && <p role="alert" className="text-destructive dark:text-[#D78F77] text-sm">{err}</p>}
        </div>
      </div>
    </main>
  );
}

function FloatingPaths({ position }: { position: number }) {
  const paths = Array.from({ length: 36 }, (_, i) => ({
    id: i,
    d: `M-${380 - i * 5 * position} -${189 + i * 6}C-${380 - i * 5 * position} -${189 + i * 6} -${312 - i * 5 * position} ${216 - i * 6} ${152 - i * 5 * position} ${343 - i * 6}C${616 - i * 5 * position} ${470 - i * 6} ${684 - i * 5 * position} ${875 - i * 6} ${684 - i * 5 * position} ${875 - i * 6}`,
    width: 0.5 + i * 0.03,
    /** How strong the line is before the pulse (the supplied strokeOpacity). */
    strength: Math.min(1, 0.1 + i * 0.03),
    // Fixed per path (the supplied Math.random ran on every render).
    duration: 20 + ((i * 7) % 10),
  }));

  return (
    <div className="pointer-events-none absolute inset-0">
      <svg className="h-full w-full text-white" viewBox="0 0 696 316" fill="none">
        <title>Background Paths</title>
        {paths.map((path) => (
          <motion.path
            key={path.id}
            d={path.d}
            stroke="currentColor"
            strokeWidth={path.width}
            // The fade runs on the stroke's opacity, not the element's. The
            // supplied component pulsed each line's `opacity` (0.3 → 0.6 →
            // 0.3), which gives all 72 lines their own compositor layer;
            // Electron ran out of tile memory and stopped drawing the form.
            // stroke-opacity is painted, not composited, so it's the same look
            // (the line's own strength times that pulse) without the layers.
            initial={{ pathLength: 0.3, strokeOpacity: path.strength * 0.6 }}
            animate={{
              pathLength: 1,
              pathOffset: [0, 1, 0],
              strokeOpacity: [path.strength * 0.3, path.strength * 0.6, path.strength * 0.3],
            }}
            transition={{ duration: path.duration, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
          />
        ))}
      </svg>
    </div>
  );
}

function AppleGlyph(props: React.ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 18 21" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M14.5 11.2c0-2.4 2-3.5 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.8-3-.8-1.5 0-2.9.9-3.7 2.3-1.6 2.7-.4 6.7 1.1 8.9.7 1.1 1.6 2.3 2.8 2.2 1.1 0 1.5-.7 2.9-.7 1.3 0 1.7.7 2.9.7 1.2 0 2-1.1 2.7-2.2.5-.7.9-1.5 1.2-2.4-1-.4-2-1.5-2-3.6zm-2.4-6.3c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.5.6-1 1.6-.9 2.6 1 .1 1.9-.5 2.5-1.2z" />
    </svg>
  );
}

function GoogleIcon(props: React.ComponentProps<"svg">) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12.479,14.265v-3.279h11.049c0.108,0.571,0.164,1.247,0.164,1.979c0,2.46-0.672,5.502-2.84,7.669C18.744,22.829,16.051,24,12.483,24C5.869,24,0.308,18.613,0.308,12S5.869,0,12.483,0c3.659,0,6.265,1.436,8.223,3.307L18.392,5.62c-1.404-1.317-3.307-2.341-5.913-2.341C7.65,3.279,3.873,7.171,3.873,12s3.777,8.721,8.606,8.721c3.132,0,4.916-1.258,6.059-2.401c0.927-0.927,1.537-2.251,1.777-4.059L12.479,14.265z" />
    </svg>
  );
}

function AuthSeparator() {
  return (
    <div className="flex w-full items-center justify-center">
      <div className="bg-border h-px w-full" />
      <span className="text-muted-foreground px-2 text-xs">OR</span>
      <div className="bg-border h-px w-full" />
    </div>
  );
}
