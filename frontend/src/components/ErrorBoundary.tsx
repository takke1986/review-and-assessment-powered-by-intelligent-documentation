import { Component, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

/**
 * 描画中の例外を受け止めて、画面全体が白くなるのを防ぐ。
 *
 * React は描画中に例外が出ると、その木をまるごと unmount する。境界が
 * 無いと root まで空になり、利用者には真っ白な画面だけが残って、何が
 * 起きたのかも分からない。実際に傾向画面で、import を1つ書き忘れた
 * だけで全画面が消えた。
 *
 * 境界を置く単位は「そこが消えても他が読める」ところ。ページ全体を
 * 1つで包むのではなく、表やグラフのように差し替えが効く塊ごとに置く。
 */

interface Props {
  children: ReactNode;
  /** 壊れた場所が分かる短い名前。「集計グラフ」など */
  label?: string;
  /** 例外の代わりに出すもの。既定は説明つきの枠 */
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

class ErrorBoundaryInner extends Component<
  Props & { message: string; detailLabel: string },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 画面には出さないが、原因を追えるようにしておく。
    // 白画面のときに何も残らないのがいちばん困る
    console.error(
      `[ErrorBoundary]${this.props.label ? ` ${this.props.label}:` : ""}`,
      error,
      info.componentStack
    );
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    if (this.props.fallback !== undefined) {
      return this.props.fallback;
    }
    return (
      <div
        role="alert"
        className="rounded-lg border border-light-gray bg-white p-4 text-sm">
        <p className="text-aws-squid-ink-light">{this.props.message}</p>
        {/* 原因の一行は出す。問い合わせのときに伝えられるようにするため */}
        <p className="mt-1 break-all text-xs text-aws-font-color-gray">
          {this.props.detailLabel}: {error.message}
        </p>
      </div>
    );
  }
}

export default function ErrorBoundary(props: Props) {
  const { t } = useTranslation();
  return (
    <ErrorBoundaryInner
      {...props}
      message={
        props.label
          ? t("common.sectionFailed", { section: props.label })
          : t("common.sectionFailedGeneric")
      }
      detailLabel={t("common.details")}
    />
  );
}
