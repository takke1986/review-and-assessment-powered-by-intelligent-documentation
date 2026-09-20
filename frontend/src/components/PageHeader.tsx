import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HiChevronLeft } from 'react-icons/hi';

interface PageHeaderProps {
  title: string;
  description?: string;
  backLink?: {
    to: string;
    label: string;
  };
}

/**
 * ページヘッダーコンポーネント
 * タイトル、説明文、戻るリンクを表示する共通コンポーネント
 */
export const PageHeader: React.FC<PageHeaderProps> = ({ title, description, backLink }) => {
  const {} = useTranslation();
  
  return (
    <div className="mb-8">
      {backLink && (
        <Link to={backLink.to} className="text-aws-font-color-blue hover:text-aws-sea-blue-light flex items-center mb-2">
          <HiChevronLeft className="h-5 w-5 mr-1" />
          {backLink.label}
        </Link>
      )}
      <h1 className="text-3xl font-bold text-aws-squid-ink-light dark:text-aws-font-color-dark">{title}</h1>
      {description && (
        <p className="text-aws-font-color-gray mt-2">{description}</p>
      )}
    </div>
  );
};

export default PageHeader;
