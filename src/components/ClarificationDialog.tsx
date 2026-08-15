"use client";

/**
 * Follow-up questions from ClarificationAgent. Answers are keyed by
 * `question.field` (`location`, `dietaryNeeds`, …) and POSTed as
 * `Record<string, string>` to `/api/clarify`.
 */
import { useState } from "react";
import { ClarificationQuestion } from "@/types";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Field, Input } from "./ui/Field";
import { cn } from "@/lib/cn";
import { ICON_LG, ICON_SM, UnverifiableIcon, VerifiedIcon, iconProps } from "@/lib/icons";

interface ClarificationDialogProps {
  questions: ClarificationQuestion[];
  onSubmit: (answers: Record<string, string>) => void;
  /** Abandon the clarification and return to the search form. */
  onCancel?: () => void;
}

/** Follow-up form; submit sends `{ [field]: answer }` to the parent. */
export function ClarificationDialog({
  questions,
  onSubmit,
  onCancel,
}: ClarificationDialogProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const handleAnswer = (field: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(answers);
  };

  const incomplete = questions.some((q) => !answers[q.field]?.trim());

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Card className="border-l-2 border-l-caution-500">
        <div className="mb-4 flex items-center gap-2">
          <UnverifiableIcon size={ICON_LG} className="text-caution-600" {...iconProps} />
          <h2 className="text-lg font-semibold tracking-tight text-gray-900">
            Need a bit more info
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {questions.map((q) => (
            // A fieldset, because when options render the question labels a
            // group of controls rather than one input. The old <label> pointed
            // at an id that only existed in the free-text branch.
            <fieldset key={q.field}>
              <legend className="mb-2 text-sm font-medium text-gray-700">
                {q.question}
              </legend>

              {q.options ? (
                <div className="flex flex-wrap gap-2">
                  {q.options.map((option) => {
                    const value = option.toLowerCase();
                    const checked = answers[q.field] === value;
                    return (
                      // Real radios: arrow-key navigation, group semantics and
                      // a announced selected state come free. The previous
                      // chips were plain buttons with no aria-pressed.
                      <label
                        key={option}
                        className={cn(
                          "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors",
                          "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gray-900 has-[:focus-visible]:ring-offset-2",
                          checked
                            ? "border-gray-900 bg-gray-900 text-white"
                            : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                        )}
                      >
                        <input
                          type="radio"
                          name={q.field}
                          value={value}
                          checked={checked}
                          onChange={() => handleAnswer(q.field, value)}
                          className="sr-only"
                        />
                        {checked && <VerifiedIcon size={ICON_SM} {...iconProps} />}
                        {option}
                      </label>
                    );
                  })}
                </div>
              ) : (
                <Field label={q.question} labelHidden>
                  {(field) => (
                    <Input
                      {...field}
                      type="text"
                      value={answers[q.field] || ""}
                      onChange={(e) => handleAnswer(q.field, e.target.value)}
                      placeholder="Type your answer..."
                    />
                  )}
                </Field>
              )}
            </fieldset>
          ))}

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              variant="primary"
              // Every question must be answered. Submitting a partial set sends
              // the search back unchanged, which is how users ended up looping
              // through the same question.
              disabled={incomplete}
              className="flex-1"
            >
              Continue search
            </Button>
            {onCancel && (
              // The only way out used to be answering — and the answer could be
              // another question. Navigating away and back re-opened the dialog,
              // because the processing state was never reset.
              <Button type="button" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
          {/* A disabled button with no explanation reads as broken. */}
          {incomplete && (
            <p className="text-xs text-gray-500">
              Answer every question to continue.
            </p>
          )}
        </form>
      </Card>
    </div>
  );
}
