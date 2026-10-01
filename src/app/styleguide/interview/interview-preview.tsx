"use client";

import { loaded } from "@/components/home/types";
import { InterviewView } from "@/components/interview/interview-view";
import { interviewPreviewActions, previewHistoryCount, type InterviewPreviewState } from "../interview-preview-data";

// The production component on synthetic actions: no procedure, no AI. The
// active, restart and completion screens are reached by clicking through.
export function InterviewPreview({ state }: { state: InterviewPreviewState }) {
  return <InterviewView history={loaded({ transactionCount: previewHistoryCount(state) })} actions={interviewPreviewActions(state)} />;
}
