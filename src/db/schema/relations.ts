// Drizzle relational query definitions — enables db.query.x.findFirst({
// with: {...} }) style reads. Purely a read-convenience layer: every FK
// and constraint that actually matters is already declared on the tables
// themselves in the other schema files.
import { relations } from "drizzle-orm";
import { investors } from "./identity";
import { transactions, portfolioOpeningStates, importBatches } from "./portfolio";
import { dnaHypotheses, dnaHypothesisVersions } from "./dna";
import {
  strategyPrinciples,
  strategyPrincipleVersions,
  strategyVersions,
  strategyVersionPrinciples,
} from "./strategy";
import { learningInsights, learningInsightVersions } from "./learning";
import { interviewSessions, interviewAnswers } from "./interview";
import { ideas, investmentCases } from "./ideas-cases";
import {
  theses,
  decisions,
  decisionSnapshots,
  decisionSnapshotDnaReferences,
  laterContexts,
  decisionReviews,
  reviewDimensions,
  predictions,
} from "./decisions";
import { evidence } from "./evidence";
import { corrections } from "./corrections";

export const investorsRelations = relations(investors, ({ many }) => ({
  transactions: many(transactions),
  portfolioOpeningStates: many(portfolioOpeningStates),
  importBatches: many(importBatches),
  dnaHypotheses: many(dnaHypotheses),
  strategyPrinciples: many(strategyPrinciples),
  strategyVersions: many(strategyVersions),
  learningInsights: many(learningInsights),
  interviewSessions: many(interviewSessions),
  ideas: many(ideas),
  investmentCases: many(investmentCases),
  decisions: many(decisions),
}));

export const importBatchesRelations = relations(importBatches, ({ one, many }) => ({
  investor: one(investors, { fields: [importBatches.investorId], references: [investors.id] }),
  transactions: many(transactions),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  investor: one(investors, { fields: [transactions.investorId], references: [investors.id] }),
  importBatch: one(importBatches, {
    fields: [transactions.importBatchId],
    references: [importBatches.id],
  }),
}));

export const dnaHypothesesRelations = relations(dnaHypotheses, ({ one, many }) => ({
  investor: one(investors, { fields: [dnaHypotheses.investorId], references: [investors.id] }),
  versions: many(dnaHypothesisVersions),
  evidence: many(evidence),
}));

export const dnaHypothesisVersionsRelations = relations(dnaHypothesisVersions, ({ one }) => ({
  hypothesis: one(dnaHypotheses, {
    fields: [dnaHypothesisVersions.dnaHypothesisId],
    references: [dnaHypotheses.id],
  }),
}));

export const strategyPrinciplesRelations = relations(strategyPrinciples, ({ one, many }) => ({
  investor: one(investors, {
    fields: [strategyPrinciples.investorId],
    references: [investors.id],
  }),
  versions: many(strategyPrincipleVersions),
  evidence: many(evidence),
}));

export const strategyPrincipleVersionsRelations = relations(
  strategyPrincipleVersions,
  ({ one, many }) => ({
    principle: one(strategyPrinciples, {
      fields: [strategyPrincipleVersions.strategyPrincipleId],
      references: [strategyPrinciples.id],
    }),
    bundledInVersions: many(strategyVersionPrinciples),
  })
);

export const strategyVersionsRelations = relations(strategyVersions, ({ one, many }) => ({
  investor: one(investors, { fields: [strategyVersions.investorId], references: [investors.id] }),
  principleVersions: many(strategyVersionPrinciples),
}));

export const strategyVersionPrinciplesRelations = relations(
  strategyVersionPrinciples,
  ({ one }) => ({
    strategyVersion: one(strategyVersions, {
      fields: [strategyVersionPrinciples.strategyVersionId],
      references: [strategyVersions.id],
    }),
    principleVersion: one(strategyPrincipleVersions, {
      fields: [strategyVersionPrinciples.strategyPrincipleVersionId],
      references: [strategyPrincipleVersions.id],
    }),
  })
);

export const learningInsightsRelations = relations(learningInsights, ({ one, many }) => ({
  investor: one(investors, { fields: [learningInsights.investorId], references: [investors.id] }),
  versions: many(learningInsightVersions),
  evidence: many(evidence),
}));

export const learningInsightVersionsRelations = relations(
  learningInsightVersions,
  ({ one }) => ({
    insight: one(learningInsights, {
      fields: [learningInsightVersions.learningInsightId],
      references: [learningInsights.id],
    }),
  })
);

export const interviewSessionsRelations = relations(interviewSessions, ({ one, many }) => ({
  investor: one(investors, {
    fields: [interviewSessions.investorId],
    references: [investors.id],
  }),
  answers: many(interviewAnswers),
}));

export const interviewAnswersRelations = relations(interviewAnswers, ({ one }) => ({
  session: one(interviewSessions, {
    fields: [interviewAnswers.interviewSessionId],
    references: [interviewSessions.id],
  }),
  transaction: one(transactions, {
    fields: [interviewAnswers.transactionId],
    references: [transactions.id],
  }),
}));

