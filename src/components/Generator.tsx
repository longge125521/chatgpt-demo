import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { useThrottleFn } from 'solidjs-use'
import { saveAs } from 'file-saver'
import { generateSignature } from '@/utils/auth'
import IconClear from './icons/Clear'
import MessageItem from './MessageItem'
import SystemRoleSettings from './SystemRoleSettings'
import ErrorMessageItem from './ErrorMessageItem'
import { Outline } from './Outline'
import IconDelete from './icons/Delete'
import type { ChatMessage, ErrorMessage } from '@/types'

// 动态导入以避免SSR问题
let jsPDF: any

if (typeof window !== 'undefined') {
  Promise.all([
    import('jspdf'),
  ]).then(([jsPDFModule]) => {
    jsPDF = jsPDFModule.default
  })
}

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
  const [updateFlag, setUpdateFlag] = createSignal(0)

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

  const processExportContent = (message: ChatMessage) => {
    // 如果是用户消息，将其作为一级标题
    if (message.role === 'user')
      return `# ${message.content}`
    // 如果是助手消息，保持原样
    return message.content
  }

  const exportToWord = () => {
    const mainTitle = messageList().length > 0 ? messageList()[0].content.split('\n')[0] : 'Document'
    const messages = messageList().map((msg) => {
      let content = ''
      let isInCodeBlock = false
      let isInList = false
      let codeLanguage = ''

      // 处理消息内容，确保用户提问作为一级标题
      const processedContent = processExportContent(msg)
      const lines = processedContent.split('\n')
      lines.forEach((line, lineIndex) => {
        // 只跳过第一条消息的第一行
        if (msg === messageList()[0] && lineIndex === 0) return

        if (line.trim().startsWith('-')) {
          if (!isInList) {
            content += '<ul style="list-style-type: disc; margin: 8pt 0;">'
            isInList = true
          }
          content += processListItems(line)
        } else {
          if (isInList) {
            content += '</ul>'
            isInList = false
          }
          if (line.trim().startsWith('```')) {
            if (isInCodeBlock) {
              content += '</code></pre>'
            } else {
              codeLanguage = line.slice(3).trim()
              content += `<pre class="code-block ${codeLanguage}"><code class="language-${codeLanguage}">`
            }
            isInCodeBlock = !isInCodeBlock
          } else if (line.startsWith('#') && !isInCodeBlock) {
            const level = line.match(/^#+/)[0].length
            const titleText = line.replace(/^#+\s*/, '')
            if (level === 1)
              content += `<h1 class="heading-1">${titleText}</h1>`
            else
              content += `<h${level} class="heading-${level}">${titleText}</h${level}>`
          } else {
            if (isInCodeBlock) {
              // 处理代码块内的加粗文本
              if (line.match(/^\*\*.+\*\*$/)) {
                // 如果整行都是加粗文本
                const boldText = line.replace(/^\*\*|\*\*$/g, '')
                content += `<div class="code-title">${boldText}</div>\n`
              } else if (line.includes('**')) {
                // 如果行中包含加粗部分
                const escapedLine = line
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/\t/g, '    ')
                  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                content += `${escapedLine}\n`
              } else {
                const escapedLine = line
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/\t/g, '    ')
                content += `${escapedLine}\n`
              }
            } else if (line.trim()) {
              // 处理普通文本中的加粗
              if (line.match(/^\*\*.+\*\*$/)) {
                // 如果整行都是加粗文本
                const boldText = line.replace(/^\*\*|\*\*$/g, '')
                content += `<p class="paragraph"><strong>${boldText}</strong></p>`
              } else if (line.includes('**')) {
                // 如果行中包含加粗部分
                const processedLine = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                content += `<p class="paragraph">${processedLine}</p>`
              } else {
                // 普通文本
                content += `<p class="paragraph">${line}</p>`
              }
            }
          }
        }
      })

      if (isInList)
        content += '</ul>'

      if (isInCodeBlock) content += '</code></pre>'

      return `<div class="message-content">${content}</div>`
    }).join('')

    const blob = new Blob([`<html xmlns:w="urn:schemas-microsoft-com:office:word">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
        <title>Exported Document</title>
        <!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
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
            text-align: center;
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
          .bold-title {
            font-size: 14pt;
            font-weight: bold;
            color: #2C3E50;
            margin: 12pt 0 6pt;
            font-family: 'Arial', sans-serif;
          }
          .code-title {
            font-weight: bold;
            color: #2C3E50;
            font-size: 12pt;
            margin: 8pt 0 4pt;
            font-family: 'Arial', sans-serif;
          }
          strong {
            font-weight: bold;
            color: #2C3E50;
          }
          .code-block strong {
            color: #2C3E50;
            background-color: #E5E7EB;
            padding: 1pt 2pt;
          }
          ul {
            list-style-type: disc;
            margin-left: 20pt;
            padding-left: 20pt;
          }
          li {
            margin-bottom: 6pt;
          }
        </style>
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
    const mainTitle = messageList().length > 0 ? messageList()[0].content.split('\n')[0] : 'Document'

    // 使用消息列表来构建 markdown 内容，处理配置文件格式
    const messages = messageList().map((msg) => {
      // 处理消息内容，确保用户提问作为一级标题
      const processedContent = processExportContent(msg)
      const lines = processedContent.split('\n')
      // 处理每一行
      const formattedLines = lines.map((line, lineIndex) => {
        // 如果是第一条消息的第一行，跳过
        if (msg === messageList()[0] && lineIndex === 0)
          return null

        // 检查是否在代码块内
        if (line.startsWith('```'))
          return line

        // 处理配置文件标题（被 ** 包围的行）
        if (line.startsWith('**') && line.endsWith('**')) {
          const title = line.replace(/^\*\*|\*\*$/g, '')
          return `### ${title}`
        }

        // 处理配置项（key: value 格式）
        if (line.includes(':') && !line.includes(' :')) {
          // 计算缩进级别
          const indentLevel = line.match(/^\s*/)[0].length / 2
          const indent = '  '.repeat(indentLevel)
          return `${indent}${line}`
        }

        return line
      }).filter(Boolean) // 移除 null 值

      return formattedLines.join('\n')
    }).join('\n\n')

    // 使用纯 Markdown 语法创建居中的标题
    const markdownContent = `# ${mainTitle}\n\n${messages}`

    // 创建并下载文件
    const blob = new Blob([markdownContent], { type: 'text/markdown' })
    saveAs(blob, `${mainTitle || 'exported_document'}.md`)
  }

  const exportToPDF = async() => {
    if (!jsPDF) {
      console.error('PDF export modules not loaded')
      return
    }

    const mainTitle = messageList().length > 0 ? messageList()[0].content.split('\n')[0] : 'Document'

    // 创建 PDF 实例
    const PDF = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: 'a4',
      putOnlyUsedFonts: true,
    })

    // 添加中文字体支持
    await PDF.addFont('/fonts/NotoSansSC-Regular.ttf', 'NotoSans', 'normal')
    await PDF.addFont('/fonts/NotoSansSC-Bold.ttf', 'NotoSans', 'bold') // 添加加粗字体
    PDF.setFont('NotoSans', 'normal')

    // 设置字体大小和颜色
    const titleSize = 24
    const normalSize = 12
    const codeSize = 11

    // 修改代码块的样式
    const codeBlockBgColor = 245
    const codeTextColor = {
      r: 40,
      g: 42,
      b: 54,
    }
    const codePadding = {
      top: 15, // 代码块顶部内边距
      bottom: 15, // 代码块底部内边距
      left: 15, // 代码文本左边距
      right: 15, // 代码文本右边距
    }
    const codeLineHeight = 1.6
    const codeBlockMargin = 10 // 代码块与其他内容的间距

    // 用于存储大纲和页码的数组
    const outlineItems = []
    let currentPage = 1

    // 设置初始 y 坐标
    let y = 40

    // 添加标题并记录到大纲
    PDF.setFontSize(titleSize)
    // 计算文本宽度来居中显示
    const titleWidth = PDF.getTextWidth(mainTitle)
    const pageWidth = 595 // A4纸的宽度(pt)
    const titleX = (pageWidth - titleWidth) / 2 // 居中的X坐标
    PDF.text(mainTitle, titleX, y)
    outlineItems.push({
      title: mainTitle,
      page: currentPage,
      y,
    })
    y += titleSize + 20

    // 添加配置文件相关的颜色设置
    const configColors = {
      title: { r: 50, g: 50, b: 50 }, // 配置标题颜色
      key: { r: 89, g: 116, b: 150 }, // 配置键名颜色
      value: { r: 145, g: 40, b: 140 }, // 配置值颜色
    }

    // 在处理代码块之前，添加一个辅助函数来计算代码块的预计高度
    const calculateLineHeight = () => {
      return codeSize * codeLineHeight
    }

    // 遍历消息
    messageList().forEach((msg) => {
      // 处理消息内容，确保用户提问作为一级标题
      const processedContent = processExportContent(msg)
      const lines = processedContent.split('\n')
      let isInCodeBlock = false
      let isConfigBlock = false // 用于标记是否是配置文件代码块
      const isInList = false // 添加列表状态标记

      lines.forEach((line) => {
        // 跳过第一条消息的标题
        if (msg === messageList()[0] && line === lines[0])
          return

        if (line.trim().startsWith('```')) {
          if (!isInCodeBlock) {
            // 计算每行高度
            const lineHeight = calculateLineHeight()
            // 计算当前页面剩余空间能容纳的行数
            const remainingSpace = 780 - y
            const remainingLines = Math.floor(remainingSpace / lineHeight)

            // 如果剩余空间不足以容纳至少3行代码，则换页
            // 3行是为了确保至少能显示代码块的开始部分，这个数字可以根据需要调整
            if (remainingLines < 3) {
              PDF.addPage()
              currentPage++
              y = 40
            }
          }

          isInCodeBlock = !isInCodeBlock
          // 检查是否是配置文件代码块
          isConfigBlock = line.includes('config') || line.includes('yaml') || line.includes('yml')
          if (!isInCodeBlock) {
            y += codePadding.bottom + codeBlockMargin // 代码块结束后的间距
            PDF.setFontSize(normalSize)
            PDF.setTextColor(0, 0, 0)
          } else {
            y += codeBlockMargin // 代码块开始前的间距
            PDF.setFillColor(codeBlockBgColor)
            PDF.rect(30, y - codePadding.top, 535, codePadding.top + 1, 'F') // 上边框
            y += codePadding.top // 代码块开始前的内边距
            PDF.setFontSize(codeSize)
            PDF.setTextColor(codeTextColor.r, codeTextColor.g, codeTextColor.b)
          }
          return
        }

        // 处理 Markdown 标题
        if (line.startsWith('**') && line.endsWith('**') && !isInCodeBlock) {
          const titleText = line.replace(/^\*\*|\*\*$/g, '')
          PDF.setFontSize(titleSize - 10) // 将标题字号减小
          PDF.setTextColor(50, 50, 50) // 标题使用深灰色
          PDF.text(titleText, 40, y - 3)
          y += (PDF.getFontSize() * 1.5) // 增加 y 坐标
          return
        }

        if (line.startsWith('#') && !isInCodeBlock) {
          // 标题处理
          const level = line.match(/^#+/)[0].length
          const titleText = line.replace(/^#+\s*/, '')
          PDF.setFontSize(titleSize - (level * 2))
          PDF.setTextColor(0, 0, 0)

          if (level === 1) {
            // 一级标题居中显示
            const titleWidth = PDF.getTextWidth(titleText)
            const titleX = (pageWidth - titleWidth) / 2
            PDF.text(titleText, titleX, y)
          } else {
            // 其他级别标题靠左显示
            PDF.text(titleText, 40, y)
          }

          // 记录标题到大纲
          outlineItems.push({
            title: titleText,
            level,
            page: currentPage,
            y,
          })
          y += PDF.getFontSize() * 1.5
          return
        } else if (!isInCodeBlock) {
          PDF.setFontSize(normalSize)
          PDF.setTextColor(0, 0, 0)
        }

        // 检查是否需要新页
        if (y > 780) {
          PDF.addPage()
          currentPage++
          y = 40
          if (isInCodeBlock) {
            PDF.setFillColor(codeBlockBgColor)
            PDF.rect(30, y - codePadding.top, 535, codePadding.top + 1, 'F')
            y += codePadding.top
            PDF.setFontSize(codeSize)
            PDF.setTextColor(codeTextColor.r, codeTextColor.g, codeTextColor.b)
          }
        }

        // 在处理长文本自动换行之前添加无序列表的处理
        if (line.trim().startsWith('-') && !isInCodeBlock) {
          const listItem = line.trim().substring(1).trim()

          // 检查是否需要新页
          if (y > 780) {
            PDF.addPage()
            currentPage++
            y = 40
          }

          // 绘制实心圆点
          PDF.setFillColor(0, 0, 0)
          PDF.circle(57, y - 6, 2, 'F')

          // 处理列表项中的加粗文本
          if (listItem.includes('**')) {
            const parts = listItem.split(/(\*\*.*?\*\*)/g)
            let xPos = 72

            parts.forEach((part) => {
              if (part.startsWith('**') && part.endsWith('**')) {
                // 加粗文本
                const boldText = part.replace(/^\*\*|\*\*$/g, '')
                PDF.setFont('NotoSans', 'bold')
                const textWidth = PDF.getTextWidth(boldText)
                PDF.text(boldText, xPos, y - 3)
                xPos += textWidth
              } else if (part.trim()) {
                // 普通文本
                PDF.setFont('NotoSans', 'normal')
                const textWidth = PDF.getTextWidth(part)
                PDF.text(part, xPos, y - 3)
                xPos += textWidth
              }
            })

            PDF.setFont('NotoSans', 'normal')
            y += PDF.getFontSize() * 1.5
          } else {
            // 处理普通列表项文本自动换行
            const listLines = PDF.splitTextToSize(listItem, 483)
            listLines.forEach((textLine: string, index: number) => {
              const xPos = index === 0 ? 72 : 72
              PDF.text(textLine, xPos, y - 3)
              y += PDF.getFontSize() * 1.5
            })
          }

          return
        }

        // 处理长文本自动换行
        const textLines = PDF.splitTextToSize(line, isInCodeBlock ? 490 : 520)
        textLines.forEach((textLine: string) => {
          if (isInCodeBlock) {
            const lineHeight = PDF.getFontSize() * codeLineHeight
            PDF.setFillColor(codeBlockBgColor)
            PDF.rect(30, y - (lineHeight * 0.8), 535, lineHeight * 1.8, 'F')

            if (isConfigBlock) {
              if (textLine.startsWith('**') && textLine.endsWith('**')) {
                // 配置文件标题
                const title = textLine.replace(/^\*\*|\*\*$/g, '')
                PDF.setFontSize(titleSize - 4)
                PDF.setTextColor(configColors.title.r, configColors.title.g, configColors.title.b)
                PDF.text(title, 40 + codePadding.left, y - 3)
                PDF.setFontSize(codeSize)
              } else if (textLine.match(/^\d+\.\s+\*\*.+?\*\*.*$/)) {
                // 处理序号加粗标题的情况，如: "1. **服务器**：说明文本"
                const parts = textLine.split(/\*\*/)
                const prefix = parts[0] // "1. "
                const boldText = parts[1] // "服务器"
                const suffix = parts[2] || '' // "：说明文本"

                // 绘制序号和前缀
                PDF.setTextColor(0, 0, 0)
                PDF.setFont('NotoSans', 'normal')
                PDF.text(prefix, 40, y - 3)

                // 计算序号宽度
                const prefixWidth = PDF.getTextWidth(prefix)

                // 绘制加粗文本
                PDF.setFont('NotoSans', 'bold') // 设置为加粗字体
                PDF.text(boldText, 40 + prefixWidth, y - 3)

                // 计算加粗文本宽度
                const boldWidth = PDF.getTextWidth(boldText)

                // 恢复正常字体
                PDF.setFont('NotoSans', 'normal')

                // 绘制后缀文本
                PDF.text(suffix, 40 + prefixWidth + boldWidth, y - 3)
              } else if (textLine.includes(':')) {
                // 计算缩进级别
                const indentLevel = textLine.match(/^\s*/)[0].length / 2
                const indent = indentLevel * 20
                const xPos = 40 + codePadding.left + indent

                const [key, value] = textLine.split(':')
                if (value) {
                  // 键值对
                  PDF.setTextColor(configColors.key.r, configColors.key.g, configColors.key.b)
                  PDF.text(`${key.trim()}:`, xPos, y - 3)

                  const keyWidth = PDF.getTextWidth(`${key.trim()}: `)
                  PDF.setTextColor(configColors.value.r, configColors.value.g, configColors.value.b)
                  PDF.text(value.trim(), xPos + keyWidth, y - 3)
                } else {
                  // 只有键名
                  PDF.setTextColor(configColors.key.r, configColors.key.g, configColors.key.b)
                  PDF.text(`${key.trim()}:`, xPos, y - 3)
                }
              } else {
                // 普通文本行
                PDF.setTextColor(codeTextColor.r, codeTextColor.g, codeTextColor.b)
                PDF.text(textLine, 40 + codePadding.left, y - 3)
              }
            } else {
              // 非配置文件的代码
              PDF.setTextColor(codeTextColor.r, codeTextColor.g, codeTextColor.b)
              PDF.text(textLine, 40 + codePadding.left, y - 3)
            }
            y += lineHeight
          } else {
            // 非代码块的文本
            if (textLine.match(/^.*?\*\*.+?\*\*.*$/)) {
            // if (textLine.match(/^\d+\.\s+\*\*.+?\*\*.*$/)) {
              // 处理序号加粗标题的情况，如: "1. **服务器**：说明文本"
              const parts = textLine.split(/\*\*/)
              const prefix = parts[0] // "1. "
              const boldText = parts[1] // "服务器"
              const suffix = parts[2] || '' // "：说明文本"

              // 绘制序号和前缀
              PDF.setTextColor(0, 0, 0)
              PDF.setFont('NotoSans', 'normal')
              PDF.text(prefix, 40, y - 3)

              // 计算序号宽度
              const prefixWidth = PDF.getTextWidth(prefix)

              // 绘制加粗文本
              PDF.setFont('NotoSans', 'bold') // 设置为加粗字体
              PDF.text(boldText, 40 + prefixWidth, y - 3)

              // 计算加粗文本宽度
              const boldWidth = PDF.getTextWidth(boldText)

              // 恢复正常字体
              PDF.setFont('NotoSans', 'normal')

              // 绘制后缀文本
              PDF.text(suffix, 40 + prefixWidth + boldWidth, y - 3)
            } else {
              // 普通文本
              PDF.setFont('NotoSans', 'normal')
              PDF.text(textLine, 40, y - 3)
            }
            y += (PDF.getFontSize() * 1.5)
          }
        })
      })

      if (isInCodeBlock) {
        PDF.setFillColor(codeBlockBgColor)
        PDF.rect(30, y + 5, 535, 8, 'F') // 下边框
      }

      y += 20
    })

    // 在文档开头添加大纲页
    PDF.insertPage(1)
    y = 40
    PDF.setFontSize(titleSize)
    const tocTitle = '目录'
    const tocTitleWidth = PDF.getTextWidth(tocTitle)
    const tocTitleX = (pageWidth - tocTitleWidth) / 2
    PDF.text(tocTitle, tocTitleX, y)
    y += titleSize + 20

    PDF.setFontSize(normalSize)
    outlineItems.forEach((item) => {
      if (y > 780) {
        PDF.addPage()
        y = 40
      }
      const indent = item.level ? (item.level - 1) * 20 : 0
      const text = `${item.title}`
      PDF.setTextColor(0, 0, 238) // 使用蓝色表示链接
      PDF.textWithLink(text, 40 + indent, y, {
        pageNumber: item.page + 1, // +1 因为插入了目录页
        y: item.y,
      })
      y += normalSize * 1.5
    })

    PDF.save(`${mainTitle || 'exported_document'}.pdf`)
  }

  const processMarkdownForOutline = (content: string) => {
    let isInCodeBlock = false
    return content.split('\n').map((line) => {
      if (line.startsWith('```')) {
        isInCodeBlock = !isInCodeBlock
        return line
      }
      // 在代码块内的行，如果以 # 开头，添加空格防止被解析为标题
      if (isInCodeBlock && line.startsWith('#'))
        return ` ${line}`

      return line
    }).join('\n')
  }

  const processListItems = (line: string) => {
    // 检查是否是无序列表项
    if (line.trim().startsWith('-')) {
      const listItem = line.trim().substring(1).trim()
      // 处理列表项中的加粗文本
      const processedItem = listItem.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // 为 Word 导出添加实心圆点样式
      return `<li style="margin-left: 37pt; margin-bottom: 6pt; list-style-type: disc;">${processedItem}</li>`
    }
    return line
  }

  // 创建一个响应式的消息列表
  const messages = createMemo(() => messageList())

  // 删除消息的函数
  const deleteMessage = (index: number) => {
    console.log(`Deleting message at index: ${index}`)
    setMessageList((prevMessages) => {
      const newMessages = prevMessages.filter((_, i) => i !== index)
      console.log('Updated message list:', newMessages)
      return newMessages
    })
  }

  createEffect(() => {
    console.log('Current message list after update:', messages())
  })

  // 添加一个函数来处理消息内容
  const processMessageContent = (message: ChatMessage) => {
    // 如果是用户消息，将其作为一级标题
    if (message.role === 'user')
      return `# ${message.content}`
    // 如果是助手消息，保持原样
    return message.content
  }

  return (
    <div class="relative">
      {(currentAssistantMessage() || messages().length > 0) && (
        <Outline
          markdown={processMarkdownForOutline(
            messages().map(msg => processMessageContent(msg)).join('\n\n')
            + (currentAssistantMessage() ? `\n\n${currentAssistantMessage()}` : ''),
          )}
          title={messages().length > 0 ? messages()[0].content.split('\n')[0] : '大纲'}
        />
      )}
      <div my-6>
        <SystemRoleSettings
          canEdit={() => messages().length === 0}
          systemRoleEditing={systemRoleEditing}
          setSystemRoleEditing={setSystemRoleEditing}
          currentSystemRoleSettings={currentSystemRoleSettings}
          setCurrentSystemRoleSettings={setCurrentSystemRoleSettings}
          temperatureSetting={temperatureSetting}
        />
        <For each={messages()}>
          {(message, index) => (
            <div key={index()} class="relative flex justify-between">
              <MessageItem
                role={message.role}
                message={message.content}
                showRetry={() => (message.role === 'assistant' && index() === messages().length - 1)}
                onRetry={retryLastFetch}
              />
              <div class="absolute right-0 top-2 z-3">
                <button
                  onClick={() => deleteMessage(index())}
                  class="fcc border b-transparent w-8 h-8 p-2 bg-light-300 dark:bg-dark-300 op-90 cursor-pointer hover:bg-slate/8 rounded-md text-xl transition-colors"
                  title="Delete"
                >
                  <IconDelete />
                </button>
              </div>
            </div>
          )}
        </For>
        {currentAssistantMessage() && (
          <MessageItem
            role="assistant"
            message={currentAssistantMessage}
          />
        )}
        { currentError() && <ErrorMessageItem data={currentError()} onRetry={retryLastFetch} /> }
        <Show
          when={!loading()}
          fallback={(): JSX.Element => (
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
          <button onClick={exportToPDF} class="export-button">
            <img src="/pdf-icon.svg" alt="Export to PDF" class="icon" />
          </button>
        </div>
      </div>
    </div>
  )
}
