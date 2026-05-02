# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python import
import os
import json
from datetime import datetime, timedelta, timezone as dt_timezone
from typing import List, Dict, Tuple, Optional

# Third party import
from openai import OpenAI
import requests

from django.utils import timezone

from rest_framework import status
from rest_framework.response import Response

# Module import
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import ProjectLiteSerializer, WorkspaceLiteSerializer
from plane.db.models import Issue, Project, Workspace
from plane.license.utils.instance_value import get_configuration_value
from plane.utils.exception_logger import log_exception

from ..base import BaseAPIView


class LLMProvider:
    """Base class for LLM provider configurations"""

    name: str = ""
    models: List[str] = []
    default_model: str = ""
    base_url: Optional[str] = None  # None means use provider SDK default

    @classmethod
    def get_config(cls) -> Dict:
        return {
            "name": cls.name,
            "models": cls.models,
            "default_model": cls.default_model,
        }


class OpenAIProvider(LLMProvider):
    name = "OpenAI"
    models = ["gpt-3.5-turbo", "gpt-4o-mini", "gpt-4o", "o1-mini", "o1-preview"]
    default_model = "gpt-4o-mini"


class AnthropicProvider(LLMProvider):
    name = "Anthropic"
    models = [
        "claude-3-5-sonnet-20240620",
        "claude-3-haiku-20240307",
        "claude-3-opus-20240229",
        "claude-3-sonnet-20240229",
        "claude-2.1",
        "claude-2",
        "claude-instant-1.2",
        "claude-instant-1",
    ]
    default_model = "claude-3-sonnet-20240229"


class GeminiProvider(LLMProvider):
    name = "Gemini"
    models = ["gemini-pro", "gemini-1.5-pro-latest", "gemini-pro-vision"]
    default_model = "gemini-pro"


class OpenRouterProvider(LLMProvider):
    """
    OpenRouter proxies 200+ models via an OpenAI-compatible API.
    Models are referenced as "provider/model-name".
    https://openrouter.ai/models
    """
    name = "OpenRouter"
    base_url = "https://openrouter.ai/api/v1"
    models = [
        # OpenAI via OpenRouter
        "openai/gpt-4o",
        "openai/gpt-4o-mini",
        "openai/gpt-4-turbo",
        # Anthropic via OpenRouter
        "anthropic/claude-3.5-sonnet",
        "anthropic/claude-3-haiku",
        "anthropic/claude-3-opus",
        # Google via OpenRouter
        "google/gemini-flash-1.5",
        "google/gemini-pro-1.5",
        # Meta / Llama (free tier)
        "meta-llama/llama-3.1-8b-instruct:free",
        "meta-llama/llama-3.1-70b-instruct",
        "meta-llama/llama-3.3-70b-instruct",
        # Mistral
        "mistralai/mistral-7b-instruct:free",
        "mistralai/mistral-nemo",
        "mistralai/mixtral-8x22b-instruct",
        # DeepSeek
        "deepseek/deepseek-chat",
        "deepseek/deepseek-r1",
        # Qwen
        "qwen/qwen-2.5-72b-instruct",
        # Others
        "nvidia/llama-3.1-nemotron-70b-instruct",
        "x-ai/grok-beta",
    ]
    default_model = "openai/gpt-4o-mini"


SUPPORTED_PROVIDERS = {
    "openai": OpenAIProvider,
    "anthropic": AnthropicProvider,
    "gemini": GeminiProvider,
    "openrouter": OpenRouterProvider,
}

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


def get_llm_config() -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """Returns (api_key, model, provider_key) from instance config / env."""
    api_key, provider_key, model = get_configuration_value(
        [
            {"key": "LLM_API_KEY", "default": os.environ.get("LLM_API_KEY", None)},
            {"key": "LLM_PROVIDER", "default": os.environ.get("LLM_PROVIDER", "openai")},
            {"key": "LLM_MODEL", "default": os.environ.get("LLM_MODEL", None)},
        ]
    )

    provider = SUPPORTED_PROVIDERS.get((provider_key or "").lower())
    if not provider:
        log_exception(ValueError(f"Unsupported provider: {provider_key}"))
        return None, None, None

    if not api_key:
        log_exception(ValueError(f"Missing API key for provider: {provider.name}"))
        return None, None, None

    if not model:
        model = provider.default_model

    # For strict providers (not OpenRouter) validate the model is in the list
    if provider_key.lower() != "openrouter" and model not in provider.models:
        log_exception(
            ValueError(
                f"Model {model} not supported by {provider.name}. "
                f"Supported models: {', '.join(provider.models)}"
            )
        )
        return None, None, None

    return api_key, model, provider_key


