import { For, createEffect, createSignal } from 'solid-js'

interface OutlineItem {
  level: number
  text: string
  id: string
}

interface OutlineProps {
  markdown: string
}

export const Outline = (props: OutlineProps) => {
  const [outline, setOutline] = createSignal<OutlineItem[]>([])

  createEffect(() => {
    // 解析markdown文本，提取标题
    const headers = props.markdown.split('\n')
      .filter(line => line.startsWith('#'))
      .map((line) => {
        const level = line.match(/^#+/)[0].length
        const text = line.replace(/^#+\s+/, '')
        const id = text.toLowerCase().replace(/\s+/g, '-')
        return { level, text, id }
      })
    setOutline(headers)
  })

  return (
    <div class="fixed top-4 right-4 w-64 bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg overflow-y-auto max-h-[80vh]">
      <h3 class="text-lg font-bold mb-2 dark:text-white">大纲</h3>
      <ul class="space-y-2">
        <For each={outline()}>
          {item => (
            <li
              style={{ 'padding-left': `${(item.level - 1) * 12}px` }}
              class="text-sm hover:text-blue-500 cursor-pointer"
            >
              <a
                href={`#${item.id}`}
                class="text-gray-700 dark:text-gray-300 hover:text-blue-500"
              >
                {item.text}
              </a>
            </li>
          )}
        </For>
      </ul>
    </div>
  )
}
