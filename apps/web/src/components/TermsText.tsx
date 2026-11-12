import type { TermsDocument } from '../lib/legal.ts'

/** The terms as a readable document. */
export function TermsText({ doc }: { doc: TermsDocument }) {
  return (
    <article className="flex flex-col gap-6 leading-8">
      <p className="text-base">{doc.intro}</p>
      {doc.sections.map((s) => (
        <section key={s.title} className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">{s.title}</h2>
          {s.paragraphs.map((p) => (
            <p key={p} className="text-[15px] text-[#33445b]">
              {p}
            </p>
          ))}
        </section>
      ))}
      <p className="border-t border-line pt-5 text-base font-semibold">{doc.closing}</p>
    </article>
  )
}
