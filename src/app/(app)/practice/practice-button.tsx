import type { PracticeScope } from "@/core";
import { startPractice } from "./actions";

/** Starts Practice over a Topic or a Tag. */
export function PracticeButton({ scope, label, primary = false }: { scope: PracticeScope; label: string; primary?: boolean }) {
  return (
    <form action={startPractice.bind(null, scope)} className="practice-start">
      <button type="submit" className={primary ? "primary" : undefined}>
        {label}
      </button>
    </form>
  );
}
