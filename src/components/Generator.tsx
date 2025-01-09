import { Index, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { useThrottleFn } from 'solidjs-use'
import { saveAs } from 'file-saver'
import { generateSignature } from '@/utils/auth'
import IconClear from './icons/Clear'
import MessageItem from './MessageItem'
import SystemRoleSettings from './SystemRoleSettings'
import ErrorMessageItem from './ErrorMessageItem'
import { Outline } from './Outline'
import type { ChatMessage, ErrorMessage } from '@/types'

export default () => {
  let inputRef: HTMLTextAreaElement
  const [currentSystemRoleSettings, setCurrentSystemRoleSettings] = createSignal('')
  const [systemRoleEditing, setSystemRoleEditing] = createSignal(false)
  const [messageList, setMessageList] = createSignal<ChatMessage[]>([])
  const [currentError, setCurrentError] = createSignal<ErrorMessage>()
  const [currentAssistantMessage, setCurrentAssistantMessage] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  const [controller, setController] = createSignal<AbortController>(null)
  const [isStick, setStick] = createSignal(false)
  const [temperature, setTemperature] = createSignal(0.6)
  const temperatureSetting = (value: number) => { setTemperature(value) }
  const maxHistoryMessages = parseInt(import.meta.env.PUBLIC_MAX_HISTORY_MESSAGES || '9')

  createEffect(() => (isStick() && smoothToBottom()))

  onMount(() => {
    let lastPostion = window.scrollY

    window.addEventListener('scroll', () => {
      const nowPostion = window.scrollY
      nowPostion < lastPostion && setStick(false)
      lastPostion = nowPostion
    })

    try {
      if (sessionStorage.getItem('messageList'))
        setMessageList(JSON.parse(sessionStorage.getItem('messageList')))

      if (sessionStorage.getItem('systemRoleSettings'))
        setCurrentSystemRoleSettings(sessionStorage.getItem('systemRoleSettings'))

      if (localStorage.getItem('stickToBottom') === 'stick')
        setStick(true)
    } catch (err) {
      console.error(err)
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    onCleanup(() => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    })
  })

  const handleBeforeUnload = () => {
    sessionStorage.setItem('messageList', JSON.stringify(messageList()))
    sessionStorage.setItem('systemRoleSettings', currentSystemRoleSettings())
    isStick() ? localStorage.setItem('stickToBottom', 'stick') : localStorage.removeItem('stickToBottom')
  }

  const handleButtonClick = async() => {
    const inputValue = inputRef.value
    if (!inputValue)
      return

    inputRef.value = ''
    setMessageList([
      ...messageList(),
      {
        role: 'user',
        content: inputValue,
      },
    ])
    requestWithLatestMessage()
    instantToBottom()
  }

  const smoothToBottom = useThrottleFn(() => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
  }, 300, false, true)

  const instantToBottom = () => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' })
  }

  const requestWithLatestMessage = async() => {
    setLoading(true)
    setCurrentAssistantMessage('')
    setCurrentError(null)
    const storagePassword = localStorage.getItem('pass')
    try {
      const controller = new AbortController()
      setController(controller)
      const requestMessageList = messageList().slice(-maxHistoryMessages)
      if (currentSystemRoleSettings()) {
        requestMessageList.unshift({
          role: 'system',
          content: currentSystemRoleSettings(),
        })
      }
      const timestamp = Date.now()
      const response = await fetch('/api/generate', {
        method: 'POST',
        body: JSON.stringify({
          messages: requestMessageList,
          time: timestamp,
          pass: storagePassword,
          sign: await generateSignature({
            t: timestamp,
            m: requestMessageList?.[requestMessageList.length - 1]?.content || '',
          }),
          temperature: temperature(),
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const error = await response.json()
        console.error(error.error)
        setCurrentError(error.error)
        throw new Error('Request failed')
      }
      const data = response.body
      if (!data)
        throw new Error('No data')

      const reader = data.getReader()
      const decoder = new TextDecoder('utf-8')
      let done = false

      while (!done) {
        const { value, done: readerDone } = await reader.read()
        if (value) {
          const char = decoder.decode(value)
          if (char === '\n' && currentAssistantMessage().endsWith('\n'))
            continue

          if (char)
            setCurrentAssistantMessage(currentAssistantMessage() + char)

          isStick() && instantToBottom()
        }
        done = readerDone
      }
    } catch (e) {
      console.error(e)
      setLoading(false)
      setController(null)
      return
    }
    archiveCurrentMessage()
    isStick() && instantToBottom()
  }

  const archiveCurrentMessage = () => {
    if (currentAssistantMessage()) {
      setMessageList([
        ...messageList(),
        {
          role: 'assistant',
          content: currentAssistantMessage(),
        },
      ])
      setCurrentAssistantMessage('')
      setLoading(false)
      setController(null)
      // Disable auto-focus on touch devices
      if (!('ontouchstart' in document.documentElement || navigator.maxTouchPoints > 0))
        inputRef.focus()
    }
  }

  const clear = () => {
    inputRef.value = ''
    inputRef.style.height = 'auto'
    setMessageList([])
    setCurrentAssistantMessage('')
    setCurrentError(null)
  }

  const stopStreamFetch = () => {
    if (controller()) {
      controller().abort()
      archiveCurrentMessage()
    }
  }

  const retryLastFetch = () => {
    if (messageList().length > 0) {
      const lastMessage = messageList()[messageList().length - 1]
      if (lastMessage.role === 'assistant')
        setMessageList(messageList().slice(0, -1))
      requestWithLatestMessage()
    }
  }

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.isComposing || e.shiftKey)
      return

    if (e.key === 'Enter') {
      e.preventDefault()
      handleButtonClick()
    }
  }

  const exportToWord = () => {
    const mainTitle = messageList().length > 0 ? messageList()[0].content.split('\n')[0] : 'Document'
    const messages = messageList().map((msg, index) => {
      let content = ''
      let isInCodeBlock = false
      let codeLanguage = ''

      const lines = msg.content.split('\n')
      lines.forEach((line, lineIndex) => {
        if (index === 0 && lineIndex === 0) return

        if (line.startsWith('```')) {
          if (isInCodeBlock) {
            content += '</code></pre>'
          } else {
            codeLanguage = line.slice(3).trim()
            content += `<pre class="code-block ${codeLanguage}"><code class="language-${codeLanguage}">`
          }
          isInCodeBlock = !isInCodeBlock
        } else if (line.startsWith('#')) {
          const level = line.match(/^#+/)[0].length
          content += `<h${level} class="heading-${level}">${line.replace(/^#+\s*/, '')}</h${level}>`
        } else {
          if (isInCodeBlock) {
            const escapedLine = line
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/\t/g, '    ')
            content += `${escapedLine}\n`
          } else if (line.trim()) {
            content += `<p class="paragraph">${line}</p>`
          }
        }
      })

      if (isInCodeBlock) content += '</code></pre>'

      return `<div class="message-content">${content}</div>`
    }).join('')

    const blob = new Blob([`<html xmlns:w="urn:schemas-microsoft-com:office:word">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
        <title>Exported Document</title>
        <!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:TrackMoves>false</w:TrackMoves><w:TrackFormatting/><w:ValidateAgainstSchemas/><w:SaveIfXMLInvalid>false</w:SaveIfXMLInvalid><w:IgnoreMixedContent>false</w:IgnoreMixedContent><w:AlwaysShowPlaceholderText>false</w:AlwaysShowPlaceholderText><w:DoNotPromoteQF/><w:LidThemeOther>EN-US</w:LidThemeOther><w:LidThemeAsian>ZH-CN</w:LidThemeAsian><w:LidThemeComplexScript>X-NONE</w:LidThemeComplexScript><w:Compatibility><w:BreakWrappedTables/><w:SnapToGridInCell/><w:WrapTextWithPunct/><w:UseAsianBreakRules/><w:DontGrowAutofit/><w:SplitPgBreakAndParaMark/><w:DontVertAlignCellWithSp/><w:DontBreakConstrainedForcedTables/><w:DontVertAlignInTxbx/><w:Word11KerningPairs/><w:CachedColBalance/><w:UseFELayout/></w:Compatibility><w:BrowserLevel>MicrosoftInternetExplorer4</w:BrowserLevel><m:mathPr><m:mathFont m:val="Cambria Math"/><m:brkBin m:val="before"/><m:brkBinSub m:val="--"/><m:smallFrac m:val="off"/><m:dispDef/><m:lMargin m:val="0"/> <m:rMargin m:val="0"/><m:defJc m:val="centerGroup"/><m:wrapIndent m:val="1440"/><m:intLim m:val="subSup"/><m:naryLim m:val="undOvr"/></m:mathPr></w:WordDocument></xml><![endif]-->
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <?mso-application progid="Word.Document"?>
        <style>
          @page {
            size: A4;
            margin: 2.5cm;
          }
          body { 
            font-family: 'Arial', sans-serif;
            font-size: 12pt;
            line-height: 1.6;
            max-width: 100%;
            margin: auto;
            padding: 0;
            word-wrap: break-word;
            color: #333;
          }
          .main-title {
            text-align: center;
            font-family: 'Arial', sans-serif;
            font-size: 20pt;
            font-weight: bold;
            margin: 20pt 0;
            color: #2C3E50;
          }
          .message-content { 
            color: #333;
            margin: 0;
          }
          .code-block { 
            background-color: #F3F4F6;
            padding: 12pt;
            border: 1pt solid #D1D5DB;
            border-radius: 4pt;
            font-family: 'Courier New', monospace;
            font-size: 11pt;
            margin: 8pt 0;
            white-space: pre-wrap;
            line-height: 1.4;
            page-break-inside: avoid;
          }
          code {
            font-family: 'Courier New', monospace;
            font-size: 11pt;
            display: block;
          }
          .heading-1 {
            font-family: 'Arial', sans-serif;
            font-size: 20pt;
            font-weight: bold;
            margin: 20pt 0 10pt;
            color: #2C3E50;
            page-break-after: avoid;
          }
          .heading-2 {
            font-family: 'Arial', sans-serif;
            font-size: 16pt;
            font-weight: bold;
            margin: 16pt 0 8pt;
            color: #2C3E50;
            page-break-after: avoid;
          }
          .heading-3 {
            font-family: 'Arial', sans-serif;
            font-size: 14pt;
            font-weight: bold;
            margin: 12pt 0 6pt;
            color: #2C3E50;
            page-break-after: avoid;
          }
          .paragraph {
            margin: 0 0 12pt;
          }
          pre { page-break-inside: avoid; }
          h1, h2, h3 { page-break-after: avoid; }
          p { orphans: 2; widows: 2; }
        </style>
        <script type="text/javascript">
          window.onload = function() {
            document.body.style.zoom = "100%"; // 设置默认缩放
          }
        </script>
      </head>
      <body>
        <h1 class="main-title">${mainTitle}</h1>
        ${messages}
      </body>
    </html>`], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    const firstMessage = messageList().length > 0 ? messageList()[0].content.split('\n')[0] : 'exported_document'
    saveAs(blob, `${firstMessage || 'exported_document'}.docx`)
  }

  const exportToMarkdown = () => {
    // 获取第一行作为标题
    const mainTitle = messageList().length > 0 ? messageList()[0].content.split('\n')[0] : 'Document'

    // 使用消息列表来构建 markdown 内容，跳过第一条消息的第一行
    const messages = messageList().map((msg, index) => {
      const lines = msg.content.split('\n')
      // 如果是第一条消息，跳过第一行
      if (index === 0)
        return lines.slice(1).join('\n')
      return msg.content
    }).join('\n\n')

    // 使用纯 Markdown 语法创建居中的标题
    const markdownContent = `# ${mainTitle}\n\n${messages}`

    // 创建并下载文件
    const blob = new Blob([markdownContent], { type: 'text/markdown' })
    saveAs(blob, `${mainTitle || 'exported_document'}.md`)
  }

  const generateOutline = (content: string) => {
    const lines = content.split('\n')
    let outline = ''

    // 使用第一个 MessageItem 的第一行文字作为标题
    const firstMessageContent = messageList().length > 0 ? messageList()[0].content : ''
    const firstLineOfMessage = firstMessageContent.split('\n')[0] || 'Outline'
    outline += `# ${firstLineOfMessage}\n\n`

    // 处理每一行
    lines.forEach((line) => {
      const trimmedLine = line.trim()
      if (trimmedLine) {
        if (line.startsWith('#')) {
          // 如果是标题，保持原有层级
          const level = line.match(/^#+/)[0].length
          outline += `${'  '.repeat(level - 1)}- ${line.replace(/^#+\s*/, '')}\n`
        } else if (!line.startsWith('```')) {
          // 如果不是代码块标记，作为二级标题
          outline += `  - ${trimmedLine}\n`
        }
      }
    })

    return outline
  }

  return (
    <div className="relative">
      {(currentAssistantMessage() || messageList().length > 0) && (
        <Outline
          markdown={currentAssistantMessage()
            || (messageList().length > 0
              ? messageList()[messageList().length - 1].content
              : ''
            )
          }
          title={messageList().length > 0 ? messageList()[0].content.split('\n')[0] : '大纲'}
        />
      )}
      <div my-6>
        <SystemRoleSettings
          canEdit={() => messageList().length === 0}
          systemRoleEditing={systemRoleEditing}
          setSystemRoleEditing={setSystemRoleEditing}
          currentSystemRoleSettings={currentSystemRoleSettings}
          setCurrentSystemRoleSettings={setCurrentSystemRoleSettings}
          temperatureSetting={temperatureSetting}
        />
        <Index each={messageList()}>
          {(message, index) => (
            <MessageItem
              role={message().role}
              message={message().content}
              showRetry={() => (message().role === 'assistant' && index === messageList().length - 1)}
              onRetry={retryLastFetch}
            />
          )}
        </Index>
        {currentAssistantMessage() && (
          <MessageItem
            role="assistant"
            message={currentAssistantMessage}
          />
        )}
        { currentError() && <ErrorMessageItem data={currentError()} onRetry={retryLastFetch} /> }
        <Show
          when={!loading()}
          fallback={() => (
            <div class="gen-cb-wrapper">
              <span>...</span>
              <div class="gen-cb-stop" onClick={stopStreamFetch}>Stop</div>
            </div>
          )}
        >
          <div class="gen-text-wrapper" class:op-50={systemRoleEditing()}>
            <textarea
              ref={inputRef!}
              disabled={systemRoleEditing()}
              onKeyDown={handleKeydown}
              placeholder="Enter something..."
              autocomplete="off"
              autofocus
              onInput={() => {
                inputRef.style.height = 'auto'
                inputRef.style.height = `${inputRef.scrollHeight}px`
              }}
              rows="1"
              class="gen-textarea"
            />
            <button onClick={handleButtonClick} disabled={systemRoleEditing()} gen-slate-btn>
              Send
            </button>
            <button title="Clear" onClick={clear} disabled={systemRoleEditing()} gen-slate-btn>
              <IconClear />
            </button>
          </div>
        </Show>
      </div>
      <div class="fixed bottom-5 left-5 flex items-center gap-4">
        <div class="stick-btn">
          <button class="p-2.5 text-base" title="stick to bottom" type="button" onClick={() => setStick(!isStick())}>
            <div i-ph-arrow-line-down-bold />
          </button>
        </div>
        <div class="floating-buttons flex items-center gap-2">
          <button onClick={exportToWord} class="export-button">
            <img src="/word-icon.svg" alt="Export to Word" class="icon" />
          </button>
          <button onClick={exportToMarkdown} class="export-button">
            <img src="/md-icon.svg" alt="Export to Markdown" class="icon" />
          </button>
        </div>
      </div>
    </div>
  )
}
