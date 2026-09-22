"""チェック項目1つを審査する本体。

index.py（AgentCore の入口）から process_review が呼ばれ、1項目ぶんの
判定（pass / fail・根拠・費用）を返す。DB には繋がない。S3 と Bedrock だけを見る。

## 流れ

    process_review
      └ process_review_from_s3     書類を S3 から一時フォルダへ落とす
          └ _execute_review_core   どの経路で読ませるかを決め、モデルを呼ぶ
              ├ 先に読み取った結果がある → _run_agent_with_document_tools
              └ _choose_route で経路を決める
                  ├ document_block  → _run_agent_with_document_block  （ファイルをそのまま渡す）
                  ├ document_tools  → _run_agent_with_document_tools  （道具で必要な所だけ読ませる）
                  └ file_read       → _run_agent_with_file_read_tool  （画像を拡大・切り出しして見る）
              └ _validate_and_complete_result  欠けた欄を埋める（壊れた応答は fail に倒す）

経路の決め方と判定の基準値は docs/05-審査の流れ.md にまとめてある。

## 部品の置き場所

    review_prompts.py    モデルに渡す指示文
    review_documents.py  書類を1回の要求に収まる形に組み立てる
    document_library.py  道具（list_documents / read_pdf_pages など）
    review_pictures.py   画像を枚数を数えながら見せる
    review_sources.py    モデルが返した「根拠の場所」を整える
    pdf_extras.py        PDF の記入値・注釈（本文に出ないもの）を読む
    pricing.py           トークン数から費用を出す
    digest_store.py      先に読み取った結果を S3 から取ってくる

## 本家由来で使われていないもの

SONNET_MODEL_ID / NOVA_PREMIER_MODEL_ID / PDF_FILE_EXTENSIONS /
create_mcp_client / list_tools_sync などは、このファイルの中でもほかでも
使われていない。本家（aws-samples）から引き継いだもので、本家の更新を
取り込むときに衝突しないよう、あえて消さずに残している。
"""

import hashlib
import json
import os
import re
import tempfile
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import boto3
from strands import Agent
from strands.models import BedrockModel
from strands.models.model import CacheConfig
from strands.tools.mcp import MCPClient
from strands_tools import file_read

from PIL import Image

from review_images import encode_image
from review_prompts import (
    ATTACHED_IMAGES_ACCESS,
    DOCUMENT_TOOLS_ACCESS,
    get_document_review_prompt,
    get_image_review_prompt,
)
from document_library import (
    MAX_IMAGES_PER_REVIEW,
    DocumentLibrary,
    create_document_tools,
)
from logger import logger
from model_config import ModelConfig
from review_documents import (
    RequestTooLargeError,
    ReviewFile,
    build_document_blocks,
    write_office_files_as_markdown,
)
from review_images import prepare_image_file
import digest_store
from pdf_extras import has_hidden_content
from review_pictures import PictureViewer, create_picture_tools, _pictures_already_read
from review_sources import _normalize_sources
from pricing import (
    CACHE_READ_MULTIPLIER,
    CACHE_WRITE_MULTIPLIER,
    cost_of,
    counts_from_usage,
    saved_by_cache,
)
from tool_history_collector import ToolHistoryCollector
from tools.factory import create_custom_tools


class ReviewMetaTracker:
    """Class to track review metadata such as pricing and execution time."""

    def __init__(self, model_id: str):
        self.model = ModelConfig.create(model_id)
        self.start_time = time.time()

    def get_review_meta(self, agent_result) -> Dict[str, Any]:
        """Extract review metadata from the agent result.

        キャッシュした分も数える。Bedrock はキャッシュのトークンを
        inputTokens に入れず別の欄で返すので、inputTokens だけを見ると
        書類を読んだ費用がまるごと抜け落ちる（pricing.py に経緯）
        """
        end_time = time.time()
        duration = end_time - self.start_time

        usage = agent_result.metrics.accumulated_usage
        counts = counts_from_usage(usage)
        cost = cost_of(
            counts,
            input_per_1k=self.model.input_per_1k,
            output_per_1k=self.model.output_per_1k,
        )
        saved = saved_by_cache(counts, input_per_1k=self.model.input_per_1k)

        logger.info(
            "Token usage: input=%s output=%s cache_read=%s cache_write=%s cost=$%.6f",
            counts.input_tokens,
            counts.output_tokens,
            counts.cache_read_tokens,
            counts.cache_write_tokens,
            cost.total,
        )

        return {
            "model_id": self.model.model_id,
            # 費用の内訳に使う。キャッシュの分はここに出さないと消える
            "input_tokens": counts.input_tokens,
            "output_tokens": counts.output_tokens,
            "cache_read_tokens": counts.cache_read_tokens,
            "cache_write_tokens": counts.cache_write_tokens,
            # モデルが読んだ入力の総量。キャッシュが効くほど input_tokens は
            # 小さく見えるので、「どれだけ読ませたか」はこちらで見る
            "total_input_tokens": counts.total_input,
            "input_cost": cost.input_cost,
            "output_cost": cost.output_cost,
            "cache_read_cost": cost.cache_read_cost,
            "cache_write_cost": cost.cache_write_cost,
            "cache_saving": saved,
            "total_cost": cost.total,
            "pricing": {
                "input_per_1k": self.model.input_per_1k,
                "output_per_1k": self.model.output_per_1k,
                "cache_write_per_1k": self.model.input_per_1k * CACHE_WRITE_MULTIPLIER,
                "cache_read_per_1k": self.model.input_per_1k * CACHE_READ_MULTIPLIER,
            },
            "duration_seconds": round(duration, 2),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }


