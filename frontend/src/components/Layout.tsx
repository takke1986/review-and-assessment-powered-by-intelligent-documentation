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
          上だけ空けるのは、メニューのボタンが浮いていて見出しに重なるため
          （ボタンは top-4 から高さ 2.5rem ほど） */}
      <main className="min-w-0 flex-1 p-4 pt-16 transition-all duration-300 md:ml-64 md:p-8">
        <div className="mx-auto max-w-7xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
