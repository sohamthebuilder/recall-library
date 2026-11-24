import type { PracticeScope } from "@/core";
import { startPractice } from "./actions";

/** Starts Practice over a Topic or a Tag. */
export function PracticeButton({ scope, label }: { scope: PracticeScope; label: string }) {
  return (
    <form action={startPractice.bind(null, scope)} className="practice-start">
      <button type="submit">{label}</button>
    </form>
  );
}
