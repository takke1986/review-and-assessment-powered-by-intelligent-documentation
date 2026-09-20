import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { HiChevronLeft } from "react-icons/hi";

interface BreadcrumbProps {
  to: string;
  label: string;
}

/**
 * パンくずリストコンポーネント
 * 戻るリンクを表示する
 */
export default function Breadcrumb({ to, label }: BreadcrumbProps) {
  const {} = useTranslation();
  
  return (
    <Link
      to={to}
      className="text-aws-font-color-blue hover:text-aws-sea-blue-light flex items-center mb-2"
    >
      <HiChevronLeft className="h-5 w-5 mr-1" />
      {label}
    </Link>
  );
}
