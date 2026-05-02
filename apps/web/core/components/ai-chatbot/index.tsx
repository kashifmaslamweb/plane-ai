/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  Bot,
  Send,
  ChevronDown,
  Loader2,
  CalendarDays,
  Sparkles,
  Settings2,
  X,
  ExternalLink,
  ChevronRight,
} from "lucide-react";
import { cn } from "@plane/utils";
import { AIService } from "@/services/ai.service";

const aiService = new AIService();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  issueCount?: number;
  dateRange?: { start: string; end: string };
  usedModel?: string;
  isLoading?: boolean;
};

type TQuickOption = {
  label: string;
  question: string;
  startOffset: number;
  endOffset: number;
};

type TModelConfig = {
  provider: "default" | "openrouter";
  model: string;
  apiKey: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QUICK_OPTIONS: TQuickOption[] = [
  { label: "Today", question: "What tasks were completed today?", startOffset: 0, endOffset: 0 },
  { label: "This week", question: "What tasks were completed this week?", startOffset: 7, endOffset: 0 },
  { label: "Last 14 days", question: "Show me a report of tasks done in the last 14 days.", startOffset: 14, endOffset: 0 },
  { label: "Last 30 days", question: "Give me a summary of work done in the last 30 days.", startOffset: 30, endOffset: 0 },
];

// Popular OpenRouter models with friendly labels
const OPENROUTER_MODELS: { value: string; label: string; free?: boolean }[] = [
  { value: "openai/gpt-4o-mini", label: "GPT-4o Mini (OpenAI)" },
  { value: "openai/gpt-4o", label: "GPT-4o (OpenAI)" },
  { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet (Anthropic)" },
  { value: "anthropic/claude-3-haiku", label: "Claude 3 Haiku (Anthropic)" },
  { value: "google/gemini-flash-1.5", label: "Gemini Flash 1.5 (Google)" },
  { value: "google/gemini-pro-1.5", label: "Gemini Pro 1.5 (Google)" },
  { value: "meta-llama/llama-3.1-8b-instruct:free", label: "Llama 3.1 8B (Free)", free: true },
  { value: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B (Meta)" },
  { value: "mistralai/mistral-7b-instruct:free", label: "Mistral 7B (Free)", free: true },
  { value: "mistralai/mixtral-8x22b-instruct", label: "Mixtral 8x22B (Mistral)" },
  { value: "deepseek/deepseek-chat", label: "DeepSeek Chat" },
  { value: "deepseek/deepseek-r1", label: "DeepSeek R1" },
  { value: "qwen/qwen-2.5-72b-instruct", label: "Qwen 2.5 72B" },
  { value: "x-ai/grok-beta", label: "Grok Beta (xAI)" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Markdown renderer (simple, no external dep)
// ---------------------------------------------------------------------------

function inlineFormat(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, '<code class="rounded bg-layer-transparent-active px-1 font-mono text-xs">$1</code>')
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // auto-link bare URLs
    .replace(
      /(https?:\/\/[^\s<>"]+)/g,
      '<a href="$1" target="_blank" rel="noreferrer" class="text-accent-primary underline break-all">$1</a>'
    );
}

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let listBuffer: { text: string; ordered: boolean }[] = [];
  let isOrdered = false;

  const flushList = (key: string) => {
    if (!listBuffer.length) return;
    const items = listBuffer.map((item, i) => (
      <li key={i} className="text-sm text-primary" dangerouslySetInnerHTML={{ __html: inlineFormat(item.text) }} />
    ));
    elements.push(
      isOrdered ? (
        <ol key={key} className="my-1 ml-4 list-decimal space-y-0.5">{items}</ol>
      ) : (
        <ul key={key} className="my-1 ml-4 list-disc space-y-0.5">{items}</ul>
      )
    );
    listBuffer = [];
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    const orderedMatch = trimmed.match(/^(\d+)\.\s(.*)$/);

    if (trimmed.startsWith("### ")) {
      flushList(`list-${idx}`);
      elements.push(
        <p key={idx} className="mb-1 mt-3 text-sm font-semibold text-primary">{trimmed.slice(4)}</p>
      );
    } else if (trimmed.startsWith("## ")) {
      flushList(`list-${idx}`);
      elements.push(
        <p key={idx} className="mb-1 mt-3 text-base font-bold text-primary">{trimmed.slice(3)}</p>
      );
    } else if (trimmed.startsWith("# ")) {
      flushList(`list-${idx}`);
      elements.push(
        <p key={idx} className="mb-1 mt-2 text-base font-bold text-primary">{trimmed.slice(2)}</p>
      );
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      if (listBuffer.length && isOrdered) flushList(`list-${idx}`);
      isOrdered = false;
      listBuffer.push({ text: trimmed.slice(2), ordered: false });
    } else if (orderedMatch) {
      if (listBuffer.length && !isOrdered) flushList(`list-${idx}`);
      isOrdered = true;
      listBuffer.push({ text: orderedMatch[2], ordered: true });
    } else if (trimmed === "---" || trimmed === "***") {
      flushList(`list-${idx}`);
      elements.push(<hr key={idx} className="my-2 border-subtle" />);
    } else if (trimmed === "") {
      flushList(`list-${idx}`);
    } else {
      flushList(`list-${idx}`);
      elements.push(
        <p
          key={idx}
          className="text-sm leading-relaxed text-primary"
          dangerouslySetInnerHTML={{ __html: inlineFormat(trimmed) }}
        />
      );
    }
  });

  flushList("final");
  return <div className="space-y-1">{elements}</div>;
}

// ---------------------------------------------------------------------------
// Model selector panel
// ---------------------------------------------------------------------------

type TModelSelectorProps = {
  config: TModelConfig;
  onChange: (c: TModelConfig) => void;
  onClose: () => void;
};

function ModelSelector({ config, onChange, onClose }: TModelSelectorProps) {
  const [local, setLocal] = useState<TModelConfig>(config);
  const [customModel, setCustomModel] = useState(
    OPENROUTER_MODELS.some((m) => m.value === config.model) ? "" : config.model
  );

  const selectedKnown = OPENROUTER_MODELS.find((m) => m.value === local.model);

  const handleSave = () => {
    const finalModel = customModel.trim() || local.model || OPENROUTER_MODELS[0].value;
    onChange({ ...local, model: finalModel });
    onClose();
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-primary">Model Settings</p>
        <button
          onClick={onClose}
          className="flex size-6 items-center justify-center rounded text-secondary hover:bg-layer-transparent-hover hover:text-primary"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Provider toggle */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-secondary">Provider</label>
        <div className="flex gap-2">
          {(["default", "openrouter"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setLocal((c) => ({ ...c, provider: p }))}
              className={cn(
                "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                local.provider === p
                  ? "border-accent-primary bg-accent-primary/10 text-accent-primary"
                  : "border-subtle text-secondary hover:border-accent-primary/50 hover:text-primary"
              )}
            >
              {p === "default" ? "Instance Default" : "OpenRouter"}
            </button>
          ))}
        </div>
        {local.provider === "default" && (
          <p className="text-xs text-secondary">Uses the LLM provider configured in admin Settings → AI.</p>
        )}
      </div>

      {local.provider === "openrouter" && (
        <>
          {/* Known models list */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-secondary">Model</label>
            <div className="max-h-44 overflow-y-auto rounded-lg border border-subtle">
              {OPENROUTER_MODELS.map((m) => (
                <button
                  key={m.value}
                  onClick={() => {
                    setLocal((c) => ({ ...c, model: m.value }));
                    setCustomModel("");
                  }}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors",
                    "hover:bg-layer-transparent-hover",
                    local.model === m.value && !customModel
                      ? "bg-accent-primary/10 text-accent-primary"
                      : "text-primary"
                  )}
                >
                  <span>{m.label}</span>
                  {m.free && (
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                      FREE
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Custom model input */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-secondary">
              Or enter a custom model slug
            </label>
            <input
              type="text"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              placeholder="e.g. nousresearch/hermes-3-llama-3.1-405b"
              className="rounded-lg border border-subtle bg-surface-2 px-3 py-2 text-xs text-primary outline-none placeholder:text-tertiary focus:border-accent-primary"
            />
            <a
              href="https://openrouter.ai/models"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs text-accent-primary hover:underline"
            >
              Browse all models on OpenRouter <ExternalLink className="size-3" />
            </a>
          </div>

          {/* API key */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-secondary">
              OpenRouter API Key
              <span className="ml-1 text-tertiary">(optional if set in admin)</span>
            </label>
            <input
              type="password"
              value={local.apiKey}
              onChange={(e) => setLocal((c) => ({ ...c, apiKey: e.target.value }))}
              placeholder="sk-or-v1-…"
              className="rounded-lg border border-subtle bg-surface-2 px-3 py-2 text-xs text-primary outline-none placeholder:text-tertiary focus:border-accent-primary"
            />
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs text-accent-primary hover:underline"
            >
              Get a free key at openrouter.ai <ExternalLink className="size-3" />
            </a>
          </div>
        </>
      )}

      <button
        onClick={handleSave}
        className="flex items-center justify-center gap-1.5 rounded-lg bg-accent-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        Apply <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main chatbot component
// ---------------------------------------------------------------------------

export function AIChatBot() {
  const { workspaceSlug } = useParams();
  const [isOpen, setIsOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [modelConfig, setModelConfig] = useState<TModelConfig>({
    provider: "default",
    model: "openai/gpt-4o-mini",
    apiKey: "",
  });
  const [messages, setMessages] = useState<TMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hi! I'm your AI task reporter. I can read task titles **and descriptions** — so if your team posts blog links in task bodies, I'll find them.\n\nTry asking:\n- **List all blog URLs published this week**\n- **Summarize content from tasks done today**\n- **Show me high-priority items completed in the last 30 days**",
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen]);

  useEffect(() => {
    if (isOpen && !showSettings) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen, showSettings]);

  const sendMessage = useCallback(
    async (question: string, startDate?: string, endDate?: string) => {
      if (!workspaceSlug || !question.trim() || isLoading) return;

      const userMsgId = Date.now().toString();
      const botMsgId = (Date.now() + 1).toString();

      setMessages((prev) => [
        ...prev,
        { id: userMsgId, role: "user", content: question },
        { id: botMsgId, role: "assistant", content: "", isLoading: true },
      ]);
      setIsLoading(true);
      setInputValue("");
      setShowSettings(false);

      try {
        const payload: Parameters<typeof aiService.getTaskReport>[1] = {
          question,
          start_date: startDate,
          end_date: endDate,
        };

        if (modelConfig.provider === "openrouter") {
          payload.provider = "openrouter";
          payload.model = modelConfig.model;
          if (modelConfig.apiKey) payload.api_key = modelConfig.apiKey;
        }

        const res = await aiService.getTaskReport(workspaceSlug.toString(), payload);

        setMessages((prev) =>
          prev.map((m) =>
            m.id === botMsgId
              ? {
                  ...m,
                  content: res.response,
                  issueCount: res.issue_count,
                  dateRange: { start: res.start_date, end: res.end_date },
                  usedModel: res.model,
                  isLoading: false,
                }
              : m
          )
        );
      } catch (err: any) {
        const errMsg =
          err?.status === 429
            ? "Rate limit reached. Please try again later."
            : err?.data?.error || "Something went wrong. Check your AI settings.";

        setMessages((prev) =>
          prev.map((m) =>
            m.id === botMsgId ? { ...m, content: errMsg, isLoading: false } : m
          )
        );
      } finally {
        setIsLoading(false);
      }
    },
    [workspaceSlug, isLoading, modelConfig]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) sendMessage(inputValue.trim());
  };

  const handleQuickOption = (opt: TQuickOption) => {
    sendMessage(opt.question, formatDate(opt.startOffset), formatDate(opt.endOffset));
  };

  const activeModelLabel =
    modelConfig.provider === "openrouter"
      ? OPENROUTER_MODELS.find((m) => m.value === modelConfig.model)?.label || modelConfig.model
      : "Instance Default";

  if (!workspaceSlug) return null;

  return (
    <>
      {/* Floating bubble */}
      <button
        onClick={() => setIsOpen(true)}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex size-12 items-center justify-center rounded-full shadow-lg",
          "bg-accent-primary text-white transition-all duration-200 hover:opacity-90 active:scale-95",
          isOpen && "pointer-events-none scale-90 opacity-0"
        )}
        aria-label="Open AI Task Reporter"
      >
        <Bot className="size-5" />
      </button>

      {/* Chat panel */}
      <div
        className={cn(
          "fixed bottom-6 right-6 z-50 flex flex-col overflow-hidden rounded-2xl border border-subtle bg-surface-1 shadow-2xl",
          "w-[440px] max-w-[calc(100vw-3rem)] transition-all duration-300",
          isOpen
            ? "h-[620px] max-h-[calc(100vh-5rem)] translate-y-0 opacity-100"
            : "pointer-events-none h-0 translate-y-4 opacity-0"
        )}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-subtle bg-surface-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-full bg-accent-primary/10">
              <Sparkles className="size-4 text-accent-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-primary">AI Task Reporter</p>
              <button
                onClick={() => setShowSettings((v) => !v)}
                className="flex items-center gap-1 text-xs text-secondary transition-colors hover:text-accent-primary"
              >
                <Settings2 className="size-3" />
                {activeModelLabel}
              </button>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="flex size-7 items-center justify-center rounded-md text-secondary transition-colors hover:bg-layer-transparent-hover hover:text-primary"
          >
            <ChevronDown className="size-4" />
          </button>
        </div>

        {/* Settings panel (slides in over messages) */}
        {showSettings ? (
          <div className="flex-1 overflow-y-auto">
            <ModelSelector
              config={modelConfig}
              onChange={setModelConfig}
              onClose={() => setShowSettings(false)}
            />
          </div>
        ) : (
          <>
            {/* Messages */}
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
                >
                  {msg.role === "assistant" && (
                    <div className="mr-2 mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-primary/10">
                      <Bot className="size-3.5 text-accent-primary" />
                    </div>
                  )}
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3 py-2",
                      msg.role === "user"
                        ? "rounded-tr-sm bg-accent-primary text-white"
                        : "rounded-tl-sm bg-surface-2 text-primary"
                    )}
                  >
                    {msg.isLoading ? (
                      <div className="flex items-center gap-2 py-1">
                        <Loader2 className="size-4 animate-spin text-secondary" />
                        <span className="text-sm text-secondary">Analyzing tasks...</span>
                      </div>
                    ) : msg.role === "user" ? (
                      <p className="text-sm leading-relaxed">{msg.content}</p>
                    ) : (
                      <div>
                        <MarkdownContent content={msg.content} />
                        {msg.issueCount !== undefined && (
                          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-subtle pt-2">
                            <span className="flex items-center gap-1 text-xs text-secondary">
                              <CalendarDays className="size-3" />
                              {msg.issueCount} item{msg.issueCount !== 1 ? "s" : ""}
                              {msg.dateRange && ` · ${msg.dateRange.start} → ${msg.dateRange.end}`}
                            </span>
                            {msg.usedModel && (
                              <span className="text-xs text-tertiary">{msg.usedModel}</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick options */}
            <div className="shrink-0 border-t border-subtle px-4 py-2">
              <div className="flex flex-wrap gap-1.5">
                {QUICK_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => handleQuickOption(opt)}
                    disabled={isLoading}
                    className={cn(
                      "rounded-full border border-subtle px-3 py-1 text-xs font-medium text-secondary transition-colors",
                      "hover:border-accent-primary hover:text-accent-primary",
                      "disabled:cursor-not-allowed disabled:opacity-50"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Input */}
            <form
              onSubmit={handleSubmit}
              className="flex shrink-0 items-center gap-2 border-t border-subtle bg-surface-1 px-3 py-3"
            >
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="List blog URLs from last 7 days..."
                disabled={isLoading}
                className={cn(
                  "flex-1 rounded-xl border border-subtle bg-surface-2 px-3 py-2 text-sm text-primary outline-none",
                  "placeholder:text-tertiary transition-colors focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30",
                  "disabled:cursor-not-allowed disabled:opacity-60"
                )}
              />
              <button
                type="submit"
                disabled={!inputValue.trim() || isLoading}
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-xl transition-all",
                  "bg-accent-primary text-white hover:opacity-90 active:scale-95",
                  "disabled:cursor-not-allowed disabled:opacity-40"
                )}
              >
                {isLoading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </button>
            </form>
          </>
        )}
      </div>
    </>
  );
}