def get_llm_response(
    system_prompt: str,
    user_prompt: str,
    api_key: str,
    model: str,
    provider: str,
    base_url: Optional[str] = None,
) -> Tuple[Optional[str], Optional[str]]:
    """
    Call the LLM and return (text, error).
    Accepts an explicit base_url override (used for OpenRouter and per-request
    provider overrides from the chatbot).
    """
    try:
        # Resolve base URL:
        # 1. explicit override wins
        # 2. then provider-level base_url
        # 3. then Gemini prefix trick
        resolved_base_url = base_url

        provider_lower = (provider or "").lower()

        if not resolved_base_url:
            provider_cls = SUPPORTED_PROVIDERS.get(provider_lower)
            if provider_cls:
                resolved_base_url = provider_cls.base_url

        if provider_lower == "gemini" and not resolved_base_url:
            model = f"gemini/{model}"

        client_kwargs = {"api_key": api_key}
        if resolved_base_url:
            client_kwargs["base_url"] = resolved_base_url

        extra_headers = {}
        if provider_lower == "openrouter" or resolved_base_url == OPENROUTER_BASE_URL:
            extra_headers = {
                "HTTP-Referer": "https://plane.so",
                "X-Title": "Plane AI Task Reporter",
            }

        client = OpenAI(**client_kwargs)
        chat_completion = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            extra_headers=extra_headers or None,
        )
        return chat_completion.choices[0].message.content, None

    except Exception as e:
        log_exception(e)
        error_type = e.__class__.__name__
        if error_type == "AuthenticationError":
            return None, f"Invalid API key for {provider}"
        elif error_type == "RateLimitError":
            return None, f"Rate limit exceeded for {provider}"
        else:
            return None, f"Error occurred while generating response from {provider}"


class GPTIntegrationEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id):
        api_key, model, provider = get_llm_config()

        if not api_key or not model or not provider:
            return Response(
                {"error": "LLM provider API key and model are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        task = request.data.get("task", False)
        if not task:
            return Response({"error": "Task is required"}, status=status.HTTP_400_BAD_REQUEST)

        text, error = get_llm_response(task, request.data.get("prompt", False) or "", api_key, model, provider)
        if not text and error:
            return Response(
                {"error": "An internal error has occurred."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        workspace = Workspace.objects.get(slug=slug)
        project = Project.objects.get(pk=project_id)

        return Response(
            {
                "response": text,
                "response_html": (text or "").replace("\n", "<br/>"),
                "project_detail": ProjectLiteSerializer(project).data,
                "workspace_detail": WorkspaceLiteSerializer(workspace).data,
            },
            status=status.HTTP_200_OK,
        )


class WorkspaceGPTIntegrationEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug):
        api_key, model, provider = get_llm_config()

        if not api_key or not model or not provider:
            return Response(
                {"error": "LLM provider API key and model are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        task = request.data.get("task", False)
        if not task:
            return Response({"error": "Task is required"}, status=status.HTTP_400_BAD_REQUEST)

        text, error = get_llm_response(task, request.data.get("prompt", False) or "", api_key, model, provider)
        if not text and error:
            return Response(
                {"error": "An internal error has occurred."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            {
                "response": text,
                "response_html": (text or "").replace("\n", "<br/>"),
            },
            status=status.HTTP_200_OK,
        )


class UnsplashEndpoint(BaseAPIView):
    def get(self, request):
        (UNSPLASH_ACCESS_KEY,) = get_configuration_value(
            [
                {
                    "key": "UNSPLASH_ACCESS_KEY",
                    "default": os.environ.get("UNSPLASH_ACCESS_KEY"),
                }
            ]
        )
        if not UNSPLASH_ACCESS_KEY:
            return Response([], status=status.HTTP_200_OK)

        query = request.GET.get("query", False)
        page = request.GET.get("page", 1)
        per_page = request.GET.get("per_page", 20)

        url = (
            f"https://api.unsplash.com/search/photos/?client_id={UNSPLASH_ACCESS_KEY}&query={query}&page=${page}&per_page={per_page}"
            if query
            else f"https://api.unsplash.com/photos/?client_id={UNSPLASH_ACCESS_KEY}&page={page}&per_page={per_page}"
        )

        headers = {"Content-Type": "application/json"}
        resp = requests.get(url=url, headers=headers)
        return Response(resp.json(), status=resp.status_code)


class OpenRouterModelsEndpoint(BaseAPIView):
    """Returns the list of models available in OpenRouter for the chatbot selector."""

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        return Response(
            {
                "provider": "openrouter",
                "models": OpenRouterProvider.models,
                "default_model": OpenRouterProvider.default_model,
            },
            status=status.HTTP_200_OK,
        )


class WorkspaceAITaskReportEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def post(self, request, slug):
        # --- Resolve provider/model (request can override instance defaults) ---
        req_provider = (request.data.get("provider") or "").strip().lower()
        req_model = (request.data.get("model") or "").strip()
        req_api_key = (request.data.get("api_key") or "").strip()

        if req_provider and req_provider == "openrouter" and req_model and req_api_key:
            # Caller supplied full OpenRouter credentials — use them directly
            api_key = req_api_key
            model = req_model
            provider = "openrouter"
        else:
            api_key, model, provider = get_llm_config()

            # If caller asked for a specific OpenRouter model but key comes from config
            if req_provider == "openrouter" and req_model:
                model = req_model
                provider = "openrouter"
                if req_api_key:
                    api_key = req_api_key

        if not api_key or not model or not provider:
            return Response(
                {"error": "LLM provider API key and model are required. Configure them in Settings → AI."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # --- Validate request ---
        question = request.data.get("question", "").strip()
        if not question:
            return Response({"error": "Question is required"}, status=status.HTTP_400_BAD_REQUEST)

        start_date_str = request.data.get("start_date")
        end_date_str = request.data.get("end_date")
        project_id = request.data.get("project_id")

        try:
            if start_date_str:
                start_date = datetime.fromisoformat(start_date_str).replace(tzinfo=dt_timezone.utc)
            else:
                start_date = timezone.now() - timedelta(days=7)

            if end_date_str:
                end_date = datetime.fromisoformat(end_date_str).replace(tzinfo=dt_timezone.utc)
            else:
                end_date = timezone.now()
        except (ValueError, TypeError):
            return Response({"error": "Invalid date format. Use ISO 8601."}, status=status.HTTP_400_BAD_REQUEST)

        # --- Fetch completed issues ---
        issue_qs = (
            Issue.issue_objects.filter(
                workspace__slug=slug,
                state__group="completed",
                completed_at__gte=start_date,
                completed_at__lte=end_date,
            )
            .select_related("project", "state", "created_by")
            .prefetch_related("assignees", "labels")
        )

        if project_id:
            issue_qs = issue_qs.filter(project_id=project_id)

        issue_qs = issue_qs.order_by("-completed_at")[:200]

        # --- Serialize issues into a minimal token-efficient format ---
        # Field names are abbreviated; empty/default values are omitted entirely.
        # Description is stripped of excess whitespace and capped at 400 chars —
        # enough for URLs and key content without blowing token budgets.
        import re as _re

        issues_data = []
        for issue in issue_qs:
            assignees = [a.display_name or a.email for a in issue.assignees.all()]
            labels = [lb.name for lb in issue.labels.all()]

            body = _re.sub(r"\s+", " ", (issue.description_stripped or "")).strip()
            if len(body) > 400:
                body = body[:400] + "…"

            # Short keys + omit falsy/default values to minimise token count
            entry: Dict = {"t": issue.name}
            if issue.project:
                entry["p"] = issue.project.name
            priority = issue.priority or "none"
            if priority != "none":
                entry["pr"] = priority
            if assignees:
                entry["a"] = assignees
            if labels:
                entry["l"] = labels
            if issue.completed_at:
                entry["d"] = issue.completed_at.strftime("%Y-%m-%d")
            if body:
                entry["desc"] = body

            issues_data.append(entry)

        # No indent, minimal separators — largest single token saving
        issues_json = json.dumps(issues_data, ensure_ascii=False, separators=(",", ":"))

        system_prompt = (
            "Plane project-management AI. Analyse completed work items and answer the user's question "
            "using markdown (bullets, bold, tables). Each item: t=title p=project pr=priority "
            "a=assignees l=labels d=date desc=body. "
            "Pull URLs/links from desc when asked. If no items match, say so."
        )

        user_prompt = (
            f"Q: {question}\n"
            f"Range: {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}\n"
            f"Items: {issues_json}"
        )

        text, error = get_llm_response(system_prompt, user_prompt, api_key, model, provider)

        if not text and error:
            return Response(
                {"error": error or "An internal error has occurred."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            {
                "response": text,
                "issue_count": len(issues_data),
                "start_date": start_date.strftime("%Y-%m-%d"),
                "end_date": end_date.strftime("%Y-%m-%d"),
                "provider": provider,
                "model": model,
            },
            status=status.HTTP_200_OK,
        )
