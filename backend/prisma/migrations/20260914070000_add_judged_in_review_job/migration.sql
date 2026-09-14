-- AlterTable
ALTER TABLE `review_results` ADD COLUMN `judged_in_review_job_id` VARCHAR(26) NULL;

-- CreateIndex
CREATE INDEX `idx_review_results_judged_in_job` ON `review_results`(`judged_in_review_job_id`);

-- AddForeignKey
ALTER TABLE `review_results` ADD CONSTRAINT `review_results_judged_in_review_job_id_fkey` FOREIGN KEY (`judged_in_review_job_id`) REFERENCES `review_jobs`(`review_job_id`) ON DELETE SET NULL ON UPDATE CASCADE;

