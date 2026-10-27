import Image from "next/image";
import sanitizeHtml from "sanitize-html";

import type { Item, Source } from "@/lib/data";

const PLACEHOLDER = /(\[(?:NAME|EMAIL|PHONE)\])/;

const PLACEHOLDER_LABELS: Record<string, string> = {
  "[NAME]": "Name removed",
  "[EMAIL]": "Email address removed",
  "[PHONE]": "Phone number removed",
};

function categoryLabel(category: string) {
  const words = category.replaceAll("_", " ").replace(/\bgva\b/, "GVA");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// The answer is written by a model, so only let through formatting and https links
function cleanAnswer(content: string) {
  return sanitizeHtml(content, {
    allowedTags: ["b", "strong", "i", "em", "a", "br", "p", "ul", "ol", "li"],
    allowedAttributes: { a: ["href", "title", "target", "rel"] },
    allowedSchemes: ["https"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
    },
  });
}

function Question({ question }: { question: string }) {
  // split() with a capturing group puts each placeholder at an odd index
  return question.split(PLACEHOLDER).map((part, index) =>
    index % 2 === 1 ? (
      <span
        key={index}
        title={PLACEHOLDER_LABELS[part]}
        className="rounded bg-slate-200 px-1 font-mono text-sm text-slate-700"
      >
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function SourceLink({ source }: { source: Source }) {
  const site = new URL(source.source).hostname.replace(/^www\./, "");
  return (
    <a
      href={source.source}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start gap-3 rounded-md p-2 hover:bg-slate-100"
    >
      {source.favicon ? (
        <Image
          src={source.favicon}
          alt=""
          width={16}
          height={16}
          unoptimized
          className="mt-1 size-4 shrink-0"
        />
      ) : (
        <span className="mt-1 size-4 shrink-0 rounded-sm bg-slate-300" />
      )}
      <span className="flex flex-col">
        <span className="text-[#004b88] group-hover:underline">{source.title}</span>
        <span className="text-sm text-slate-500">{site}</span>
      </span>
    </a>
  );
}

export default function Content({ item }: { item: Item }) {
  const cited = item.sources.filter((source) => source.citation !== null);
  const uncited = item.sources.filter((source) => source.citation === null);

  return (
    <article className="w-full rounded-lg bg-white p-4 text-slate-900 shadow-lg sm:p-6">
      <p className="text-sm font-semibold tracking-wide text-[#004b88] uppercase">
        {categoryLabel(item.category)}
      </p>

      <section className="mt-3">
        <h3 className="sr-only">Question</h3>
        <p className="border-l-4 border-slate-300 pl-4 text-lg leading-relaxed italic">
          <Question question={item.question} />
        </p>
      </section>

      <section className="mt-6">
        <h3 className="mb-2 font-bold">Answer</h3>
        <div
          className="leading-relaxed whitespace-pre-line [&_a]:ml-0.5 [&_a]:align-super [&_a]:text-xs [&_a]:font-semibold [&_a]:text-[#004b88] [&_a]:hover:underline"
          dangerouslySetInnerHTML={{ __html: cleanAnswer(item.content) }}
        />
      </section>

      <section className="mt-6 border-t border-slate-200 pt-4">
        <h3 className="mb-2 font-bold">Sources</h3>
        <ol>
          {cited.map((source) => (
            <li key={source.id} className="flex items-start gap-1">
              <span className="mt-2 w-6 shrink-0 text-right text-sm font-semibold text-slate-500">
                [{source.citation}]
              </span>
              <SourceLink source={source} />
            </li>
          ))}
        </ol>

        {uncited.length > 0 && (
          <>
            <h4 className="mt-4 mb-1 text-sm font-semibold text-slate-500">
              Also found, but not cited in the answer
            </h4>
            <ul className="pl-7">
              {uncited.map((source) => (
                <li key={source.id}>
                  <SourceLink source={source} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </article>
  );
}
