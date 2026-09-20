import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import SegmentedControl from "../../../components/SegmentedControl";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { DetailSkeleton } from "../../../components/Skeleton";
import {
  REVIEW_PERIODS,
  useReviewPeriod,
} from "../../review/hooks/useReviewPeriod";
import { useReviewCostSummary } from "../hooks/useReviewCostSummary";

/** 費用は小さい額なので、丸めると差が消える */
const money = (value: number) => `$${value.toFixed(4)}`;

/** 「2026-09」を利用者の書き方にする */
function monthLabel(month: string, locale: string): string {
  const [year, index] = month.split("-").map(Number);
  return new Date(year, index - 1, 1).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
  });
}

/**
 * 掛かった費用を並べる画面。
 *
 * 総額だけでは打ち手にならないので、月ごとの動きと、どのチェックリストに
 * 掛かっているかを併せて出す。一般利用者には自分の分だけが見える
 */
export default function ReviewCostPage() {
  const { t, i18n } = useTranslation();
  const { period, setPeriod, createdFrom } = useReviewPeriod("thisMonth");
  const { summary, isLoading, error, refetch } =
    useReviewCostSummary(createdFrom);

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <ErrorAlert
          error={error}
          title={t("cost.loadError")}
          message={t("cost.loadErrorMessage")}
          retry={refetch}
        />
      </div>
    );
  }

  // 棒の長さを決める基準。全部が同じ長さに見えないよう、一番高い月に合わせる
  const highestMonth = Math.max(
    ...(summary?.byMonth.map((month) => month.totalCost) ?? [0]),
    0
  );

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t("cost.title")}</h1>
          <p className="mt-2 text-aws-font-color-gray">
            {t("cost.description")}
          </p>
        </div>
        <SegmentedControl
          name="cost-period"
          size="sm"
          value={period}
          onChange={(value) => setPeriod(value as typeof period)}
          options={REVIEW_PERIODS.map((value) => ({
            value,
            label: t(`review.period.${value}`),
          }))}
        />
      </div>

      {isLoading || !summary ? (
        <DetailSkeleton lines={8} />
      ) : (
        <>
          {/* 期間全体 */}
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: t("cost.total"), value: money(summary.total.totalCost) },
              {
                label: t("cost.jobCount"),
                value: t("cost.jobCountValue", {
                  count: summary.total.jobCount,
                }),
              },
              {
                label: t("cost.average"),
                value: money(summary.total.averageCost),
              },
              {
                label: t("cost.tokens"),
                value: `${summary.total.totalInputTokens.toLocaleString()} / ${summary.total.totalOutputTokens.toLocaleString()}`,
              },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-lg border border-light-gray bg-white p-4 shadow-sm">
                <p className="text-sm text-aws-font-color-gray">{card.label}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-aws-squid-ink-light">
                  {card.value}
                </p>
              </div>
            ))}
          </div>

          {summary.total.jobCount === 0 ? (
            <p className="text-aws-font-color-gray">{t("cost.empty")}</p>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              {/* 月ごとの動き */}
              <section className="rounded-lg border border-light-gray bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-xl font-medium text-aws-squid-ink-light">
                  {t("cost.byMonth")}
                </h2>
                <ul className="space-y-3">
                  {summary.byMonth.map((month) => (
                    <li key={month.month}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="text-aws-squid-ink-light">
                          {monthLabel(month.month, i18n.language)}
                        </span>
                        <span className="tabular-nums text-aws-font-color-gray">
                          {money(month.totalCost)}
                          <span className="ml-2">
                            {t("cost.jobCountValue", {
                              count: month.jobCount,
                            })}
                          </span>
                        </span>
                      </div>
                      {/* グラフの道具は入れていない。棒の長さで十分伝わる */}
                      <div className="mt-1 h-2 overflow-hidden rounded bg-light-gray">
                        <div
                          className="h-full bg-aws-sea-blue-light"
                          style={{
                            width:
                              highestMonth > 0
                                ? `${(month.totalCost / highestMonth) * 100}%`
                                : "0%",
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              {/* どのチェックリストに掛かっているか */}
              <section className="rounded-lg border border-light-gray bg-white p-6 shadow-sm">
                <h2 className="mb-1 text-xl font-medium text-aws-squid-ink-light">
                  {t("cost.byChecklist")}
                </h2>
                <p className="mb-4 text-sm text-aws-font-color-gray">
                  {t("cost.byChecklistHint")}
                </p>
                {/* 狭い画面でははみ出すので、表だけ横に送れるようにする */}
                <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-aws-paper-light text-left">
                      <th className="px-3 py-2 font-medium">
                        {t("review.checklist")}
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        {t("review.cost")}
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        {t("cost.jobCount")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byChecklist.map((checklist) => (
                      <tr
                        key={checklist.checkListSetId}
                        className="border-b border-light-gray">
                        <td className="px-3 py-2">{checklist.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {money(checklist.totalCost)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {checklist.jobCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </section>

              {/* 突出したものを見つける */}
              <section className="rounded-lg border border-light-gray bg-white p-6 shadow-sm lg:col-span-2">
                <h2 className="mb-4 text-xl font-medium text-aws-squid-ink-light">
                  {t("cost.topJobs")}
                </h2>
                {/* 狭い画面でははみ出すので、表だけ横に送れるようにする */}
                <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-aws-paper-light text-left">
                      <th className="px-3 py-2 font-medium">
                        {t("checklist.name")}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {t("review.createdAt")}
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        {t("review.cost")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.topJobs.map((job) => (
                      <tr key={job.id} className="border-b border-light-gray">
                        <td className="px-3 py-2">
                          <Link
                            to={`/review/${job.id}`}
                            className="text-aws-font-color-blue hover:underline">
                            {job.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-aws-font-color-gray">
                          {new Date(job.createdAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {money(job.totalCost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
