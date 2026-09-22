import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  HiX,
  HiMenu,
  HiCheck,
  HiDocumentText,
  HiLogout,
  HiUser,
  HiCog,
  HiAnnotation,
  HiDownload,
  HiChartBar,
  HiCurrencyDollar,
  HiOfficeBuilding,
} from "react-icons/hi";
import { useAuth } from "../contexts/AuthContext";
import { useUserPreference } from "../features/user-preference/hooks/useUserPreferenceQueries";
import LanguageSwitcher from "./LanguageSwitcher";
import { getVersion } from "../utils/version";

/**
 * サイドバーコンポーネント
 * レスポンシブ対応のサイドナビゲーション
 */
export default function Sidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();
  const { signOut, user } = useAuth();
  const { t } = useTranslation();
  // 所属部署。サーバが決めた値をそのまま出す。画面がトークンから自分で
  // 読むと、審査に記録される部署とずれる恐れがある。
  // 問い合わせ先は同じ URL なので、作成画面と取得が重複しても1回で済む
  const { preference } = useUserPreference();
  const departments = preference?.departments ?? [];

  // 現在のパスに基づいてアクティブなメニュー項目を判定
  const isActive = (path: string) => {
    return location.pathname.startsWith(path);
  };

  // サイドバーの開閉を切り替える
  const toggleSidebar = () => {
    setIsOpen(!isOpen);
  };


  // ログアウト処理（URL のリセットは ProtectedRoute 側で処理）
  const handleLogout = async () => {
    await signOut();
  };

  return (
    <>
      {/* モバイル用のハンバーガーメニュー */}
      <button
        className="fixed left-4 top-4 z-50 rounded-md bg-aws-squid-ink-light p-2 text-aws-font-color-white-light md:hidden"
        onClick={toggleSidebar}
        aria-label={t("sidebar.menu")}>
        {isOpen ? <HiX className="h-6 w-6" /> : <HiMenu className="h-6 w-6" />}
      </button>

      {/* サイドバー */}
      <div
        className={`fixed left-0 top-0 z-40 h-full w-64 transform overflow-y-auto bg-aws-squid-ink-light text-aws-font-color-white-light transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}>
        {/* 携帯ではメニューのボタンが左上に浮いているので、その分だけ空ける。
            空けないと一番上の項目がボタンに重なって読めない
            （ボタンは top-4 から高さ 2.5rem ほど） */}
        {/* 縦に並べて、下の欄を mt-auto で押し下げる。
            以前は下の欄を absolute bottom-0 で貼り付けていたが、それは
            「サイドバーが伸び縮みしない」前提の置き方だった。画面が低いときに
            下部を押せるよう overflow-y-auto を足した結果、スクロールする箱の中で
            bottom-0 が宙に浮き、中身が伸びると重なったり流れ出たりする。
            mt-auto なら、余白があるときは下に寄り、中身が伸びたときは
            素直に nav の後ろに続く */}
        <div className="flex min-h-full flex-col p-6 pt-[4.5rem] md:pt-6">
          <nav>
            <ul className="space-y-2">
              <li className="mb-1">
                <Link
                  to="/checklist"
                  className={`flex items-center rounded-md px-4 py-3 transition-colors ${
                    isActive("/checklist")
                      ? "bg-aws-sea-blue-light text-aws-font-color-white-light"
                      : "text-aws-font-color-white-light hover:bg-aws-sea-blue-hover-light"
                  }`}
                  onClick={() => setIsOpen(false)}>
                  <HiCheck className="mr-3 h-5 w-5" />
                  {t("sidebar.checklist")}
                </Link>
              </li>
              <li className="mb-1">
                <Link
                  to="/review"
                  className={`flex items-center rounded-md px-4 py-3 transition-colors ${
                    isActive("/review")
                      ? "bg-aws-sea-blue-light text-aws-font-color-white-light"
                      : "text-aws-font-color-white-light hover:bg-aws-sea-blue-hover-light"
                  }`}
                  onClick={() => setIsOpen(false)}>
                  <HiDocumentText className="mr-3 h-5 w-5" />
                  {t("sidebar.review")}
                </Link>
              </li>

              <li className="mb-1">
                <Link
                  to="/trends"
                  className={`flex items-center rounded-md px-4 py-3 transition-colors ${
                    isActive("/trends")
                      ? "bg-aws-sea-blue-light text-aws-font-color-white-light"
                      : "text-aws-font-color-white-light hover:bg-aws-sea-blue-hover-light"
                  }`}
                  onClick={() => setIsOpen(false)}>
                  <HiChartBar className="mr-3 h-5 w-5" />
                  {t("sidebar.trends")}
                </Link>
              </li>

              <li className="mb-1">
                <Link
                  to="/costs"
                  className={`flex items-center rounded-md px-4 py-3 transition-colors ${
                    isActive("/costs")
                      ? "bg-aws-sea-blue-light text-aws-font-color-white-light"
                      : "text-aws-font-color-white-light hover:bg-aws-sea-blue-hover-light"
                  }`}
                  onClick={() => setIsOpen(false)}>
                  <HiCurrencyDollar className="mr-3 h-5 w-5" />
                  {t("sidebar.cost")}
                </Link>
              </li>

              <li className="mb-1">
                <Link
                  to="/examples"
                  className={`flex items-center rounded-md px-4 py-3 transition-colors ${
                    isActive("/examples")
                      ? "bg-aws-sea-blue-light text-aws-font-color-white-light"
                      : "text-aws-font-color-white-light hover:bg-aws-sea-blue-hover-light"
                  }`}
                  onClick={() => setIsOpen(false)}>
                  <HiDownload className="mr-3 h-5 w-5" />
                  {t("sidebar.examples")}
                </Link>
              </li>

              <li className="mb-1">
                <Link
                  to="/tool-configurations"
                  className={`flex items-center rounded-md px-4 py-3 transition-colors ${
                    isActive("/tool-configurations")
                      ? "bg-aws-sea-blue-light text-aws-font-color-white-light"
                      : "text-aws-font-color-white-light hover:bg-aws-sea-blue-hover-light"
                  }`}
                  onClick={() => setIsOpen(false)}>
                  <HiCog className="mr-3 h-5 w-5" />
                  {t("sidebar.toolConfiguration")}
                </Link>
              </li>

              {/* 配下が1つしかないので、階層にせず直接開く */}
              <li className="mb-1">
                <Link
                  to="/prompt-templates/checklist"
                  className={`flex w-full items-center rounded-md px-4 py-3 transition-colors ${
                    isActive("/prompt-templates")
                      ? "bg-aws-sea-blue-light text-aws-font-color-white-light"
                      : "text-aws-font-color-white-light hover:bg-aws-sea-blue-hover-light"
                  }`}
                  onClick={() => setIsOpen(false)}>
                  <HiAnnotation className="mr-3 h-5 w-5" />
                  {t("sidebar.checklistPrompt")}
                </Link>
              </li>
            </ul>
          </nav>

          <div className="mt-auto pt-6">
            {/* ユーザーメニュー */}
            {user && (
              <div className="border-t border-aws-font-color-white-light border-opacity-20 pt-4">
                <div className="mb-2 flex items-center">
                  <HiUser className="mr-2 h-5 w-5 shrink-0" />
                  <span className="truncate text-sm">
                    {user.email || user.username}
                  </span>
                </div>
                {/* 所属部署。どの部署の仕事として審査が記録されるかが
                    ここで分かる。属していなければ何も出さない
                    （「未所属」と書くと、設定漏れなのか運用なのか分からない）。
                    折り返すのは、兼務で幅に収まらないときに truncate だと
                    2つ目が黙って消えるため */}
                {departments.length > 0 && (
                  <div
                    className="mb-2 flex items-start"
                    title={t("review.department")}>
                    <HiOfficeBuilding className="mr-2 mt-0.5 h-4 w-4 shrink-0" />
                    <span className="break-words text-xs text-aws-font-color-white-light text-opacity-80">
                      {departments.join(" / ")}
                    </span>
                  </div>
                )}
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center rounded-md px-4 py-2 text-sm transition-colors hover:bg-aws-sea-blue-hover-light">
                  <HiLogout className="mr-2 h-4 w-4" />
                  {t("common.logout")}
                </button>

                {/* 言語切り替えボタン */}
                <LanguageSwitcher />

                {/* バージョン情報 */}
                <div className="mt-4 border-t border-aws-font-color-white-light border-opacity-20 pt-2">
                  <div className="text-center text-xs text-aws-font-color-white-light text-opacity-70">
                    Version: {getVersion()}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* モバイル表示時のオーバーレイ */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black bg-opacity-50 md:hidden"
          onClick={toggleSidebar}></div>
      )}
    </>
  );
}
