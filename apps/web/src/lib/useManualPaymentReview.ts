import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { ApiRequestError, getManualPaymentSummary, setManualPaymentStatus } from "./api";
import { getManualPayment } from "./manualUpi";
import type { ManualPaymentStatus } from "../types";

type Row = { id: string; metadata?: Record<string, unknown> | null };
type Counts = { pending: number; verified: number; rejected: number };

// Shared by the editor's Responses tab and the full Responses dashboard:
// loads the true counts/duplicates and performs optimistic status changes with
// rollback on failure.
export function useManualPaymentReview<R extends Row>(
  formId: string,
  enabled: boolean,
  responses: R[],
  setResponses: Dispatch<SetStateAction<R[]>>,
) {
  const [counts, setCounts] = useState<Counts>({ pending: 0, verified: 0, rejected: 0 });
  const [duplicateUtrs, setDuplicateUtrs] = useState<string[]>([]);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [actionError, setActionError] = useState("");

  const refreshSummary = useCallback(async () => {
    try {
      const data = await getManualPaymentSummary(formId);
      setCounts(data.counts);
      setDuplicateUtrs(data.duplicateUtrs);
    } catch {
      // The summary is advisory; a failure leaves the previous numbers.
    }
  }, [formId]);

  useEffect(() => {
    if (enabled) void refreshSummary();
  }, [enabled, refreshSummary]);

  function setBusy(id: string, on: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function shiftCounts(from: ManualPaymentStatus, to: ManualPaymentStatus) {
    setCounts((c) => ({
      ...c,
      [from]: Math.max(0, c[from] - 1),
      [to]: c[to] + 1,
    }));
  }

  async function changeStatus(responseId: string, next: ManualPaymentStatus) {
    const previous = responses.find((r) => r.id === responseId);
    const current = previous ? getManualPayment(previous.metadata) : null;
    if (!previous || !current || busyIds.has(responseId)) return;

    setActionError("");
    setBusy(responseId, true);
    setResponses((rs) =>
      rs.map((r) =>
        r.id === responseId
          ? {
              ...r,
              metadata: {
                ...(r.metadata ?? {}),
                manualPayment: { ...current, status: next },
              },
            }
          : r,
      ),
    );
    shiftCounts(current.status, next);

    try {
      const { response } = await setManualPaymentStatus(formId, responseId, next);
      setResponses((rs) =>
        rs.map((r) => (r.id === responseId ? { ...r, metadata: response.metadata } : r)),
      );
      void refreshSummary();
    } catch (err) {
      setResponses((rs) => rs.map((r) => (r.id === responseId ? previous : r)));
      shiftCounts(next, current.status);
      setActionError(
        err instanceof ApiRequestError ? err.message : "Unable to update the payment status.",
      );
    } finally {
      setBusy(responseId, false);
    }
  }

  return { counts, duplicateUtrs, busyIds, actionError, changeStatus };
}
