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
  const [isOpen, setIsOpen] = createSignal(true)

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
    <div class="fixed top-4 right-4 z-10">
      <div
        class="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-y-auto max-h-[80vh] transition-all relative"
        classList={{
          'w-64 p-4 opacity-100': isOpen(),
          'w-0 p-0 opacity-0 invisible': !isOpen(),
        }}
      >
        <h3 class="text-lg font-bold mb-2 pr-8 dark:text-white whitespace-nowrap">大纲</h3>
        <ul class="space-y-2">
          <For each={outline()}>
            {item => (
              <li
                style={{ 'padding-left': `${(item.level - 1) * 12}px` }}
                class="text-sm hover:text-blue-500 cursor-pointer whitespace-nowrap"
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

      <button
        class="absolute right-2 top-2 p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
        classList={{
          'bg-white dark:bg-gray-800 shadow-lg': !isOpen(),
        }}
        onClick={() => setIsOpen(!isOpen())}
      >
        <div class={isOpen() ? 'i-carbon-chevron-right' : 'i-carbon-chevron-left'} />
      </button>
    </div>
  )
}
