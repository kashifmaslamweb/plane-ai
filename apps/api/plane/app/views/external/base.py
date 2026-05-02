# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python import
import os
import json
from datetime import datetime, timedelta, timezone as dt_timezone
from typing import List, Dict, Tuple

# Third party import
from openai import OpenAI
import requests

from django.utils import timezone

from rest_framework import status
from rest_framework.response import Response

# Module import
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import ProjectLiteSerializer, WorkspaceLiteSerializer
from plane.db.models import Issue, Label, Project, Workspace
from plane.license.utils.instance_value import get_configuration_value
from plane.utils.exception_logger import log_exception

from ..base import BaseAPIView


class LLMProvider:
    """Base class for LLM provider configurations"""

    name: str = ""
    models: List[str] = []
    default_model: str = ""

    @classmethod
    def get_config(cls) -> Dict[str, str | List[str]]:
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


SUPPORTED_PROVIDERS = {
    "openai": OpenAIProvider,
    "anthropic": AnthropicProvider,
    "gemini": GeminiProvider,
}


def get_llm_config() -> Tuple[str | None, str | None, str | None]:
    """
    Helper to get LLM configuration values, returns:
        - api_key, model, provider
    """
    api_key, provider_key, model = get_configuration_value(
        [
            {
                "key": "LLM_API_KEY",
                "default": os.environ.get("LLM_API_KEY", None),
            },
            {
                "key": "LLM_PROVIDER",
                "default": os.environ.get("LLM_PROVIDER", "openai"),
            },
            {
                "key": "LLM_MODEL",
                "default": os.environ.get("LLM_MODEL", None),
            },
        ]
    )

    provider = SUPPORTED_PROVIDERS.get(provider_key.lower())
    if not provider:
        log_exception(ValueError(f"Unsupported provider: {provider_key}"))
        return None, None, None

    if not api_key:
        log_exception(ValueError(f"Missing API key for provider: {provider.name}"))
        return None, None, None

    # If no model specified, use provider's default
    if not model:
        model = provider.default_model

    # Validate model is supported by provider
    if model not in provider.models:
        log_exception(
            ValueError(
                f"Model {model} not supported by {provider.name}. Supported models: {', '.join(provider.models)}"
            )
        )
        return None, None, None

    return api_key, model, provider_key


def get_llm_response(task, prompt, api_key: str, model: str, provider: str) -> Tuple[str | None, str | None]:
    """Helper to get LLM completion response"""
    final_text = task + "\n" + prompt
    try:
        # For Gemini, prepend provider name to model
        if provider.lower() == "gemini":
            model = f"gemini/{model}"

        client = OpenAI(api_key=api_key)
        chat_completion = client.chat.completions.create(
            model=model, messages=[{"role": "user", "content": final_text}]
        )
        text = chat_completion.choices[0].message.content
        return text, None
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

        text, error = get_llm_response(task, request.data.get("prompt", False), api_key, model, provider)
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
                "response_html": text.replace("\n", "<br/>"),
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

        text, error = get_llm_response(task, request.data.get("prompt", False), api_key, model, provider)
        if not text and error:
            return Response(
                {"error": "An internal error has occurred."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            {
                "response": text,
                "response_html": text.replace("\n", "<br/>"),
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
        # Check unsplash access key
        if not UNSPLASH_ACCESS_KEY:
            return Response([], status=status.HTTP_200_OK)

        # Query parameters
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


class WorkspaceAITaskReportEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def post(self, request, slug):
        api_key, model, provider = get_llm_config()

        if not api_key or not model or not provider:
            return Response(
                {"error": "LLM provider API key and model are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        question = request.data.get("question", "").strip()
        if not question:
            return Response({"error": "Question is required"}, status=status.HTTP_400_BAD_REQUEST)

        start_date_str = request.data.get("start_date")
        end_date_str = request.data.get("end_date")
        project_id = request.data.get("project_id")

        # Parse or default date range
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

        # Build issue queryset for workspace, filtering by state group "completed" and date range
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

        # Cap at 200 issues to avoid huge prompts
        issue_qs = issue_qs.order_by("-completed_at")[:200]

        # Serialize issues into a compact format for the LLM
        issues_data = []
        for issue in issue_qs:
            assignee_names = [
                f"{a.display_name or a.email}" for a in issue.assignees.all()
            ]
            label_names = [label.name for label in issue.labels.all()]
            issues_data.append(
                {
                    "id": str(issue.sequence_id),
                    "title": issue.name,
                    "project": issue.project.name if issue.project else "Unknown",
                    "priority": issue.priority or "none",
                    "assignees": assignee_names,
                    "labels": label_names,
                    "completed_at": issue.completed_at.strftime("%Y-%m-%d %H:%M UTC") if issue.completed_at else None,
                }
            )

        issues_json = json.dumps(issues_data, ensure_ascii=False, indent=2)

        system_prompt = (
            "You are an AI assistant integrated into Plane, a project management tool. "
            "Your job is to analyze completed work items and generate clear, helpful reports. "
            "Use markdown formatting in your responses — headings, bullet lists, bold text, tables where appropriate. "
            "Be concise but thorough. Group items logically (by project, priority, label, or date as appropriate). "
            "If there are no items, say so clearly."
        )

        user_prompt = (
            f"The user asked: \"{question}\"\n\n"
            f"Date range: {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}\n\n"
            f"Here are the completed work items in that period (JSON):\n{issues_json}\n\n"
            "Generate a well-formatted report answering the user's question based on these items."
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
            },
            status=status.HTTP_200_OK,
        )
