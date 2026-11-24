"use server";

import { redirect } from "next/navigation";
import { requireLearner } from "@/auth";
import type { PracticeScope } from "@/core";
import { getCore } from "@/server/core";

/** Start Practice over a Topic or a Tag (replacing any open Practice session) and go to it. */
export async function startPractice(scope: PracticeScope): Promise<void> {
  await requireLearner();
  await getCore().startPractice(scope);
  redirect("/practice");
}
