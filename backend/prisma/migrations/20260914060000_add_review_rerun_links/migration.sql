-- AlterTable
ALTER TABLE `review_jobs` ADD COLUMN `source_review_job_id` VARCHAR(26) NULL;

-- AlterTable
ALTER TABLE `review_results` ADD COLUMN `carried_over` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `previous_result_id` VARCHAR(26) NULL;

-- CreateIndex
CREATE INDEX `idx_review_jobs_source_review_job` ON `review_jobs`(`source_review_job_id`);

-- CreateIndex
CREATE INDEX `idx_review_results_previous_result` ON `review_results`(`previous_result_id`);

-- AddForeignKey
ALTER TABLE `review_jobs` ADD CONSTRAINT `review_jobs_source_review_job_id_fkey` FOREIGN KEY (`source_review_job_id`) REFERENCES `review_jobs`(`review_job_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review_results` ADD CONSTRAINT `review_results_previous_result_id_fkey` FOREIGN KEY (`previous_result_id`) REFERENCES `review_results`(`review_result_id`) ON DELETE SET NULL ON UPDATE CASCADE;

