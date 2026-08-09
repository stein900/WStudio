import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { openSearchPanel } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { useEffect, useMemo, useRef } from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
  /** Thème sombre de l'application (bascule le thème CodeMirror). */
  dark?: boolean
  /** Vue CodeMirror exposée au parent (sélection, application de diffs IA). */
  viewRef?: React.MutableRefObject<EditorView | null>
  /** Notifie la longueur de la sélection courante (assistant IA). */
  onSelectionChange?: (chars: number) => void
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

const baseExtensions = [
  markdown(),
  EditorView.lineWrapping,
  frenchPhrases,
  // Ctrl+H ouvre le même panneau (champ Remplacer inclus)
  keymap.of([{ key: 'Mod-h', run: openSearchPanel, preventDefault: true }]),
]

export function MarkdownEditor({ value, onChange, dark, viewRef, onSelectionChange }: Props) {
  const innerViewRef = useRef<EditorView | null>(null)

  // Callback vivant derrière une extension stable (pas de reconfiguration)
  const selectionCbRef = useRef(onSelectionChange)
  selectionCbRef.current = onSelectionChange

  const extensions = useMemo(
    () => [
      ...baseExtensions,
      EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) {
          const { from, to } = update.state.selection.main
          selectionCbRef.current?.(to - from)
        }
      }),
    ],
    []
  )

  // Ctrl+F / Ctrl+H même quand le focus est hors de l'éditeur
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && ['f', 'F', 'h', 'H'].includes(e.key)) {
        const view = innerViewRef.current
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
        innerViewRef.current = view
        if (viewRef) viewRef.current = view
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
