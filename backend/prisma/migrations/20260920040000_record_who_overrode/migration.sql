-- 判定を覆したのが誰かを残す。
--
-- これまでは「人が覆した」という真偽値だけだった。自分の審査しか見えない
-- うちは困らなかったが、社内に公開できるようにしたので、他の人の審査を
-- 開いても誰が決めたのか分からない。顧客に渡すレポートにも出せない。
--
-- 名前はそのときの値を控える。あとで利用者の登録が変わっても、
-- 「そのとき誰が決めたか」は変わらないため。
ALTER TABLE `review_results` ADD COLUMN `overridden_by` VARCHAR(255) NULL;
ALTER TABLE `review_results` ADD COLUMN `overridden_at` TIMESTAMP NULL;
