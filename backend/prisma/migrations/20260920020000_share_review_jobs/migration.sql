-- 審査ジョブを社内に公開できるようにする。
-- 審査は担当者ひとりで完結しない。上長や後任が結果を開けないと、
-- 紙か CSV を渡すしかなく、根拠まで辿れなくなる。
--
-- 公開しても見られるだけで、判定の変更と削除は作成者のまま。
ALTER TABLE `review_jobs` ADD COLUMN `shared_with_org` BOOLEAN NOT NULL DEFAULT false;
