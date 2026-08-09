import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { openSearchPanel } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { useEffect, useRef } from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
  /** Thème sombre de l'application (bascule le thème CodeMirror). */
  dark?: boolean
}

// Panneau de recherche CodeMirror en français
const frenchPhrases = EditorState.phrases.of({
  Find: 'Rechercher',
  Replace: 'Remplacer',
  next: 'suivant',
  previous: 'précédent',
  all: 'tout',
  'match case': 'casse',
  'by word': 'mot entier',
  regexp: 'regex',
  replace: 'remplacer',
  'replace all': 'tout remplacer',
  close: 'fermer',
  'Go to line': 'Aller à la ligne',
  go: 'aller',
})

const extensions = [
  markdown(),
  EditorView.lineWrapping,
  frenchPhrases,
  // Ctrl+H ouvre le même panneau (champ Remplacer inclus)
  keymap.of([{ key: 'Mod-h', run: openSearchPanel, preventDefault: true }]),
]

export function MarkdownEditor({ value, onChange, dark }: Props) {
  const viewRef = useRef<EditorView | null>(null)

  // Ctrl+F / Ctrl+H même quand le focus est hors de l'éditeur
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && ['f', 'F', 'h', 'H'].includes(e.key)) {
        const view = viewRef.current
        if (!view) return
        e.preventDefault()
        view.focus()
        openSearchPanel(view)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      height="100%"
      theme={dark ? 'dark' : 'light'}
      className="md-editor"
      onCreateEditor={(view) => {
        viewRef.current = view
      }}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: true,
        highlightSelectionMatches: false,
      }}
    />
  )
}