# File type constants
IMAGE_FILE_EXTENSIONS = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".bmp",
    ".tif",
    ".tiff",
    ".webp",
]
PDF_FILE_EXTENSIONS = [".pdf"]

# Default model IDs
DEFAULT_DOCUMENT_MODEL_ID = "global.anthropic.claude-sonnet-4-6"  # For all processing
DEFAULT_IMAGE_MODEL_ID = "global.anthropic.claude-sonnet-4-6"  # For image processing (same as document by default)

# Get model IDs from environment variables with fallback to defaults
DOCUMENT_MODEL_ID = os.environ.get(
    "DOCUMENT_PROCESSING_MODEL_ID", DEFAULT_DOCUMENT_MODEL_ID
)
IMAGE_MODEL_ID = os.environ.get("IMAGE_REVIEW_MODEL_ID", DEFAULT_IMAGE_MODEL_ID)

# Log model configuration
if os.environ.get("DOCUMENT_PROCESSING_MODEL_ID"):
    logger.info(f"INFO: Using custom document processing model: {DOCUMENT_MODEL_ID}")
else:
    logger.info(f"INFO: Using default document processing model: {DOCUMENT_MODEL_ID}")

if os.environ.get("IMAGE_REVIEW_MODEL_ID"):
    logger.info(f"INFO: Using custom image review model: {IMAGE_MODEL_ID}")
else:
    logger.info(f"INFO: Using default image review model: {IMAGE_MODEL_ID}")

# Backward compatibility
SONNET_MODEL_ID = DOCUMENT_MODEL_ID
NOVA_PREMIER_MODEL_ID = IMAGE_MODEL_ID

# Get environment variables
AWS_REGION = os.environ.get("AWS_REGION", "us-west-2")
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "us-west-2")
ENABLE_CITATIONS = os.environ.get("ENABLE_CITATIONS", "true").lower() == "true"
# Tool text truncate length
TOOL_TEXT_TRUNCATE_LENGTH = 500


def _apply_cache_config(bedrock_config: Dict[str, Any]) -> None:
    """Enable auto prompt caching so the document/image prefix is cached too."""
    bedrock_config["cache_config"] = CacheConfig(strategy="auto")
    bedrock_config["cache_tools"] = "default"


def supports_caching(model_id: str) -> bool:
    """
    Check if the given model supports prompt and tool caching.

    Args:
        model_id: Bedrock model ID to check

    Returns:
        True if the model supports caching, False otherwise
    """
    model = ModelConfig.create(model_id)
    return model.supports_caching


# 書類をモデルに渡す経路
ROUTE_DOCUMENT_BLOCK = "document_block"
"""ファイルをそのまま要求に載せる。1回で収まるときの既定"""

ROUTE_DOCUMENT_TOOLS = "document_tools"
"""document_library の道具で読ませる。本文に出ない中身（注釈・記入値）を
こちらで読み出して足せるのは、この経路だけ"""

ROUTE_FILE_READ = "file_read"
"""file_read の道具でファイルを読ませる。画像は拡大や切り出しができる"""


def _choose_route(document_paths: list, model_id: str, has_images: bool) -> str:
    """書類をどの経路でモデルに渡すかを決める。

    以前は「文書ブロックを使うか否か」の真偽値だった。使わない理由が
    3通りあるのに行き先が1つしか無く、**注釈や記入値のある PDF が
    file_read に流れていた**。その経路は本文に出ない中身を足さないので、
    注釈は最後まで読まれない。理由ごとに行き先を分ける。
    """
    model = ModelConfig.create(model_id)
    if not (ENABLE_CITATIONS and model.supports_document_block):
        return ROUTE_FILE_READ

    # 記入済みフォームや注釈を持つ PDF は、道具で読ませる。そのまま渡すと
    # 記入内容が読まれるかどうか分からず、読まれなければ「空の申込書」を
    # 審査することになる。道具の経路なら、こちらで読み出して本文に足せる
    for path in document_paths:
        if path.lower().endswith(".pdf") and has_hidden_content(path):
            logger.info(
                "Reading %s through document tools: it has filled-in fields or notes",
                path,
            )
            return ROUTE_DOCUMENT_TOOLS

    # 画像だけなら、拡大や切り出しができる file_read の経路の方が読み取りやすい。
    # 文書と混ざっているときは、両方を1回の要求に載せられるこちらを使う
    if has_images:
        return (
            ROUTE_DOCUMENT_BLOCK
            if any(
                not path.lower().endswith(tuple(IMAGE_FILE_EXTENSIONS))
                for path in document_paths
            )
            else ROUTE_FILE_READ
        )
    return ROUTE_DOCUMENT_BLOCK


