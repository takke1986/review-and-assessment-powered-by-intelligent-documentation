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
        scales: {
          x: {
            grid: { display: horizontal },
            ticks: horizontal && formatValue
              ? { callback: (value) => formatValue(Number(value)) }
              : undefined,
          },
          y: {
            grid: { display: !horizontal },
            beginAtZero: true,
            ticks: !horizontal && formatValue
              ? { callback: (value) => formatValue(Number(value)) }
              : undefined,
          },
        },
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
