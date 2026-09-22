-- チェックリストとプロンプトにも部署を持たせる。
-- 審査ジョブと同じく「自分＋自分の部署」で見えるようにするため。
--
-- 既存の行は NULL のまま。これまでどおり作成者にだけ見える。
-- 後から埋めることはしない（誰のどの部署のものだったかを推測で決めると、
-- 見えてはいけない相手に見えるほうへ倒れる）。
--
-- 照合順序は既存の列に合わせる。department_id は文字列の突き合わせに使うので、
-- 審査ジョブ側（review_jobs.department_id）とずれると同じ部署が別物になる。
ALTER TABLE `check_list_sets`
  ADD COLUMN `department_id` VARCHAR(100) NULL;

ALTER TABLE `prompt_templates`
  ADD COLUMN `department_id` VARCHAR(100) NULL;

-- 部署で絞った一覧を、並べ替えまで索引だけで返す
CREATE INDEX `idx_check_list_sets_dept_created`
  ON `check_list_sets` (`department_id`, `created_at`);

CREATE INDEX `idx_prompt_templates_dept`
  ON `prompt_templates` (`department_id`, `type`, `updated_at`);
