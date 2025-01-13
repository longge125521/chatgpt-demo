import { createSignal } from 'solid-js'
import MarkdownIt from 'markdown-it'
import mdKatex from 'markdown-it-katex'
import mdHighlight from 'markdown-it-highlightjs'
import { useClipboard, useEventListener } from 'solidjs-use'
import IconRefresh from './icons/Refresh'
import IconDelete from './icons/Delete'
import type { Accessor } from 'solid-js'
import type { ChatMessage } from '@/types'

interface Props {
  role: ChatMessage['role']
  message: Accessor<string> | string
  showRetry?: Accessor<boolean>
  onRetry?: () => void
  onDelete?: () => void
}

export default ({ role, message, showRetry = () => false, onRetry, onDelete }: Props) => {
  const [source] = createSignal('')
  const { copy, copied } = useClipboard({ source, copiedDuring: 1000 })

  useEventListener('click', (e) => {
    const el = e.target as HTMLElement
    let code = null

    if (el.matches('div > div.copy-btn')) {
      code = decodeURIComponent(el.dataset.code!)
      console.log('Copying code:', code)
      copy(code)
    }
    if (el.matches('div > div.copy-btn > svg')) {
      code = decodeURIComponent(el.parentElement?.dataset.code!)
      console.log('Copying code from svg:', code)
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

    // 处理代码块复制按钮
    const fence = md.renderer.rules.fence!
    md.renderer.rules.fence = (...args) => {
      const [tokens, idx] = args
      const token = tokens[idx]
      const rawCode = fence(...args)

      return `<div relative>
        <div data-code=${encodeURIComponent(token.content)} class="copy-btn gpt-copy-btn group">
          <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 32 32"><path fill="currentColor" d="M28 10v18H10V10h18m0-2H10a2 2 0 0 0-2 2v18a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2Z" /><path fill="currentColor" d="M4 18H2V4a2 2 0 0 1 2-2h14v2H4Z" /></svg>
          <div class="group-hover:op-100 gpt-copy-tips">
            ${copied() ? 'Copied' : 'Copy'}
          </div>
        </div>
        ${rawCode}
      </div>`
    }

    if (typeof message === 'function')
      return md.render(message())
    else if (typeof message === 'string')
      return md.render(message)

    return ''
  }

  return (
    <div class="py-2 -mx-4 px-2 sm:px-4 transition-colors md:hover:bg-slate/3 w-full max-w-screen-xl mx-auto md:pr-[10rem]">
      <div class="rounded-lg" class:op-75={role === 'user'}>
        <div
          class="message prose prose-slate dark:prose-invert dark:text-slate break-words overflow-hidden max-w-none"
          innerHTML={htmlString()}
        />
        {onDelete && (
          <button onClick={onDelete} class="absolute top-2 right-2 p-1 text-gray-500 hover:text-red-500 transition">
            <IconDelete />
          </button>
        )}
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
