import { createSignal } from 'solid-js'
import MarkdownIt from 'markdown-it'
import mdKatex from 'markdown-it-katex'
import mdHighlight from 'markdown-it-highlightjs'
import { useClipboard, useEventListener } from 'solidjs-use'
import IconRefresh from './icons/Refresh'
import type { Accessor } from 'solid-js'
import type { ChatMessage } from '@/types'

interface Props {
  role: ChatMessage['role']
  message: Accessor<string> | string
  showRetry?: Accessor<boolean>
  onRetry?: () => void
}

export default ({ role, message, showRetry = () => false, onRetry }: Props) => {
  const [source] = createSignal('')
  const { copy, copied } = useClipboard({ source, copiedDuring: 1000 })

  useEventListener('click', (e) => {
    const el = e.target as HTMLElement
    let code = null

    if (el.matches('div > div.copy-btn')) {
      code = decodeURIComponent(el.dataset.code!)
      copy(code)
    }
    if (el.matches('div > div.copy-btn > svg')) {
      code = decodeURIComponent(el.parentElement?.dataset.code!)
      copy(code)
    }
  })

  const htmlString = () => {
    const md = MarkdownIt({
      linkify: true,
      breaks: true,
      html: true,
    }).use(mdKatex).use(mdHighlight)

    // 添加标题锚点
    const defaultRender = md.renderer.rules.heading_open || function(tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options)
    }

    md.renderer.rules.heading_open = function(tokens, idx, options, env, self) {
      const title = tokens[idx + 1].content
      const id = title.toLowerCase().replace(/\s+/g, '-')
      tokens[idx].attrs = tokens[idx].attrs || []
      tokens[idx].attrs.push(['id', id])
      return defaultRender(tokens, idx, options, env, self)
    }

    const content = typeof message === 'function' ? message() : message

    // 如果是用户消息，添加一个隐藏的锚点
    if (role === 'user') {
      const anchorId = content.toLowerCase().replace(/\s+/g, '-')
      return `<div id="${anchorId}" class="user-message">${md.render(content)}</div>`
    }

    return md.render(content)
  }

  return (
    <div class="py-2 -mx-4 px-2 sm:px-4 transition-colors md:hover:bg-slate/3 group w-full max-w-screen-xl mx-auto md:pr-[10rem]">
      <div class="rounded-lg" class:op-75={role === 'user'}>
        <div
          class="message prose prose-slate dark:prose-invert dark:text-slate break-words overflow-hidden max-w-none"
          innerHTML={htmlString()}
        />
      </div>
      {showRetry() && onRetry && (
        <div class="flex items-center justify-end px-3 mb-2">
          <div onClick={onRetry} class="retry-btn">
            <IconRefresh />
            <span>Retry</span>
          </div>
        </div>
      )}
    </div>
  )
}
