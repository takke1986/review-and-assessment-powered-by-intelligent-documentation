-- 一覧が毎回テーブル全体を読んで並べ替えていたのを直す
--
-- 審査ジョブ一覧は「自分のもの＋社内に公開されたもの」で絞り、作成日時の新しい順に
-- 20件だけ出す。並べ替えに使う created_at に索引が無かったため、5万件のときは
-- 5万行を読んでから並べ替えていた（EXPLAIN が type: ALL と Using filesort）。
-- 絞り込みと並べ替えを索引順にたどれるようにする。
CREATE INDEX idx_review_jobs_created ON review_jobs (created_at);
CREATE INDEX idx_review_jobs_user_created ON review_jobs (user_id, created_at);
CREATE INDEX idx_review_jobs_shared_created ON review_jobs (shared_with_org, created_at);
CREATE INDEX idx_review_jobs_status_created ON review_jobs (status, created_at);

-- ツール設定は主キーしか索引が無く、並べ替えのたびにソートが走っていた
CREATE INDEX idx_tool_configurations_created ON tool_configurations (created_at);
CREATE INDEX idx_tool_configurations_name ON tool_configurations (name);
