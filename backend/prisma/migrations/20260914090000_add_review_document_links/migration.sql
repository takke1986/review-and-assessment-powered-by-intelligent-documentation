-- AlterTable
ALTER TABLE `review_documents` ADD COLUMN `carried_from_document_id` VARCHAR(26) NULL,
    ADD COLUMN `replaces_document_id` VARCHAR(26) NULL;

-- CreateIndex
CREATE INDEX `idx_review_documents_carried_from` ON `review_documents`(`carried_from_document_id`);

-- CreateIndex
CREATE INDEX `idx_review_documents_replaces` ON `review_documents`(`replaces_document_id`);

-- AddForeignKey
ALTER TABLE `review_documents` ADD CONSTRAINT `review_documents_carried_from_document_id_fkey` FOREIGN KEY (`carried_from_document_id`) REFERENCES `review_documents`(`review_document_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review_documents` ADD CONSTRAINT `review_documents_replaces_document_id_fkey` FOREIGN KEY (`replaces_document_id`) REFERENCES `review_documents`(`review_document_id`) ON DELETE SET NULL ON UPDATE CASCADE;

