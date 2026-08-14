"use client";

/**
 * Follow-up questions from ClarificationAgent. Answers are keyed by
 * `question.field` (`location`, `dietaryNeeds`, …) and POSTed as
 * `Record<string, string>` to `/api/clarify`.
 */
import { useState } from "react";
import { ClarificationQuestion } from "@/types";

interface ClarificationDialogProps {
  questions: ClarificationQuestion[];
  onSubmit: (answers: Record<string, string>) => void;
}

/** Follow-up form; submit sends `{ [field]: answer }` to the parent. */
export function ClarificationDialog({
  questions,
  onSubmit,
}: ClarificationDialogProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const handleAnswer = (field: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(answers);
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl shadow-lg p-6 border-l-4 border-amber-400">
        <div className="flex items-center gap-2 mb-4">
          <svg
            className="w-5 h-5 text-amber-500"
            fill="currentColor"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
          <h3 className="text-lg font-semibold text-gray-800">
            Need a bit more info
          </h3>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {questions.map((q) => (
            <div key={q.field}>
              <label
                htmlFor={`clarify-${q.field}`}
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                {q.question}
              </label>

              {q.options ? (
                <div className="flex flex-wrap gap-2">
                  {q.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() =>
                        handleAnswer(q.field, option.toLowerCase())
                      }
                      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                        answers[q.field] === option.toLowerCase()
                          ? "bg-primary-500 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  id={`clarify-${q.field}`}
                  type="text"
                  value={answers[q.field] || ""}
                  onChange={(e) => handleAnswer(q.field, e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                  placeholder="Type your answer..."
                />
              )}
            </div>
          ))}

          <button
            type="submit"
            disabled={Object.keys(answers).length === 0}
            className="w-full py-3 px-6 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors"
          >
            Continue Search
          </button>
        </form>
      </div>
    </div>
  );
}
