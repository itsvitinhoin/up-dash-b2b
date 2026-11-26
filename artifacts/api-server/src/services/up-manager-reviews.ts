import {
  db,
  upManagerArchiveTable as archive,
  upManagerInsightReviewsTable as reviews,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

const reviewFields = {
  insightId: reviews.insightId,
  reviewedAt: reviews.reviewedAt,
};

export function managerInsightReviews(clientId: string, runId: string) {
  return db
    .select(reviewFields)
    .from(reviews)
    .where(and(eq(reviews.clientId, clientId), eq(reviews.runId, runId)));
}

function hasInsight(list: unknown, insightId: string) {
  return (
    Array.isArray(list) &&
    list.some(
      (item) => item && typeof item === "object" && item.id === insightId,
    )
  );
}

export async function reviewManagerInsight(
  clientId: string,
  runId: string,
  insightId: string,
  actorUserId: string,
) {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select({ payload: archive.payload })
      .from(archive)
      .where(and(eq(archive.clientId, clientId), eq(archive.runId, runId)));
    const agent = run?.payload.agent as
      | { insights?: unknown }
      | null
      | undefined;
    const legacyGrade =
      insightId === "grade-summary" &&
      Array.isArray(run?.payload.findings) &&
      run.payload.findings.some(
        (item) => item && typeof item === "object" && item.grade,
      );
    if (
      !run ||
      (!legacyGrade &&
        !hasInsight(run.payload.findings, insightId) &&
        !hasInsight(agent?.insights, insightId))
    )
      return null;
    const [review] = await tx
      .insert(reviews)
      .values({ clientId, runId, insightId, actorUserId })
      .onConflictDoNothing()
      .returning(reviewFields);
    if (review) return review;
    const [previous] = await tx
      .select(reviewFields)
      .from(reviews)
      .where(
        and(
          eq(reviews.clientId, clientId),
          eq(reviews.runId, runId),
          eq(reviews.insightId, insightId),
        ),
      );
    return previous ?? null;
  });
}
