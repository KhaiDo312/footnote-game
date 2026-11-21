/**
 * /new: the host uploads a .txt/.md file or pastes text, then creates a room.
 * The file is read in the browser and sent as text; nothing is stored as a file.
 */

import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Input, Label, Textarea } from '@/components/ui'
import { MAX_SOURCE_CHARS, MIN_SOURCE_CHARS } from '@/game/config'
import { callAction } from '@/lib/call-action'

const ACCEPTED = /\.(txt|md|markdown)$/i

export default function NewGamePage() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!ACCEPTED.test(file.name)) {
      setError('Please choose a .txt or .md file.')
      return
    }
    setError('')
    setText(await file.text())
    if (!title) setTitle(file.name.replace(ACCEPTED, ''))
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    const result = await callAction<{ roomId: string }>('createRoom', { title, text })
    if (result.success) {
      navigate(`/room/${result.data.roomId}`)
    } else {
      setError(result.error)
      setSubmitting(false)
    }
  }

  const length = text.trim().length
  const tooShort = length < MIN_SOURCE_CHARS
  const tooLong = length > MAX_SOURCE_CHARS

  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-foreground">
      <h1 className="mb-2 text-3xl font-bold tracking-tight">Host a new game</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Questions are written from your document. Players score more for correct answers nobody else thought of.
      </p>

      <form onSubmit={onSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="file">Upload a .txt or .md file</Label>
          <Input id="file" type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={onFile} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="text">…or paste text</Label>
          <Textarea
            id="text"
            data-testid="source-text"
            rows={12}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste an article, chapter, or notes here."
          />
          <p className={`text-xs ${tooLong ? 'text-destructive' : 'text-muted-foreground'}`}>
            {length.toLocaleString('en-US')} / {MAX_SOURCE_CHARS.toLocaleString('en-US')} characters
            {tooShort && length > 0 && ` (at least ${MIN_SOURCE_CHARS} needed)`}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="title">Game title</Label>
          <Input id="title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" disabled={submitting || tooShort || tooLong} data-testid="create-room">
          {submitting ? 'Creating…' : 'Create game'}
        </Button>
      </form>
    </div>
  )
}