export const ideasRelations = relations(ideas, ({ one }) => ({
  investor: one(investors, { fields: [ideas.investorId], references: [investors.id] }),
  promotedToCase: one(investmentCases, {
    fields: [ideas.promotedToCaseId],
    references: [investmentCases.id],
  }),
}));

export const investmentCasesRelations = relations(investmentCases, ({ one, many }) => ({
  investor: one(investors, { fields: [investmentCases.investorId], references: [investors.id] }),
  idea: one(ideas, { fields: [investmentCases.ideaId], references: [ideas.id] }),
  decisions: many(decisions),
}));

export const decisionsRelations = relations(decisions, ({ one, many }) => ({
  investor: one(investors, { fields: [decisions.investorId], references: [investors.id] }),
  investmentCase: one(investmentCases, {
    fields: [decisions.investmentCaseId],
    references: [investmentCases.id],
  }),
  snapshot: one(decisionSnapshots, {
    fields: [decisions.id],
    references: [decisionSnapshots.decisionId],
  }),
  laterContexts: many(laterContexts),
  reviews: many(decisionReviews),
}));

export const thesesRelations = relations(theses, ({ many }) => ({
  predictions: many(predictions),
}));

export const decisionSnapshotsRelations = relations(decisionSnapshots, ({ one, many }) => ({
  decision: one(decisions, {
    fields: [decisionSnapshots.decisionId],
    references: [decisions.id],
  }),
  thesis: one(theses, { fields: [decisionSnapshots.thesisId], references: [theses.id] }),
  strategyVersion: one(strategyVersions, {
    fields: [decisionSnapshots.strategyVersionId],
    references: [strategyVersions.id],
  }),
  dnaReferences: many(decisionSnapshotDnaReferences),
}));

export const decisionSnapshotDnaReferencesRelations = relations(
  decisionSnapshotDnaReferences,
  ({ one }) => ({
    snapshot: one(decisionSnapshots, {
      fields: [decisionSnapshotDnaReferences.decisionSnapshotId],
      references: [decisionSnapshots.id],
    }),
    dnaHypothesisVersion: one(dnaHypothesisVersions, {
      fields: [decisionSnapshotDnaReferences.dnaHypothesisVersionId],
      references: [dnaHypothesisVersions.id],
    }),
  })
);

export const laterContextsRelations = relations(laterContexts, ({ one }) => ({
  decision: one(decisions, { fields: [laterContexts.decisionId], references: [decisions.id] }),
}));

export const decisionReviewsRelations = relations(decisionReviews, ({ one, many }) => ({
  decision: one(decisions, {
    fields: [decisionReviews.decisionId],
    references: [decisions.id],
  }),
  dimensions: many(reviewDimensions),
  resolvedPredictions: many(predictions),
}));

export const reviewDimensionsRelations = relations(reviewDimensions, ({ one, many }) => ({
  review: one(decisionReviews, {
    fields: [reviewDimensions.decisionReviewId],
    references: [decisionReviews.id],
  }),
  corrections: many(corrections),
}));

export const predictionsRelations = relations(predictions, ({ one }) => ({
  thesis: one(theses, { fields: [predictions.thesisId], references: [theses.id] }),
  resolvedByReview: one(decisionReviews, {
    fields: [predictions.resolvedByReviewId],
    references: [decisionReviews.id],
  }),
}));

export const evidenceRelations = relations(evidence, ({ one }) => ({
  dnaHypothesis: one(dnaHypotheses, {
    fields: [evidence.dnaHypothesisId],
    references: [dnaHypotheses.id],
  }),
  strategyPrinciple: one(strategyPrinciples, {
    fields: [evidence.strategyPrincipleId],
    references: [strategyPrinciples.id],
  }),
  learningInsight: one(learningInsights, {
    fields: [evidence.learningInsightId],
    references: [learningInsights.id],
  }),
  transaction: one(transactions, {
    fields: [evidence.transactionId],
    references: [transactions.id],
  }),
  interviewAnswer: one(interviewAnswers, {
    fields: [evidence.interviewAnswerId],
    references: [interviewAnswers.id],
  }),
  decisionReview: one(decisionReviews, {
    fields: [evidence.decisionReviewId],
    references: [decisionReviews.id],
  }),
}));

export const correctionsRelations = relations(corrections, ({ one }) => ({
  reviewDimension: one(reviewDimensions, {
    fields: [corrections.reviewDimensionId],
    references: [reviewDimensions.id],
  }),
  decisionReview: one(decisionReviews, {
    fields: [corrections.decisionReviewId],
    references: [decisionReviews.id],
  }),
  dnaHypothesis: one(dnaHypotheses, {
    fields: [corrections.dnaHypothesisId],
    references: [dnaHypotheses.id],
  }),
  strategyPrinciple: one(strategyPrinciples, {
    fields: [corrections.strategyPrincipleId],
    references: [strategyPrinciples.id],
  }),
  learningInsight: one(learningInsights, {
    fields: [corrections.learningInsightId],
    references: [learningInsights.id],
  }),
  resultingReview: one(decisionReviews, {
    fields: [corrections.resultingReviewId],
    references: [decisionReviews.id],
  }),
}));