def create_mcp_client(mcp_server_cfg: Dict[str, Any]) -> MCPClient:
    """
    Create an MCP client for the given server configuration.

    Args:
        mcp_server_cfg: MCP server configuration

    Returns:
        MCPClient: Initialized MCP client
    """
    logger.info(f"Creating MCP client with config: {mcp_server_cfg}")
    # TODO
    # return MCPClient(...)
    raise NotImplementedError("MCP is handled directly by AgentCore Runtime")


def sanitize_file_name(filename: str) -> str:
    """
    Sanitize filename to meet Bedrock requirements.
    Bedrock only allows alphanumeric characters, whitespace, hyphens,
    parentheses, and square brackets in filenames.

    Args:
        filename: Original filename

    Returns:
        Sanitized filename
    """
    # Remove file extension if present
    parts = filename.split(".")
    name_without_extension = ".".join(parts[:-1]) if len(parts) > 1 else filename

    # Calculate hash of the original name
    file_hash = hashlib.md5(name_without_extension.encode()).hexdigest()[:8]

    # Create sanitized name
    sanitized = f"doc_{file_hash}"
    logger.debug(f"Sanitized filename: {sanitized} (original: {filename})")

    return sanitized


def _detect_image_file(file_paths: list[str]) -> bool:
    """
    Detect if image files are present in the file path list.

    Returns:
        True if any image file found, False otherwise
    """
    for path in file_paths:
        ext = os.path.splitext(path)[1].lower()
        if ext in IMAGE_FILE_EXTENSIONS:
            return True
    return False


def _as_markdown_files(files: list[ReviewFile], directory: str) -> list[ReviewFile]:
    """file_read ツールは Office ファイルを読めないので、Markdown に変換したファイルに置き換える"""
    paths = write_office_files_as_markdown(files, directory)
    return [ReviewFile(path=path, name=file.name) for path, file in zip(paths, files)]


def _as_sendable_images(files: list[ReviewFile], directory: str) -> list[ReviewFile]:
    """Converse が受け付けない大きさや形式（BMP・TIFF）の画像を、縮小や変換をしたコピーに置き換える"""
    return [
        ReviewFile(path=prepare_image_file(file.path, directory), name=file.name)
        for file in files
    ]


def _select_model_for_files(
    has_images: bool, model_id_override: str | None = None
) -> str:
    """
    Select model based on file types.

    Args:
        has_images: Whether image files are present
        model_id_override: User-specified model ID (takes priority)

    Returns:
        Selected model ID
    """
    if model_id_override:
        return model_id_override
    return IMAGE_MODEL_ID if has_images else DOCUMENT_MODEL_ID


def _validate_and_complete_result(
    result: dict[str, Any], has_images: bool
) -> dict[str, Any]:
    """
    Validate and complete required fields in the result dict.
    """
    # Set defaults for required fields
    if "result" not in result:
        result["result"] = "fail"
    if "confidence" not in result:
        result["confidence"] = 0.5
    if "explanation" not in result:
        result["explanation"] = "No explanation provided"
    if "shortExplanation" not in result:
        result["shortExplanation"] = "No short explanation provided"
    if "verificationDetails" not in result:
        result["verificationDetails"] = {"sourcesDetails": []}
    elif "sourcesDetails" not in result["verificationDetails"]:
        result["verificationDetails"]["sourcesDetails"] = []

    # File type-specific fields
    if has_images:
        if "usedImageIndexes" not in result:
            result["usedImageIndexes"] = []
        if "boundingBoxes" not in result:
            result["boundingBoxes"] = []
    else:
        if "extractedText" not in result:
            result["extractedText"] = ""
        if "pageNumber" not in result:
            result["pageNumber"] = 1
        result["sources"] = _normalize_sources(result.get("sources"))

    return result


