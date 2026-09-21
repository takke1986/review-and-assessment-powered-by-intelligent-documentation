import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

/**
 * アプリケーションの共通レイアウト
 * サイドバーとメインコンテンツエリアを含む
 */
export default function Layout() {
  return (
    <div className="flex min-h-screen bg-aws-paper-light">
      <Sidebar />
      
      {/* メインコンテンツエリア */}
      {/* 携帯では余白を詰める。p-8 のままだと中身の幅が残らない。
          上を空けるのは、メニューの帯を固定しているため（帯の高さ h-14） */}
      <main className="min-w-0 flex-1 p-4 pt-[4.5rem] transition-all duration-300 md:ml-64 md:p-8 md:pt-8">
        <div className="mx-auto max-w-7xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
