-- 審査を始めた人の表示名。誰が回したかを一覧に出すために持つ。
-- 既存のジョブには入らないので NULL を許す（画面側で「不明」として扱う）
ALTER TABLE `review_jobs` ADD COLUMN `user_name` VARCHAR(255) NULL;
