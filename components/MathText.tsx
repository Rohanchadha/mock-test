'use client'

import katex from 'katex'
import 'katex/dist/katex.min.css'

interface Props {
  text: string
  className?: string
}

/**
 * Renders text that may contain inline LaTeX delimited by $...$
 * Non-math segments are rendered as plain text.
 * Block math $$...$$ is also supported.
 */
export default function MathText({ text, className }: Props) {
  const parts = parseMath(text)

  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (!part.isMath) return <span key={i}>{part.content}</span>

        try {
          const html = katex.renderToString(part.content, {
            throwOnError: false,
            displayMode: part.displayMode,
            output: 'html',
          })
          return (
            <span
              key={i}
              dangerouslySetInnerHTML={{ __html: html }}
              className={part.displayMode ? 'block my-2 text-center' : 'inline'}
            />
          )
        } catch {
          return <span key={i} className="text-red-500">{part.content}</span>
        }
      })}
    </span>
  )
}

interface MathPart {
  isMath: boolean
  content: string
  displayMode: boolean
}

function parseMath(text: string): MathPart[] {
  const parts: MathPart[] = []
  // Match $$...$$ (display) or $...$ (inline)
  const regex = /\$\$([\s\S]*?)\$\$|\$((?:[^$\\]|\\.)+?)\$/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    // Text before this math segment
    if (match.index > lastIndex) {
      parts.push({ isMath: false, content: text.slice(lastIndex, match.index), displayMode: false })
    }

    if (match[1] !== undefined) {
      // $$...$$
      parts.push({ isMath: true, content: match[1], displayMode: true })
    } else {
      // $...$
      parts.push({ isMath: true, content: match[2], displayMode: false })
    }

    lastIndex = regex.lastIndex
  }

  // Remaining text
  if (lastIndex < text.length) {
    parts.push({ isMath: false, content: text.slice(lastIndex), displayMode: false })
  }

  return parts
}
