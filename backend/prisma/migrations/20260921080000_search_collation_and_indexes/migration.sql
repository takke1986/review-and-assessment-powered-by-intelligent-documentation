-- 日本語検索の照合順序を見直し、索引の取捨を直す
--
-- 1. 照合順序を utf8mb4_ja_0900_as_ci 相当（utf8mb4_0900_as_ci）にする
--    前の移行で utf8mb4_ja_0900_as_cs にしたが、cs は大文字小文字も区別するため
--    「aws」で「AWS」が引けなくなっていた。utf8mb4_0900_as_ci なら
--    濁点は区別し、ひらがなカタカナと英字の大小は同一視する。実測:
--      は/ば    ja_0900_as_cs 区別  0900_as_ci 区別
--      はし/ハシ  どちらも同一視
--      aws/AWS  ja_0900_as_cs 区別（不都合）  0900_as_ci 同一視
--
-- 2. 表の既定の照合順序も変える
--    列だけ変えても、将来 Prisma が COLLATE 省略の MODIFY を生成すると
--    表の既定（utf8mb4_unicode_ci）に戻り、日本語検索が黙って壊れる。実測済み:
--      表の既定 unicode_ci + 列 as_ci → COLLATE なしの MODIFY → 列が unicode_ci に戻った
--      表の既定も as_ci             → 同じ MODIFY → 列は as_ci のまま
--    Prisma は列の照合順序をモデル化しないので、この保険が唯一の機械的な歯止め。
--
-- なお、照合順序は検索だけでなく一意制約と並び順にも効く。
-- prompt_templates の @@unique([userId, name, type]) は、元の unicode_ci では
-- 濁点違いも同じものとして弾いていたが、as_ci では別のものとして通る。
-- 検索を正すと連動して変わる部分で、意図した変更。
--
-- 既存データの NFC そろえについて: 前の移行はカナの濁点・半濁点58組を対象にした。
-- ラテン文字の分解形（e + U+0301 など）は対象外で、NFD のまま残る。

ALTER TABLE `review_jobs` MODIFY `name` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci NOT NULL;
ALTER TABLE `review_documents` MODIFY `filename` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci NOT NULL;
ALTER TABLE `tool_configurations` MODIFY `name` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci NOT NULL;
ALTER TABLE `prompt_templates` MODIFY `name` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci NOT NULL;
ALTER TABLE `check_list_sets` MODIFY `name` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci NOT NULL;
ALTER TABLE `checklist_documents` MODIFY `filename` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci NOT NULL;

ALTER TABLE `review_jobs` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;
ALTER TABLE `review_documents` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;
ALTER TABLE `tool_configurations` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;
ALTER TABLE `prompt_templates` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;
ALTER TABLE `check_list_sets` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;
ALTER TABLE `checklist_documents` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- 3. 索引の取捨
--    shared_with_org は社内共有を外した時点（b52b6f9）から、backend・frontend・
--    review-item-processor のどこからも参照されていない。索引の維持費だけ払うので落とす。
--    一覧の絞り込みは実際には user_id と department_id なので、部署側にも
--    並べ替えを載せた索引を置く。department_id 単独の索引はその先頭部分なので重複。
DROP INDEX `idx_review_jobs_shared_created` ON `review_jobs`;
CREATE INDEX `idx_review_jobs_dept_created` ON `review_jobs` (`department_id`, `created_at`);
DROP INDEX `idx_review_jobs_department` ON `review_jobs`;

-- チェックリスト一覧の既定の並びも created_at。索引が無く filesort になっていた
CREATE INDEX `idx_check_list_sets_created` ON `check_list_sets` (`created_at`);