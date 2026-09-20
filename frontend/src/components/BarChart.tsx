import { useEffect, useRef } from "react";
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  LinearScale,
  Legend,
  Tooltip,
  type ChartDataset,
} from "chart.js";

/**
 * 棒グラフ。
 *
 * chart.js の必要な部品だけを登録する。既定の一括登録だと、使わない
 * 折れ線や円グラフまで束に入ってしまう
 */
Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip
);

/** 画面の配色に合わせる。表と並べたときに別物に見えないように */
export const CHART_COLORS = {
  blue: "#005276",
  red: "#dc2626",
  yellow: "#f59e0b",
  gray: "#9ca3af",
} as const;

/**
 * 名前が長いと軸ばかりが幅を取り、携帯では棒が潰れる。
 * 全文は吹き出しと、すぐ下の表で読めるので、ここは短くてよい
 */
const LABEL_LIMIT = 12;

export const shortenLabel = (label: string): string =>
  label.length > LABEL_LIMIT ? `${label.slice(0, LABEL_LIMIT)}…` : label;

/**
 * 軸の設定を、棒の向きから決める。
 *
 * 横棒にすると種別の軸は y、数値の軸は x になる。ここを取り違えて
 * 数値軸の指定（beginAtZero）を種別の軸に付けると、chart.js はその軸を
 * 数値と解釈し、名前ではなく添字（0, 1, 2…）を並べてしまう
 */
export function buildScales(
  horizontal: boolean,
  formatValue?: (value: number) => string
) {
  const valueAxis = {
    type: "linear" as const,
    beginAtZero: true,
    grid: { display: true },
    ticks: formatValue
      ? { callback: (value: string | number) => formatValue(Number(value)) }
      : undefined,
  };
  const categoryAxis = {
    type: "category" as const,
    grid: { display: false },
    ticks: {
      callback(this: { getLabelForValue(value: number): string }, value: any) {
        return shortenLabel(this.getLabelForValue(Number(value)));
      },
    },
  };
  return horizontal
    ? { x: valueAxis, y: categoryAxis }
    : { x: categoryAxis, y: valueAxis };
}

interface BarChartProps {
  labels: string[];
  datasets: Array<ChartDataset<"bar", number[]>>;
  /** 横棒にする。項目名が長いときは、こちらの方が読める */
  horizontal?: boolean;
  /** 目盛りの数値の見せ方。費用なら「$0.0123」など */
  formatValue?: (value: number) => string;
  /** 系列が1つのときは凡例が要らない */
  showLegend?: boolean;
  /** グラフの高さ。中身の件数に合わせて外から決める */
  height: number;
  /** 読み上げ用の説明 */
  ariaLabel: string;
}

export default function BarChart({
  labels,
  datasets,
  horizontal = false,
  formatValue,
  showLegend = false,
  height,
  ariaLabel,
}: BarChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    // 描き直すたびに作り直す。同じ canvas に二重に作ると chart.js が拒む
    chartRef.current?.destroy();
    chartRef.current = new Chart(canvas, {
      type: "bar",
      data: { labels, datasets },
      options: {
        indexAxis: horizontal ? "y" : "x",
        responsive: true,
        // 高さは外の箱で決める。携帯で潰れないようにするため
        maintainAspectRatio: false,
        plugins: {
          legend: { display: showLegend, position: "bottom" },
          tooltip: {
            callbacks: formatValue
              ? {
                  label: (context) => {
                    const value = context.parsed[horizontal ? "x" : "y"];
                    return `${context.dataset.label ?? ""} ${formatValue(
                      value ?? 0
                    )}`.trim();
                  },
                }
              : undefined,
          },
        },
        scales: buildScales(horizontal, formatValue),
      },
    });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [labels, datasets, horizontal, formatValue, showLegend]);

  return (
    <div style={{ height }}>
      <canvas ref={canvasRef} role="img" aria-label={ariaLabel} />
    </div>
  );
}
