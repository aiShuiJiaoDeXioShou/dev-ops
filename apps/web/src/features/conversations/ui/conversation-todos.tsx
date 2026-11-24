import type { ApiSuccessData } from '@dev-ops/api-client'

type Todos = ApiSuccessData<'/api/v1/bot-conversations/{conversationId}', 'get'>['todos']
const labels = { pending: '待完成', in_progress: '进行中', completed: '已完成' }

/** 展示模型维护的会话待办；清单由服务端保存，成员仅查看。 */
export function ConversationTodos({ items = [] }: { items?: Todos }) {
  if (!items.length) return null
  return (
    <section className="dsh-readonly-note" aria-label="工作待办" aria-live="polite">
      <strong>
        工作待办 · {items.filter(({ status }) => status === 'completed').length}/{items.length}
      </strong>
      <ul>
        {items.map((item, index) => (
          <li key={index}>
            <span>{labels[item.status]} · </span>
            {item.status === 'completed' ? <s>{item.text}</s> : item.text}
          </li>
        ))}
      </ul>
    </section>
  )
}