def _execute_review_core(
    files: list[ReviewFile],
    has_images: bool,
    check_name: str,
    check_description: str,
    language_name: str,
    model_id: str,
    toolConfiguration: dict[str, Any] | None,
    feedback_summary: str | None,
    review_guidance: str | None = None,
    digests: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Execute review from local files (common logic).

    Args:
        files: Local files, with the names they were uploaded as
        has_images: Whether image files are present
        check_name: Check item name
        check_description: Check item description
        language_name: Language name
        model_id: Model ID to use
        toolConfiguration: Tool configuration
        feedback_summary: Feedback summary

    Returns:
        Review result dict
    """
    # Determine processing method
    route = _choose_route([file.path for file in files], model_id, has_images)

    # 先に読み取ってある書類は、道具で読ませる。読み取りは「1回で渡せない」
    # か「文字が取り出せない」書類にしか作られていない。とくにスキャンした
    # 短い PDF は、そのまま渡しても上限に当たらないので、この分岐がないと
    # 読み取り結果を使わないまま、中身の薄い判定になる。
    # 画像そのものを審査するジョブは別の道（画像を直接見る）なので触らない
    if digests and not has_images:
        logger.info(
            "Reading the files through document tools: %s of them were "
            "transcribed before the review",
            len(digests),
        )
        result = _run_agent_with_document_tools(
            prompt=get_document_review_prompt(
                language_name,
                check_name,
                check_description,
                use_citations=False,
                tool_config=toolConfiguration,
                feedback_summary=feedback_summary,
                review_guidance=review_guidance,
                document_access=DOCUMENT_TOOLS_ACCESS,
            ),
            files=files,
            model_id=model_id,
            system_prompt=(
                "You are an expert document reviewer. "
                "Analyze the provided files and evaluate the check item. "
                f"All responses must be in {language_name}."
            ),
            toolConfiguration=toolConfiguration,
            digests=digests,
        )
        result["reviewType"] = "PDF"
        return result

    logger.info("Processing method: %s, model=%s", route, model_id)

    # どの経路でも同じ。経路ごとに書くと、足した分岐で組み立て忘れる
    # （実際に忘れて UnboundLocalError で審査が全部落ちた）
    system_prompt = (
        f"You are an expert document reviewer. "
        f"Analyze the provided files and evaluate the check item. "
        f"All responses must be in {language_name}."
    )

    # Generate prompt and execute
    if route == ROUTE_DOCUMENT_BLOCK:
        # Document block path（PDF with citations）
        prompt = get_document_review_prompt(
            language_name,
            check_name,
            check_description,
            use_citations=False,  # Model auto-detects
            tool_config=toolConfiguration,
            feedback_summary=feedback_summary,
            review_guidance=review_guidance,
            document_access=ATTACHED_IMAGES_ACCESS if has_images else None,
        )

        try:
            result = _run_agent_with_document_block(
                prompt=prompt,
                files=files,
                model_id=model_id,
                system_prompt=system_prompt,
                toolConfiguration=toolConfiguration,
            )
            logger.debug("Used document block processing")
        except RequestTooLargeError as error:
            # 1回の呼び出しに収まらないジョブだけ、ツールで必要な箇所を読ませる
            logger.info(f"Reading the files through document tools: {error}")
            result = _run_agent_with_document_tools(
                prompt=get_document_review_prompt(
                    language_name,
                    check_name,
                    check_description,
                    use_citations=False,
                    tool_config=toolConfiguration,
                    feedback_summary=feedback_summary,
                    review_guidance=review_guidance,
                    document_access=DOCUMENT_TOOLS_ACCESS,
                ),
                files=files,
                converted=error.converted,
                model_id=model_id,
                system_prompt=system_prompt,
                toolConfiguration=toolConfiguration,
                digests=digests,
            )
        result["reviewType"] = "PDF"

    elif route == ROUTE_DOCUMENT_TOOLS:
        # 記入値や注釈のある PDF。document_library の道具でないと、本文に
        # 出ない中身を足せない。file_read に流すと注釈は最後まで読まれない
        result = _run_agent_with_document_tools(
            prompt=get_document_review_prompt(
                language_name,
                check_name,
                check_description,
                use_citations=False,
                tool_config=toolConfiguration,
                feedback_summary=feedback_summary,
                review_guidance=review_guidance,
                document_access=DOCUMENT_TOOLS_ACCESS,
            ),
            files=files,
            model_id=model_id,
            system_prompt=system_prompt,
            toolConfiguration=toolConfiguration,
            digests=digests,
        )
        result["reviewType"] = "PDF"

    else:
        # File read tool path (images or non-citation support)
        if has_images:
            prompt = get_image_review_prompt(
                language_name,
                check_name,
                check_description,
                model_id,
                tool_config=toolConfiguration,
                feedback_summary=feedback_summary,
                review_guidance=review_guidance,
            )
            # 先に読んである画像は、その中身を指示に添える。開かずに判断
            # できるものが増え、1回に見られる20枚の枠が、本当に見る必要の
            # あるものに残る。枠は見直した分も数に入るので、ここを言わないと
            # 素直に全部開いて上限に当たる
            prompt += _pictures_already_read(files, digests)
            picture_viewer = PictureViewer(files)
            tools = [file_read] + create_picture_tools(picture_viewer)

            review_type = "IMAGE"
        else:
            prompt = get_document_review_prompt(
                language_name,
                check_name,
                check_description,
                use_citations=False,
                tool_config=toolConfiguration,
                feedback_summary=feedback_summary,
                review_guidance=review_guidance,
            )
            picture_viewer = None
            tools = [file_read]
            review_type = "PDF"


        with tempfile.TemporaryDirectory() as converted_directory:
            result = _run_agent_with_file_read_tool(
                prompt=prompt,
                files=(
                    _as_sendable_images(files, converted_directory)
                    if has_images
                    else _as_markdown_files(files, converted_directory)
                ),
                model_id=model_id,
                system_prompt=system_prompt,
                base_tools=tools,
                toolConfiguration=toolConfiguration,
                picture_viewer=picture_viewer,
            )
        result["reviewType"] = review_type
        logger.debug("Used file_read tool processing")

    # Validate and complete results
    result = _validate_and_complete_result(result, has_images)

    logger.info(f"Review completed with reviewType: {result['reviewType']}")

    return result


def list_tools_sync(client: MCPClient) -> List[Dict[str, Any]]:
    """
    List available tools from an MCP client.

    Args:
        client: MCP client

    Returns:
        List of tool definitions
    """
    logger.debug("Listing tools from MCP client")
    try:
        # Use the built-in list_tools_sync method directly
        tools = client.list_tools_sync()
        logger.debug(f"Found {len(tools)} tools from MCP client")
        return tools
    except Exception as e:
        logger.error(f"Error listing tools from MCP client: {e}")
        return []


# Agent execution functions
def _run_agent_with_file_read_tool(
    prompt: str,
    files: List[ReviewFile],
    model_id: str = DOCUMENT_MODEL_ID,
    system_prompt: str = "You are an expert document reviewer.",
    temperature: float = 0.0,
    base_tools: Optional[List[Any]] = None,
    toolConfiguration: Optional[Dict[str, Any]] = None,
    picture_viewer: Optional["PictureViewer"] = None,
) -> Dict[str, Any]:
    """Run Strands agent with traditional file_read approach"""
    logger.debug(f"Running Strands agent with {len(files)} files")
    logger.debug(f"Tool configuration: {toolConfiguration}")

    meta_tracker = ReviewMetaTracker(model_id)
    history_collector = ToolHistoryCollector(truncate_length=TOOL_TEXT_TRUNCATE_LENGTH)

    # Use provided base tools or default to file_read
    tools_to_use = base_tools if base_tools else [file_read]

    # Add custom tools based on configuration
    custom_tools = create_custom_tools(toolConfiguration)

    # Managed Integration: MCPClient passed directly to Agent
    # Agent handles lifecycle automatically
    tools = tools_to_use + custom_tools
    logger.debug(f"Total tools available: {len(tools)}")

    # Create Strands agent
    logger.debug(f"Creating Strands agent with model: {model_id}")

    # Check if model supports caching
    model = ModelConfig.create(model_id)
    model_supports_cache = model.supports_caching
    logger.debug(f"Model {model_id} caching support: {model_supports_cache}")

    # Configure BedrockModel with conditional caching
    bedrock_config = {
        "model_id": model_id,
        "region_name": BEDROCK_REGION,
        "temperature": temperature,
        "streaming": False,  # Always disable streaming since this app doesn't use streaming
    }

    if model_supports_cache:
        _apply_cache_config(bedrock_config)
        logger.debug("Caching enabled (auto strategy)")
    else:
        logger.debug("Caching disabled - model does not support prompt caching")

    agent = Agent(
        model=BedrockModel(**bedrock_config),
        tools=tools,
        system_prompt=system_prompt,
        hooks=[history_collector],
    )

    # Add file references to the prompt
    files_prompt = "\n".join(
        f"- '{file.path}' (uploaded as {file.name})" for file in files
    )
    full_prompt = f"{prompt}\n\nPlease analyze the following files:\n{files_prompt}"

    logger.debug(f"Running agent with prompt: {full_prompt[:100]}...")
    logger.debug(f"Full prompt: {full_prompt}")

    # Run agent synchronously
    logger.debug("Executing agent completion")
    response = agent(full_prompt)
    logger.debug("Agent response received")

    result = _agent_message_to_dict_legacy(response.message, response)
    logger.debug("type(response.message)=%s", type(response.message))
    logger.debug("message.content (trunc)=%s", str(response.message)[:300])

    # Set tool usage history from hook
    result["verificationDetails"] = {"sourcesDetails": history_collector.executions}

    logger.debug("Extracting usage metrics from agent result")
    review_meta = meta_tracker.get_review_meta(response)
    if picture_viewer is not None:
        # 何枚見たか、上限で断ったかを残す。断ったなら「全部は見ていない
        # 判定」なので、画面でそう分かるようにする
        review_meta["images_seen"] = picture_viewer.images_returned
        review_meta["image_limit"] = MAX_IMAGES_PER_REVIEW
        review_meta["image_limit_reached"] = picture_viewer.refused
    result["reviewMeta"] = review_meta
    # キャッシュから読んだ分も含めた「実際に読ませた量」。inputTokens だけを
    # 入れると、キャッシュが効くほど読ませた量が小さく見える
    result["inputTokens"] = review_meta["total_input_tokens"]
    result["outputTokens"] = review_meta["output_tokens"]
    result["totalCost"] = review_meta["total_cost"]

    logger.info(
        f"Token usage: input={review_meta['input_tokens']}, output={review_meta['output_tokens']}, cost=${review_meta['total_cost']:.6f}"
    )
    logger.debug(f"Extracted result dict: {result}")
    return result


def _run_agent_with_document_block(
    prompt: str,
    files: List[ReviewFile],
    model_id: str = DOCUMENT_MODEL_ID,
    system_prompt: str = "You are an expert document reviewer.",
    temperature: float = 0.0,
    toolConfiguration: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Run Strands agent with document block.

    Document block embeds the files directly in the request: PDFs as they are,
    Word, Excel and PowerPoint files as Markdown converted from their XML.
    Citations will be enabled only if model supports it.
    """

    model = ModelConfig.create(model_id)

    logger.debug(
        f"Running agent with document block: {len(files)} files, "
        f"citations.enabled={model.supports_citation}, model={model_id}"
    )

    if not model.supports_citation:
        logger.info(
            f"Citations disabled for {model_id} "
            f"(model supports document block but not citations)"
        )

    meta_tracker = ReviewMetaTracker(model_id)
    history_collector = ToolHistoryCollector(truncate_length=TOOL_TEXT_TRUNCATE_LENGTH)

    custom_tools = create_custom_tools(toolConfiguration)

    # 各文書の前に、元のファイル名を書いたテキストを置く。Converse の上限
    # （文書5つ・画像20枚）に収まらなければ、Markdown や PDF をまとめる
    content = build_document_blocks(files, citations=model.supports_citation)
    content.append({"text": prompt})

    # Configure model
    bedrock_config = {
        "model_id": model_id,
        "region_name": BEDROCK_REGION,
        "temperature": temperature,
        "streaming": False,
    }

    if model.supports_caching:
        _apply_cache_config(bedrock_config)

    agent = Agent(
        model=BedrockModel(**bedrock_config),
        tools=custom_tools,
        system_prompt=system_prompt,
        hooks=[history_collector],
    )

    logger.debug("Executing agent with document block")
    response = agent(content)

    result = _agent_message_to_dict(
        response.message, response, use_citations=model.supports_citation
    )

    result["verificationDetails"] = {"sourcesDetails": history_collector.executions}
    review_meta = meta_tracker.get_review_meta(response)
    result["reviewMeta"] = review_meta
    # キャッシュから読んだ分も含めた「実際に読ませた量」。inputTokens だけを
    # 入れると、キャッシュが効くほど読ませた量が小さく見える
    result["inputTokens"] = review_meta["total_input_tokens"]
    result["outputTokens"] = review_meta["output_tokens"]
    result["totalCost"] = review_meta["total_cost"]

    return result


def _run_agent_with_document_tools(
    prompt: str,
    files: List[ReviewFile],
    model_id: str = DOCUMENT_MODEL_ID,
    system_prompt: str = "You are an expert document reviewer.",
    temperature: float = 0.0,
    toolConfiguration: Optional[Dict[str, Any]] = None,
    converted: Optional[Dict[str, Any]] = None,
    digests: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Run Strands agent that reads the files through document tools.

    Used only when the files do not fit in one Converse request (see
    review_documents.RequestTooLargeError): the model lists, searches and reads
    pages and sections instead of receiving the whole files.
    """
    model = ModelConfig.create(model_id)
    meta_tracker = ReviewMetaTracker(model_id)
    history_collector = ToolHistoryCollector(truncate_length=TOOL_TEXT_TRUNCATE_LENGTH)

    library = DocumentLibrary(files, converted=converted, digests=digests)
    tools = create_document_tools(library) + create_custom_tools(toolConfiguration)

    bedrock_config = {
        "model_id": model_id,
        "region_name": BEDROCK_REGION,
        "temperature": temperature,
        "streaming": False,
    }
    if model.supports_caching:
        _apply_cache_config(bedrock_config)

    agent = Agent(
        model=BedrockModel(**bedrock_config),
        tools=tools,
        system_prompt=system_prompt,
        hooks=[history_collector],
    )

    logger.debug(f"Executing agent with document tools: {len(files)} files")
    response = agent(prompt)

    result = _agent_message_to_dict_legacy(response.message, response)
    result["verificationDetails"] = {"sourcesDetails": history_collector.executions}
    review_meta = meta_tracker.get_review_meta(response)
    # 何枚見たか、上限で断ったかを残す。断ったなら「全部は見ていない判定」
    # なので、画面でそう分かるようにする
    review_meta["images_seen"] = library.images_returned
    review_meta["image_limit"] = MAX_IMAGES_PER_REVIEW
    review_meta["image_limit_reached"] = (
        library.images_returned >= MAX_IMAGES_PER_REVIEW
    )
    result["reviewMeta"] = review_meta
    # キャッシュから読んだ分も含めた「実際に読ませた量」。inputTokens だけを
    # 入れると、キャッシュが効くほど読ませた量が小さく見える
    result["inputTokens"] = review_meta["total_input_tokens"]
    result["outputTokens"] = review_meta["output_tokens"]
    result["totalCost"] = review_meta["total_cost"]

    logger.info(
        f"Document tools returned {library.chars_returned} characters and "
        f"{library.images_returned} images; token usage: input={review_meta['input_tokens']}, "
        f"output={review_meta['output_tokens']}, cost=${review_meta['total_cost']:.6f}"
    )
    return result


# Message parsing functions
def _extract_json_from_message(message: Any) -> Tuple[Optional[Dict[str, Any]], str]:
    """
    メッセージからJSONとテキストを抽出

    Args:
        message: AgentResult.message

    Returns:
        Tuple[Optional[Dict], str]: (抽出されたJSON dict, 全テキスト)
    """
    if isinstance(message, dict) and "content" in message:
        text_blocks = []
        for block in message["content"]:
            if isinstance(block, dict) and "text" in block:
                text_blocks.append(block["text"])

        combined = "".join(text_blocks).strip()
    else:
        combined = str(message).strip()

    # マーカー付きJSON抽出を試行
    json_match = re.search(r"<<JSON_START>>(.*?)<<JSON_END>>", combined, re.DOTALL)
    if json_match:
        json_str = json_match.group(1).strip()
        try:
            return json.loads(json_str), combined
        except Exception as e:
            logger.warning(f"Marker JSON parsing failed: {e}")

    # フォールバック: 通常のJSON抽出
    m = re.search(r"\{.*\}", combined, re.DOTALL)
    if m:
        json_str = m.group(0)
        try:
            return json.loads(json_str), combined
        except Exception as e:
            logger.warning(f"JSON parsing failed: {e}")

    return None, combined


def _extract_citations_text(message: Any) -> List[str]:
    """
    Extract citations from JSON response as array.

    Note: This method parses citations from the JSON output instead of using
    citationsContent blocks because Strands Agent does not properly support
    citationsContent in non-streaming mode. The model generates <cite> tags
    instead of proper citation blocks when using the Citations API.

    Workaround: We explicitly instruct the model to include citations as a
    JSON array field in the response, then parse and return them here.

    Args:
        message: AgentResult.message containing JSON response

    Returns:
        List[str]: Citations array, or empty list if none found
    """
    try:
        # Extract JSON from message
        parsed_json, _ = _extract_json_from_message(message)

        if parsed_json and "citations" in parsed_json:
            citations = parsed_json["citations"]
            if citations and isinstance(citations, list):
                return citations
    except Exception as e:
        logger.warning(f"Failed to extract citations from JSON: {e}")

    # Return empty list if no citations found
    return []


def _agent_message_to_dict(
    message: Any, agent_response=None, use_citations: bool = False
) -> Dict[str, Any]:
    """
    AgentResult.messageを結果dictに変換（統合版）

    Args:
        message: AgentResult.message
        agent_response: AgentResult（未使用、後方互換性のため保持）
        use_citations: Citation機能を使用するか

    Returns:
        Dict: 審査結果
    """
    # JSON抽出
    parsed_json, combined_text = _extract_json_from_message(message)

    # JSONが抽出できた場合
    if parsed_json:
        result = parsed_json

        # Citation処理
        if use_citations:
            result["extractedText"] = _extract_citations_text(message)

        return result

    # フォールバック
    fallback = {
        "result": "fail",
        "confidence": 0.5,
        "explanation": combined_text,
        "shortExplanation": "Failed to analyze JSON parse",
    }

    if use_citations:
        fallback["extractedText"] = _extract_citations_text(message)

    return fallback


def _agent_message_to_dict_legacy(message: Any, agent_response=None) -> Dict[str, Any]:
    """Convert AgentResult.message (dict or list) to a result dict."""
    return _agent_message_to_dict(message, agent_response, use_citations=False)


# Helper function for dynamic tool section generation
def process_review_from_s3(
    document_bucket: str,
    document_paths: list,
    check_name: str,
    check_description: str,
    language_name: str = "日本語",
    model_id: Optional[str] = None,
    toolConfiguration: Optional[Dict[str, Any]] = None,
    feedback_summary: Optional[str] = None,
    review_guidance: Optional[str] = None,
    review_job_id: str = "",
) -> Dict[str, Any]:
    """
    Download files from S3 and execute review (for production environment).

    Args:
        document_bucket: S3 bucket name
        document_paths: List of S3 object keys
        check_name: Check item name
        check_description: Check item description
        language_name: Language name (default: "日本語")
        model_id: Model ID (auto-selected if None)
        toolConfiguration: Tool configuration
        feedback_summary: Feedback summary

    Returns:
        Review result dict
    """
    logger.debug(f"Processing review for check: {check_name}")
    logger.debug(f"S3 mode: bucket={document_bucket}")

    # Create temporary directory for downloaded files
    temp_dir = tempfile.mkdtemp()
    logger.debug(f"Created temporary directory: {temp_dir}")
    files: list[ReviewFile] = []
    # S3 のキー → 手元に落としたファイル。読み取り結果を手元の名前で引くため
    local_paths: dict[str, str] = {}

    try:
        # Download files from S3
        s3_client = boto3.client("s3")
        logger.debug(f"Downloading {len(document_paths)} files from S3")

        for path in document_paths:
            original_basename = os.path.basename(path)
            # Hash the whole key rather than the file name: files uploaded
            # under the same name differ only by their document id folder,
            # and the second download would overwrite the first.
            sanitized_basename = sanitize_file_name(path)
            ext = os.path.splitext(original_basename)[1].lower()
            sanitized_path = os.path.join(temp_dir, sanitized_basename + ext)

            logger.debug(f"Downloading {path} to {sanitized_path}")
            s3_client.download_file(document_bucket, path, sanitized_path)
            files.append(ReviewFile(path=sanitized_path, name=original_basename))
            local_paths[path] = sanitized_path

        # 先に読み取ってあれば受け取る。無ければ空で、今までどおりの審査になる
        digests = digest_store.load_for_documents(
            document_bucket, local_paths, review_job_id, s3=s3_client
        )
        if digests:
            logger.info("Using the transcription of %s files", len(digests))

        # Detect file types
        has_images = _detect_image_file([file.path for file in files])

        # Select model
        selected_model_id = _select_model_for_files(has_images, model_id)
        logger.debug(f"Selected model: {selected_model_id}")

        # Call common execution logic
        result = _execute_review_core(
            files=files,
            has_images=has_images,
            check_name=check_name,
            check_description=check_description,
            language_name=language_name,
            model_id=selected_model_id,
            toolConfiguration=toolConfiguration,
            feedback_summary=feedback_summary,
            review_guidance=review_guidance,
            digests=digests,
        )

        logger.info("S3 review completed successfully")
        return result

    finally:
        # Clean up temporary files
        logger.debug("Cleaning up temporary files")
        for file in files:
            if os.path.exists(file.path):
                logger.debug(f"Removing temporary file: {file.path}")
                os.remove(file.path)
        if os.path.exists(temp_dir):
            logger.debug(f"Removing temporary directory: {temp_dir}")
            os.rmdir(temp_dir)
        logger.debug("Cleanup complete")


def process_review_from_local(
    document_paths: list[str],
    check_name: str,
    check_description: str,
    language_name: str = "日本語",
    model_id: str | None = None,
    toolConfiguration: dict[str, Any] | None = None,
    feedback_summary: str | None = None,
    review_guidance: str | None = None,
) -> dict[str, Any]:
    """
    Execute review directly from local files (for eval environment).

    Skips S3 download and uses local file paths as-is.

    Args:
        document_paths: List of absolute paths to local files
        check_name: Check item name
        check_description: Check item description
        language_name: Language name (default: "日本語")
        model_id: Model ID (auto-selected if None)
        toolConfiguration: Tool configuration
        feedback_summary: Feedback summary

    Returns:
        Review result dict
    """
    logger.debug(f"Processing review for check: {check_name}")
    logger.debug(f"Local mode: {len(document_paths)} files")

    # Verify file existence
    for path in document_paths:
        if not os.path.exists(path):
            raise FileNotFoundError(f"File not found: {path}")

    # Detect file types
    has_images = _detect_image_file(document_paths)

    # Select model
    selected_model_id = _select_model_for_files(has_images, model_id)
    logger.debug(f"Selected model: {selected_model_id}")

    # Call common execution logic
    result = _execute_review_core(
        files=[
            ReviewFile(path=path, name=os.path.basename(path))
            for path in document_paths
        ],
        has_images=has_images,
        check_name=check_name,
        check_description=check_description,
        language_name=language_name,
        model_id=selected_model_id,
        toolConfiguration=toolConfiguration,
        feedback_summary=feedback_summary,
        review_guidance=review_guidance,
        review_job_id=review_job_id,
    )

    logger.info("Local review completed successfully")
    return result


def process_review(
    document_bucket: str,
    document_paths: list,
    check_name: str,
    check_description: str,
    language_name: str = "日本語",
    model_id: Optional[str] = None,
    toolConfiguration: dict[str, Any] | None = None,
    feedback_summary: str | None = None,
    review_guidance: str | None = None,
    review_job_id: str = "",
) -> dict[str, Any]:
    """
    Alias function for backward compatibility.

    Existing interface called from index.py (Lambda handler).
    Internally calls process_review_from_s3.

    Args:
        document_bucket: S3 bucket name
        document_paths: List of S3 object keys
        check_name: Check item name
        check_description: Check item description
        language_name: Language name
        model_id: Model ID
        toolConfiguration: Tool configuration
        feedback_summary: Feedback summary

    Returns:
        Review result dict
    """
    return process_review_from_s3(
        document_bucket=document_bucket,
        document_paths=document_paths,
        check_name=check_name,
        check_description=check_description,
        language_name=language_name,
        model_id=model_id,
        toolConfiguration=toolConfiguration,
        feedback_summary=feedback_summary,
        review_guidance=review_guidance,
    )
