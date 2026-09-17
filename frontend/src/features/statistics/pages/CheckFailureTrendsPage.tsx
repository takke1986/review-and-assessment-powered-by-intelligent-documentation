import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useChecklistSets } from "../../checklist/hooks/useCheckListSetQueries";
import { useCheckFailureTrends } from "../hooks/useCheckFailureTrends";

/** 審査した回数がこれより少ない項目は、傾向として弱いので印を付ける */
const FEW_REVIEWS = 3;

export default function CheckFailureTrendsPage() {
  const { t } = useTranslation();
  const { items: sets, isLoading: isLoadingSets } = useChecklistSets(1, 100);
  const [setId, setSetId] = useState<string | null>(null);
  const { items, reviewJobCount, isLoading } = useCheckFailureTrends(setId);

  useEffect(() => {
    if (!setId && sets.length > 0) {
      setSetId(sets[0].id);
    }
  }, [sets, setId]);

  const percent = (rate: number) => `${Math.round(rate * 100)}%`;

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="mb-6 text-3xl font-bold">{t("trends.title")}</h1>

      <div className="mb-6">
        <label
          htmlFor="checklist-set"
          className="mb-1 block text-sm font-medium text-aws-squid-ink-light">
          {t("trends.checklistSet")}
        </label>
        <select
          id="checklist-set"
          className="w-full max-w-md rounded-md border border-light-gray px-3 py-2"
          value={setId ?? ""}
          disabled={isLoadingSets || sets.length === 0}
          onChange={(event) => setSetId(event.target.value)}>
          {sets.map((set) => (
            <option key={set.id} value={set.id}>
              {set.name}
            </option>
          ))}
        </select>
        <p className="mt-2 text-sm text-aws-font-color-gray">
          {t("trends.jobCount", { count: reviewJobCount })}
        </p>
      </div>

      {isLoading ? (
        <p className="text-aws-font-color-gray">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-aws-font-color-gray">{t("trends.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-light-gray bg-white">
          <table className="w-full text-sm">
            <thead className="bg-aws-paper-light text-left">
              <tr>
                <th className="px-4 py-3">{t("trends.item")}</th>
                <th className="px-4 py-3 text-right">{t("trends.failRate")}</th>
                <th className="px-4 py-3 text-right">{t("trends.failed")}</th>
                <th className="px-4 py-3 text-right">{t("trends.reviewed")}</th>
                <th className="px-4 py-3 text-right">
                  {t("trends.confidence")}
                </th>
                <th className="px-4 py-3">{t("trends.lastFailed")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.checkId} className="border-t border-light-gray">
                  <td className="px-4 py-3">
                    {item.name}
                    {item.reviewedCount < FEW_REVIEWS && (
                      <span className="ml-2 rounded-full bg-light-gray px-2 py-1 text-xs text-aws-font-color-gray">
                        {t("trends.few")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-bold">
                    {percent(item.failRate)}
                  </td>
                  <td className="px-4 py-3 text-right">{item.failedCount}</td>
                  <td className="px-4 py-3 text-right">{item.reviewedCount}</td>
                  <td className="px-4 py-3 text-right">
                    {item.averageConfidence === null
                      ? "-"
                      : percent(item.averageConfidence)}
                  </td>
                  <td className="px-4 py-3">
                    {item.lastFailedAt
                      ? new Date(item.lastFailedAt).toLocaleString()
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
