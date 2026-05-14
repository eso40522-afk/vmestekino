import { useState } from 'react'
import './PollCreate.css'

interface PollCreateProps {
  onSubmit: (question: string, options: string[], multiSelect: boolean) => void
  onClose: () => void
}

export function PollCreate({ onSubmit, onClose }: PollCreateProps) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [multiSelect, setMultiSelect] = useState(false)

  const handleAddOption = () => {
    if (options.length < 5) {
      setOptions([...options, ''])
    }
  }

  const handleRemoveOption = (index: number) => {
    if (options.length > 2) {
      setOptions(options.filter((_, i) => i !== index))
    }
  }

  const handleOptionChange = (index: number, value: string) => {
    const newOptions = [...options]
    newOptions[index] = value
    setOptions(newOptions)
  }

  const handleSubmit = () => {
    const trimmedQuestion = question.trim()
    const trimmedOptions = options.map(o => o.trim()).filter(o => o.length > 0)
    
    if (!trimmedQuestion) return
    if (trimmedOptions.length < 2) return

    onSubmit(trimmedQuestion, trimmedOptions, multiSelect)
  }

  const isValid = question.trim().length > 0 && options.filter(o => o.trim().length > 0).length >= 2

  return (
    <div className="pollCreate pollCreate--enter">
      <div className="pollCreate__header">
        <h2 className="pollCreate__title">📊 Создание опроса</h2>
        <button type="button" className="pollCreate__closeBtn" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div className="pollCreate__body">
        <div className="pollCreate__field">
          <label className="pollCreate__label">Вопрос</label>
          <input
            type="text"
            className="pollCreate__input"
            placeholder="Какой вопрос вы хотите задать?"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            maxLength={300}
          />
          <span className="pollCreate__counter">{question.length} / 300</span>
        </div>

        <div className="pollCreate__field">
          <label className="pollCreate__label">Ответы</label>
          {options.map((opt, i) => (
            <div key={i} className="pollCreate__optionRow">
              <span className="pollCreate__optionEmoji">😀</span>
              <input
                type="text"
                className="pollCreate__optionInput"
                placeholder="Введите ответ"
                value={opt}
                onChange={e => handleOptionChange(i, e.target.value)}
                maxLength={100}
              />
              {options.length > 2 && (
                <button type="button" className="pollCreate__optionRemove" onClick={() => handleRemoveOption(i)} title="Удалить">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>
              )}
            </div>
          ))}
          {options.length < 5 && (
            <button type="button" className="pollCreate__addOption" onClick={handleAddOption}>
              + Добавить ещё один ответ
            </button>
          )}
        </div>

        <label className="pollCreate__multiSelect">
          <input
            type="checkbox"
            checked={multiSelect}
            onChange={e => setMultiSelect(e.target.checked)}
          />
          <span>Разрешить несколько ответов</span>
        </label>

        <button
          type="button"
          className="pollCreate__submit"
          onClick={handleSubmit}
          disabled={!isValid}
        >
          Публикация
        </button>
      </div>
    </div>
  )
}
