/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Bot, Send, X, ChevronDown, Loader2, CalendarDays, Sparkles } from "lucide-react";
// plane imports
import { cn } from "@plane/utils";
// services
import { AIService } from "@/services/ai.service";

const aiService = new AIService();

type TMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  issueCount?: number;
  dateRange?: { start: string; end: string };
  isLoading?: boolean;
};

type TQuickOption = {
  label: string;
  question: string;
  startOffset: number; // days back from today
  endOffset: number; // days back from today (0 = today)
};

const QUICK_OPTIONS: TQuickOption[] = [
  { label: "Today", question: "What tasks were completed today?", startOffset: 0, endOffset: 0 },
  { label: "This week", question: "What tasks were completed this week?", startOffset: 7, endOffset: 0 },
  { label: "Last 14 days", question: "Show me a report of tasks done in the last 14 days.", startOffset: 14, endOffset: 0 },
  { label: "Last 30 days", question: "Give me a summary of work done in the last 30 days.", startOffset: 30, endOffset: 0 },
];

function formatDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function MarkdownContent({ content }: { content: string }) {
  // Simple markdown rendering: bold, inline code, headings, lists
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = (key: string) => {
    if (listBuffer.length > 0) {
      elements.push(
        <ul key={key} className="my-1 ml-4 list-disc space-y-0.5">
          {listBuffer.map((item, i) => (
            <li key={i} className="text-sm text-primary" dangerouslySetInnerHTML={{ __html: inlineFormat(item) }} />
          ))}
        </ul>
      );
      listBuffer = [];
    }
  };

  const inlineFormat = (text: string): string =>
    text
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`(.+?)`/g, '<code class="rounded bg-layer-transparent-active px-1 text-xs font-mono">$1</code>')
      .replace(/\*(.+?)\*/g, "<em>$1</em>");

  lines.forEach((line, idx) => {
    const trimmed = line.trim();

    if (trimmed.startsWith("### ")) {
      flushList(`list-${idx}`);
      elements.push(
        <p key={idx} className="mt-3 mb-1 text-sm font-semibold text-primary">
          {trimmed.slice(4)}
        </p>
      );
    } else if (trimmed.startsWith("## ")) {
      flushList(`list-${idx}`);
      elements.push(
        <p key={idx} className="mt-3 mb-1 text-base font-bold text-primary">
          {trimmed.slice(3)}
        </p>
      );
    } else if (trimmed.startsWith("# ")) {
      flushList(`list-${idx}`);
      elements.push(
        <p key={idx} className="mt-2 mb-1 text-base font-bold text-primary">
          {trimmed.slice(2)}
        </p>
      );
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      listBuffer.push(trimmed.slice(2));
    } else if (/^\d+\.\s/.test(trimmed)) {
      listBuffer.push(trimmed.replace(/^\d+\.\s/, ""));
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
          className="text-sm text-primary leading-relaxed"
          dangerouslySetInnerHTML={{ __html: inlineFormat(trimmed) }}
        />
      );
    }
  });

  flushList("final");

  return <div className="space-y-1">{elements}</div>;
}

export function AIChatBot() {
  const { workspaceSlug } = useParams();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<TMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hi! I'm your AI task reporter. Ask me about work done in any time period — for example:\n\n- **What did we complete this week?**\n- **Show me high-priority tasks done in the last 30 days**\n- **List blog-related tasks completed today**",
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

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

      try {
        const res = await aiService.getTaskReport(workspaceSlug.toString(), {
          question,
          start_date: startDate,
          end_date: endDate,
        });

        setMessages((prev) =>
          prev.map((m) =>
            m.id === botMsgId
              ? {
                  ...m,
                  content: res.response,
                  issueCount: res.issue_count,
                  dateRange: { start: res.start_date, end: res.end_date },
                  isLoading: false,
                }
              : m
          )
        );
      } catch (err: any) {
        const errMsg =
          err?.data?.error || err?.status === 429
            ? "Rate limit reached. Please try again later."
            : "Something went wrong. Please check your AI settings.";

        setMessages((prev) =>
          prev.map((m) =>
            m.id === botMsgId
              ? { ...m, content: errMsg, isLoading: false }
              : m
          )
        );
      } finally {
        setIsLoading(false);
      }
    },
    [workspaceSlug, isLoading]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) sendMessage(inputValue.trim());
  };

  const handleQuickOption = (option: TQuickOption) => {
    const start = formatDate(option.startOffset);
    const end = formatDate(option.endOffset);
    sendMessage(option.question, start, end);
  };

  if (!workspaceSlug) return null;

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex size-12 items-center justify-center rounded-full shadow-lg transition-all duration-200",
          "bg-accent-primary text-white hover:opacity-90 active:scale-95",
          isOpen && "opacity-0 pointer-events-none scale-90"
        )}
        aria-label="Open AI Task Reporter"
      >
        <Bot className="size-5" />
      </button>

      {/* Chat panel */}
      <div
        className={cn(
          "fixed bottom-6 right-6 z-50 flex flex-col overflow-hidden rounded-2xl border border-subtle bg-surface-1 shadow-2xl transition-all duration-300",
          "w-[420px] max-w-[calc(100vw-3rem)]",
          isOpen ? "h-[600px] max-h-[calc(100vh-5rem)] opacity-100 translate-y-0" : "h-0 opacity-0 translate-y-4 pointer-events-none"
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
              <p className="text-xs text-secondary">Ask about completed work items</p>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="flex size-7 items-center justify-center rounded-md text-secondary transition-colors hover:bg-layer-transparent-hover hover:text-primary"
          >
            <ChevronDown className="size-4" />
          </button>
        </div>

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
                    <span className="text-sm text-secondary">Analyzing your tasks...</span>
                  </div>
                ) : msg.role === "user" ? (
                  <p className="text-sm leading-relaxed">{msg.content}</p>
                ) : (
                  <div>
                    <MarkdownContent content={msg.content} />
                    {msg.issueCount !== undefined && (
                      <div className="mt-2 flex items-center gap-1.5 border-t border-subtle pt-2">
                        <CalendarDays className="size-3 text-secondary" />
                        <span className="text-xs text-secondary">
                          {msg.issueCount} item{msg.issueCount !== 1 ? "s" : ""} found
                          {msg.dateRange && ` · ${msg.dateRange.start} → ${msg.dateRange.end}`}
                        </span>
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
            placeholder="Ask about completed tasks..."
            disabled={isLoading}
            className={cn(
              "flex-1 rounded-xl border border-subtle bg-surface-2 px-3 py-2 text-sm text-primary outline-none placeholder:text-tertiary",
              "focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30",
              "disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
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
      </div>
    </>
  );
}
