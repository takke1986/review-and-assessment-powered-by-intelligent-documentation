-- チェックリストを最後に直した人。同じ部署の人も直せるようになったので、
-- 誰が変えたかを残す。既存のチェックリストには入らないので NULL を許す
ALTER TABLE `check_list_sets`
  ADD COLUMN `last_edited_by` VARCHAR(50) NULL,
  ADD COLUMN `last_edited_by_name` VARCHAR(255) NULL,
  ADD COLUMN `last_edited_at` TIMESTAMP(0) NULL;
