import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import SegmentedControl from "../../../components/SegmentedControl";
import BarChart, { CHART_COLORS } from "../../../components/BarChart";
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
      <div>
        <ErrorAlert
          error={error}
          title={t("cost.loadError")}
          message={t("cost.loadErrorMessage")}
          retry={refetch}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-aws-font-color-light dark:text-aws-font-color-dark">
            {t("cost.title")}
          </h1>
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
                className="min-w-0 rounded-lg border border-light-gray bg-white p-4 shadow-sm">
                <p className="text-sm text-aws-font-color-gray">{card.label}</p>
                {/* 桁の多い数字は札を押し広げるので、折り返せるようにする */}
                <p className="mt-1 break-words text-2xl font-bold tabular-nums text-aws-squid-ink-light">
                  {card.value}
                </p>
              </div>
            ))}
          </div>

          {summary.total.jobCount === 0 ? (
            <p className="text-aws-font-color-gray">{t("cost.empty")}</p>
          ) : (
            <div className="grid min-w-0 gap-6 lg:grid-cols-2">
              {/* 月ごとの動き */}
              <section className="min-w-0 rounded-lg border border-light-gray bg-white p-4 shadow-sm sm:p-6">
                <h2 className="mb-4 text-xl font-medium text-aws-squid-ink-light">
                  {t("cost.byMonth")}
                </h2>
                {/* 増えているのか減っているのかは、並べて見ないと分からない */}
                <BarChart
                  height={220}
                  ariaLabel={t("cost.byMonth")}
                  labels={summary.byMonth.map((month) =>
                    monthLabel(month.month, i18n.language)
                  )}
                  datasets={[
                    {
                      label: t("cost.total"),
                      data: summary.byMonth.map((month) => month.totalCost),
                      backgroundColor: CHART_COLORS.blue,
                    },
                  ]}
                  formatValue={money}
                />
                <ul className="mt-3 space-y-1 text-sm">
                  {summary.byMonth.map((month) => (
                    <li
                      key={month.month}
                      className="flex items-baseline justify-between gap-2">
                      <span className="text-aws-squid-ink-light">
                        {monthLabel(month.month, i18n.language)}
                      </span>
                      <span className="whitespace-nowrap tabular-nums text-aws-font-color-gray">
                        {money(month.totalCost)}
                        <span className="ml-2">
                          {t("cost.jobCountValue", { count: month.jobCount })}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              {/* どの部署が使っているか。部署を使っていなければ出さない */}
              {summary.byDepartment.length > 0 && (
                <section className="min-w-0 rounded-lg border border-light-gray bg-white p-4 shadow-sm sm:p-6">
                  <h2 className="mb-1 text-xl font-medium text-aws-squid-ink-light">
                    {t("cost.byDepartment")}
                  </h2>
                  <p className="mb-4 text-sm text-aws-font-color-gray">
                    {t("cost.byDepartmentHint")}
                  </p>
                  <BarChart
                    horizontal
                    height={Math.max(140, summary.byDepartment.length * 42)}
                    ariaLabel={t("cost.byDepartment")}
                    labels={summary.byDepartment.map((d) => d.departmentId)}
                    datasets={[
                      {
                        label: t("review.cost"),
                        data: summary.byDepartment.map((d) => d.totalCost),
                        backgroundColor: CHART_COLORS.blue,
                      },
                    ]}
                    formatValue={money}
                  />
                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full">
                      <thead>
                        <tr className="bg-aws-paper-light text-left">
                          <th className="whitespace-nowrap px-3 py-2 font-medium">
                            {t("review.department")}
                          </th>
                          <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                            {t("review.cost")}
                          </th>
                          <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                            {t("cost.jobCount")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.byDepartment.map((department) => (
                          <tr
                            key={department.departmentId}
                            className="border-b border-light-gray">
                            <td className="min-w-[10rem] px-3 py-2">
                              {/* 「この部署が高い」で終わらせず、履歴まで辿れるように */}
                              <Link
                                to={`/review?departmentId=${encodeURIComponent(
                                  department.departmentId
                                )}`}
                                className="text-aws-font-color-blue hover:underline">
                                {department.departmentId}
                              </Link>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                              {money(department.totalCost)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                              {department.jobCount}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* 内訳を足しても合計に届かない理由を書いておく。
                      黙って落とすと、部署ごとに按分するときに数が合わない */}
                  {summary.withoutDepartment.jobCount > 0 && (
                    <p className="mt-3 text-sm text-aws-font-color-gray">
                      {t("cost.withoutDepartment", {
                        count: summary.withoutDepartment.jobCount,
                        cost: money(summary.withoutDepartment.totalCost),
                      })}
                    </p>
                  )}
                </section>
              )}

              {/* どのチェックリストに掛かっているか */}
              <section className="min-w-0 rounded-lg border border-light-gray bg-white p-4 shadow-sm sm:p-6">
                <h2 className="mb-1 text-xl font-medium text-aws-squid-ink-light">
                  {t("cost.byChecklist")}
                </h2>
                <p className="mb-4 text-sm text-aws-font-color-gray">
                  {t("cost.byChecklistHint")}
                </p>
                {/* どの審査に掛かっているかは、並べると一目で分かる。
                    総額だけ見ても打ち手にならない */}
                <BarChart
                  horizontal
                  height={Math.max(140, summary.byChecklist.length * 42)}
                  ariaLabel={t("cost.byChecklist")}
                  labels={summary.byChecklist.map((c) => c.name)}
                  datasets={[
                    {
                      label: t("review.cost"),
                      data: summary.byChecklist.map((c) => c.totalCost),
                      backgroundColor: CHART_COLORS.blue,
                    },
                  ]}
                  formatValue={money}
                />
                {/* 狭い画面でははみ出すので、表だけ横に送れるようにする */}
                <div className="mt-4 overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-aws-paper-light text-left">
                      <th className="whitespace-nowrap px-3 py-2 font-medium">
                        {t("review.checklist")}
                      </th>
                      <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                        {t("review.cost")}
                      </th>
                      <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                        {t("cost.jobCount")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byChecklist.map((checklist) => (
                      <tr
                        key={checklist.checkListSetId}
                        className="border-b border-light-gray">
                        <td className="min-w-[10rem] px-3 py-2">
                          {/* 「この審査が高い」で終わらせず、該当のジョブまで
                              辿れるようにする */}
                          <Link
                            to={`/review?checkListSetId=${checklist.checkListSetId}`}
                            className="text-aws-font-color-blue hover:underline">
                            {checklist.name}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          {money(checklist.totalCost)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          {checklist.jobCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </section>

              {/* 突出したものを見つける */}
              <section className="min-w-0 rounded-lg border border-light-gray bg-white p-4 shadow-sm sm:p-6 lg:col-span-2">
                <h2 className="mb-4 text-xl font-medium text-aws-squid-ink-light">
                  {t("cost.topJobs")}
                </h2>
                {/* 狭い画面でははみ出すので、表だけ横に送れるようにする */}
                <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-aws-paper-light text-left">
                      <th className="whitespace-nowrap px-3 py-2 font-medium">
                        {t("checklist.name")}
                      </th>
                      <th className="whitespace-nowrap px-3 py-2 font-medium">
                        {t("review.createdAt")}
                      </th>
                      <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                        {t("review.cost")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.topJobs.map((job) => (
                      <tr key={job.id} className="border-b border-light-gray">
                        <td className="min-w-[10rem] px-3 py-2">
                          <Link
                            to={`/review/${job.id}`}
                            className="text-aws-font-color-blue hover:underline">
                            {job.name}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-aws-font-color-gray">
                          {new Date(job.createdAt).toLocaleString()}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
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
