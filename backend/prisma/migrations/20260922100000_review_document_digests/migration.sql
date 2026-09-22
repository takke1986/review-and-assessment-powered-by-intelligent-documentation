-- 文書と読み取り結果の対応を、キー規則ではなく行として持つ
--
-- これまでは S3 のキーを「digest/{jobId}/{元のキー}.json」と組み立てて
-- 対応を表していた。規則が守られている間しか成り立たず、ファイルが
-- 差し替わる・キーが変わる・ライフサイクルで消える、といった場合に
-- 対応が黙って崩れる。どの審査がどれを読んだかも SQL で追えなかった。
--
-- 本文の書き起こしは大きく検索もしないので S3 に置いたまま。ここが持つのは
-- 「どこにあるか」と「何が読めたか」だけ。
--
-- 照合順序は既存の表に合わせる（utf8mb4_unicode_ci）。ID の列は他の表でも
-- この並びのままで、外部キーは参照先と同じ並びでないと張れない。
-- 日本語検索のために as_ci にしたのは、名前など検索に使う列だけ。
-- この3表に検索する列は無いので、揃える必要はない。
-- CreateTable
CREATE TABLE `review_document_digests` (
    `review_document_digest_id` VARCHAR(26) NOT NULL,
    `review_document_id` VARCHAR(26) NOT NULL,
    `s3_key` VARCHAR(1024) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'completed',
    `created_at` TIMESTAMP(0) NOT NULL,
    `updated_at` TIMESTAMP(0) NOT NULL,

    UNIQUE INDEX `review_document_digests_review_document_id_key`(`review_document_id`),
    PRIMARY KEY (`review_document_digest_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `review_document_pages` (
    `review_document_page_id` VARCHAR(26) NOT NULL,
    `digest_id` VARCHAR(26) NOT NULL,
    `page_number` INTEGER NOT NULL,
    `was_read` BOOLEAN NOT NULL DEFAULT true,
    `has_figure` BOOLEAN NOT NULL DEFAULT false,
    `char_count` INTEGER NOT NULL DEFAULT 0,

    INDEX `idx_review_document_page_read`(`digest_id`, `was_read`),
    UNIQUE INDEX `uniq_review_document_page`(`digest_id`, `page_number`),
    PRIMARY KEY (`review_document_page_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `review_document_images` (
    `review_document_image_id` VARCHAR(26) NOT NULL,
    `digest_id` VARCHAR(26) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `has_text` BOOLEAN NOT NULL DEFAULT false,
    `has_description` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `uniq_review_document_image`(`digest_id`, `name`),
    PRIMARY KEY (`review_document_image_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `review_document_digests` ADD CONSTRAINT `review_document_digests_review_document_id_fkey` FOREIGN KEY (`review_document_id`) REFERENCES `review_documents`(`review_document_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review_document_pages` ADD CONSTRAINT `review_document_pages_digest_id_fkey` FOREIGN KEY (`digest_id`) REFERENCES `review_document_digests`(`review_document_digest_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review_document_images` ADD CONSTRAINT `review_document_images_digest_id_fkey` FOREIGN KEY (`digest_id`) REFERENCES `review_document_digests`(`review_document_digest_id`) ON DELETE CASCADE ON UPDATE CASCADE;

