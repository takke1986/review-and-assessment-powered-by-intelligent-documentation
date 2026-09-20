-- 審査がどの部署の仕事かを記録する。
--
-- 兼務があるので「作った人の所属」だけでは決まらない。営業と法務を兼ねる人の
-- 審査を、法務の同僚に見せてよいとは限らないため、審査ごとに持つ。
--
-- 部署を使わない運用でも止まらないよう、入っていなくてよい。
ALTER TABLE `review_jobs` ADD COLUMN `department_id` VARCHAR(100) NULL;

-- 部署で絞る一覧が主な使い道になる
CREATE INDEX `idx_review_jobs_department` ON `review_jobs` (`department_id`);
