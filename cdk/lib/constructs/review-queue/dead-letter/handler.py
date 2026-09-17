"""
デッドレターキューに落ちた審査ジョブを「失敗」にする。

本キューで規定回数を超えて処理できなかったメッセージはデッドレターキューへ移る。
そのままでは誰も見ないのでジョブは「待機中」のまま残り、利用者には止まったように見える。
ここで受け取って、審査ジョブを失敗として記録する Lambda を呼ぶ。
"""

import json
import logging
import os

import boto3

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

ERROR_LAMBDA_NAME = os.environ["ERROR_LAMBDA_NAME"]

lambda_client = boto3.client("lambda")


def lambda_handler(event, context):
    for message in event.get("Records", []):
        message_id = message.get("messageId", "")
        try:
            body = json.loads(message.get("body", ""))
        except json.JSONDecodeError:
            logger.error("Invalid message body (message_id=%s)", message_id)
            continue

        review_job_id = body.get("reviewJobId")
        if not review_job_id:
            logger.error("reviewJobId is missing (message_id=%s)", message_id)
            continue

        error_event = {
            "action": "handleReviewError",
            "reviewJobId": review_job_id,
            "error": "QUEUE_DEAD_LETTER_ERROR",
        }
        user_id = body.get("userId")
        if user_id:
            error_event["userId"] = user_id

        lambda_client.invoke(
            FunctionName=ERROR_LAMBDA_NAME,
            Payload=json.dumps(error_event),
        )
        logger.error(
            "Review job marked as failed because its message reached the dead-letter queue: %s",
            review_job_id,
        )

    return {"batchItemFailures": []}
