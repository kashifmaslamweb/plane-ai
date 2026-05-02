/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useForm, Controller } from "react-hook-form";
import { Lightbulb, ChevronDown } from "lucide-react";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IFormattedInstanceConfiguration, TInstanceAIConfigurationKeys } from "@plane/types";
// hooks
import { useInstance } from "@/hooks/store";

type IInstanceAIForm = {
  config: IFormattedInstanceConfiguration;
};

type AIFormValues = Record<TInstanceAIConfigurationKeys, string>;

const PROVIDER_OPTIONS = [
  { value: "openai", label: "OpenAI", hint: "GPT-4o, GPT-4o-mini, etc." },
  { value: "anthropic", label: "Anthropic", hint: "Claude 3 Sonnet, Haiku, Opus" },
  { value: "gemini", label: "Google Gemini", hint: "Gemini Pro, Gemini 1.5 Pro" },
  { value: "openrouter", label: "OpenRouter", hint: "200+ models via one API key" },
] as const;

const PROVIDER_MODEL_HINTS: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-sonnet-20240229",
  gemini: "gemini-pro",
  openrouter: "openai/gpt-4o-mini  or  meta-llama/llama-3.1-8b-instruct:free",
};

const PROVIDER_KEY_LINKS: Record<string, { href: string; label: string }> = {
  openai: { href: "https://platform.openai.com/api-keys", label: "Get your key at platform.openai.com" },
  anthropic: { href: "https://console.anthropic.com/settings/keys", label: "Get your key at console.anthropic.com" },
  gemini: { href: "https://aistudio.google.com/app/apikey", label: "Get your key at aistudio.google.com" },
  openrouter: { href: "https://openrouter.ai/keys", label: "Get your key at openrouter.ai" },
};

export function InstanceAIForm(props: IInstanceAIForm) {
  const { config } = props;
  const { updateInstanceConfigurations } = useInstance();

  const {
    handleSubmit,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<AIFormValues>({
    defaultValues: {
      LLM_PROVIDER: config["LLM_PROVIDER"] || "openai",
      LLM_MODEL: config["LLM_MODEL"] || "",
      LLM_API_KEY: config["LLM_API_KEY"] || "",
    },
  });

  const selectedProvider = watch("LLM_PROVIDER") || "openai";
  const keyLink = PROVIDER_KEY_LINKS[selectedProvider];

  const onSubmit = async (formData: AIFormValues) => {
    await updateInstanceConfigurations({ ...formData })
      .then(() =>
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: "Success",
          message: "AI Settings updated successfully",
        })
      )
      .catch((err) => console.error(err));
  };

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div>
          <div className="pb-1 text-18 font-medium text-primary">AI Provider</div>
          <div className="text-13 font-regular text-tertiary">
            Configure which LLM provider powers Plane's AI features, including the task report chatbot.
          </div>
        </div>

        <div className="grid w-full grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-3">
          {/* Provider selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-primary">
              Provider <span className="text-danger-primary">*</span>
            </label>
            <Controller
              control={control}
              name="LLM_PROVIDER"
              render={({ field }) => (
                <div className="relative">
                  <select
                    {...field}
                    className="w-full appearance-none rounded-md border border-subtle bg-surface-1 px-3 py-2 pr-8 text-sm text-primary outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30"
                  >
                    {PROVIDER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label} — {opt.hint}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-secondary" />
                </div>
              )}
            />
            {selectedProvider === "openrouter" && (
              <p className="text-xs text-secondary">
                OpenRouter gives you access to 200+ models (including free ones) via a single API key.{" "}
                <a href="https://openrouter.ai/models" target="_blank" rel="noreferrer" className="text-accent-primary hover:underline">
                  Browse models
                </a>
              </p>
            )}
          </div>

          {/* Model */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-primary">Model</label>
            <Controller
              control={control}
              name="LLM_MODEL"
              render={({ field }) => (
                <input
                  {...field}
                  type="text"
                  placeholder={PROVIDER_MODEL_HINTS[selectedProvider] || "Enter model name"}
                  className="rounded-md border border-subtle bg-surface-1 px-3 py-2 text-sm text-primary outline-none placeholder:text-tertiary focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30"
                />
              )}
            />
            <p className="text-xs text-secondary">
              {selectedProvider === "openrouter"
                ? "Enter any model slug from openrouter.ai/models, e.g. meta-llama/llama-3.1-8b-instruct:free"
                : `Leave blank to use the default for ${PROVIDER_OPTIONS.find((p) => p.value === selectedProvider)?.label}`}
            </p>
          </div>

          {/* API key */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-primary">API Key</label>
            <Controller
              control={control}
              name="LLM_API_KEY"
              render={({ field }) => (
                <input
                  {...field}
                  type="password"
                  placeholder="sk-…"
                  className="rounded-md border border-subtle bg-surface-1 px-3 py-2 text-sm text-primary outline-none placeholder:text-tertiary focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30"
                />
              )}
            />
            {keyLink && (
              <a href={keyLink.href} target="_blank" rel="noreferrer" className="text-xs text-accent-primary hover:underline">
                {keyLink.label}
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col items-start gap-4">
        <Button variant="primary" size="lg" onClick={handleSubmit(onSubmit)} loading={isSubmitting}>
          {isSubmitting ? "Saving" : "Save changes"}
        </Button>

        <div className="relative inline-flex items-center gap-1.5 rounded-sm border border-accent-subtle bg-accent-subtle px-4 py-2 text-caption-sm-regular text-accent-secondary">
          <Lightbulb className="size-4" />
          <div>
            Want a provider not listed here?{" "}
            <a className="font-medium underline" href="https://plane.so/contact">
              Get in touch with us.
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
