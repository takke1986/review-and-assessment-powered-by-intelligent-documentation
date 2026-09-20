import React, { ReactNode, ButtonHTMLAttributes } from "react";
import { Link, LinkProps } from "react-router-dom";

// ボタンのバリエーション
export type ButtonVariant = "primary" | "secondary" | "danger" | "text";

// ボタンのサイズ
export type ButtonSize = "sm" | "md" | "lg";

// 共通のプロパティ
export interface BaseButtonProps {
  variant?: ButtonVariant;
  outline?: boolean;
  size?: ButtonSize;
  icon?: ReactNode;
  iconPosition?: "left" | "right";
  fullWidth?: boolean;
  className?: string;
  /**
   * 処理中。押せなくして、アイコンを回すものに差し替える。
   *
   * 以前は型が何でも通す作りだったので、渡しても何も起きていなかった
   */
  loading?: boolean;
  /** ボタンとリンクの両方で使うので、共通の側に置く */
  disabled?: boolean;
}

/**
 * 通常のボタン。
 *
 * children は省略できる。アイコンだけのボタンがあり、必須にすると
 * それらが型に合わなくなる。
 *
 * 素の属性（title、aria-label など）は HTML の型から受け取る。
 * かつては [key: string]: any で何でも通していたが、それでは打ち間違いも
 * 通ってしまい、型検査の意味がなくなる
 */
export interface ButtonProps
  extends BaseButtonProps,
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  children?: ReactNode;
  to?: never;
}

/** リンクとして振る舞うボタン */
export interface LinkButtonProps
  extends BaseButtonProps,
    Omit<LinkProps, "to" | "className"> {
  children?: ReactNode;
  to: string;
}

// プロパティの型を判定
export type CombinedButtonProps = ButtonProps | LinkButtonProps;

// リンクかどうかを判定する関数
const isLinkButton = (props: CombinedButtonProps): props is LinkButtonProps => {
  return "to" in props && typeof props.to === "string";
};

/**
 * 共通のボタンコンポーネント
 *
 * @example
 * // 通常のボタン
 * <Button variant="primary" onClick={handleClick}>クリック</Button>
 *
 * // リンクボタン
 * <Button variant="primary" to="/path">リンク</Button>
 *
 * // アイコン付きボタン
 * <Button variant="primary" icon={<PlusIcon />}>新規作成</Button>
 */
export const Button = (props: CombinedButtonProps) => {
  const {
    variant = "primary",
    outline = false,
    size = "md",
    icon,
    iconPosition = "left",
    fullWidth = false,
    loading = false,
    disabled = false,
    children,
    className = "",
    ...rest
  } = props;

  const getButtonStyle = () => {
    if (outline) {
      const hoverStyle = "hover:bg-light-gray hover:shadow-sm";

      switch (variant) {
        case "primary":
          return `bg-transparent border border-aws-sea-blue-light text-aws-sea-blue-light ${hoverStyle} dark:border-aws-sea-blue-dark dark:text-aws-font-color-dark`;
        case "secondary":
          return `bg-transparent border border-aws-aqua text-aws-aqua ${hoverStyle}`;
        case "danger":
          return `bg-transparent border border-red text-red ${hoverStyle}`;
        case "text":
        default:
          return `bg-transparent border border-gray-400 text-gray-600 ${hoverStyle}`;
      }
    }

    switch (variant) {
      case "primary":
        return "bg-aws-sea-blue-light hover:bg-aws-sea-blue-hover-light dark:bg-aws-sea-blue-dark dark:hover:bg-aws-sea-blue-hover-dark text-aws-font-color-white-light";
      case "secondary":
        return "bg-aws-aqua hover:bg-aws-sea-blue-light text-aws-font-color-white-light";
      case "danger":
        return "bg-red hover:bg-red/90 text-aws-font-color-white-light";
      case "text":
        return "bg-transparent hover:bg-aws-paper-light text-aws-font-color-blue";
      default:
        return "bg-aws-sea-blue-light hover:bg-aws-sea-blue-hover-light text-aws-font-color-white-light";
    }
  };

  // サイズに応じたスタイルを定義
  const sizeStyles = {
    sm: "px-2 py-1 text-sm",
    md: "px-4 py-2",
    lg: "px-6 py-3 text-lg",
  };

  // 共通のスタイル
  const baseStyles =
    "rounded-md flex items-center justify-center transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-aws-sea-blue-light focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed";

  // 幅のスタイル
  const widthStyle = fullWidth ? "w-full" : "";

  // 最終的なクラス名
  const buttonClasses = `${baseStyles} ${getButtonStyle()} ${sizeStyles[size]} ${widthStyle} ${className}`;

  // アイコンの配置
  const renderContent = () => {
    const shown = loading ? (
      <span
        className="h-4 w-4 animate-spin rounded-full border-b-2 border-t-2 border-current"
        aria-hidden="true"
      />
    ) : (
      icon
    );
    if (!shown) return children;

    return (
      <>
        {iconPosition === "left" && <span className="mr-1">{shown}</span>}
        {children}
        {iconPosition === "right" && <span className="ml-1">{shown}</span>}
      </>
    );
  };

  // リンクボタンかどうかで出力を分ける
  if (isLinkButton(props)) {
    const {
      to,
      icon,
      iconPosition,
      variant,
      outline,
      size,
      fullWidth,
      ...linkRest
    } = props;
    return (
      <Link to={to} className={buttonClasses} {...linkRest}>
        {renderContent()}
      </Link>
    );
  }

  // 見た目に関わる props は上で取り除いてあるので、残りをそのまま渡す
  return (
    <button
      className={buttonClasses}
      {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
      // 処理中は押せない。二重に走らせないため
      disabled={disabled || loading}>
      {renderContent()}
    </button>
  );
};

export default Button;
