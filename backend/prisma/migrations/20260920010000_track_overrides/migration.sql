-- 上書きされた判定から「AI がどこを間違えたか」を読めるようにする。
-- これまでは上書きで result が書き換わり、AI の判定は残っていなかった。

-- AI が下した判定。上書きしても変わらない。
-- この変更より前の結果には入らないので、向きは分からない
ALTER TABLE `review_results` ADD COLUMN `ai_result` VARCHAR(20) NULL;

-- 覆した理由。自由記述のコメントとは別に、集計できる形で持つ
ALTER TABLE `review_results` ADD COLUMN `override_reason` VARCHAR(30) NULL;

-- 着眼点を書いた日時。書く前と後で覆された率を比べるために要る
ALTER TABLE `check_lists` ADD COLUMN `review_guidance_updated_at` TIMESTAMP NULL;
