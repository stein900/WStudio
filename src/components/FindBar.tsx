import { useEffect, useRef, useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { searchKey } from './SearchReplace'
import { Icon } from './Icons'

interface Props {
  editor: Editor
  withReplace: boolean
  onClose: () => void
}

/** Barre Rechercher / Remplacer flottante du mode Document (Ctrl+F / Ctrl+H). */
export function FindBar({ editor, withReplace, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [withReplace])

  const info = useEditorState({
    editor,
    selector: ({ editor }: { editor: Editor | null }) => {
      if (!editor) return { count: 0, active: -1 }
      const s = searchKey.getState(editor.state)
      return s ? { count: s.matches.length, active: s.active } : { count: 0, active: -1 }
    },
  })

  // ProseMirror ne fait pas toujours défiler la sélection posée depuis un
  // bouton externe : défilement explicite vers l'occurrence active.
  const scrollToActive = () => {
    setTimeout(() => {
      document
        .querySelector('.doc-editor-content .search-hit-active')
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 30)
  }

  const goTo = (direction: 1 | -1) => {
    editor.commands.findNext(direction)
    scrollToActive()
  }

  const search = (q: string) => {
    setQuery(q)
    editor.commands.setSearch(q)
    if (q) {
      editor.commands.findNext(1)
      scrollToActive()
    }
  }

  const close = () => {
    editor.commands.clearSearch()
    onClose()
  }

  return (
    <div className="find-bar" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="find-row">
        <Icon name="search" size={14} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Rechercher…"
          onChange={(e) => search(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') goTo(e.shiftKey ? -1 : 1)
          }}
        />
        <span className="find-count">
          {query ? (info.count ? `${info.active + 1 || 1}/${info.count}` : '0') : ''}
        </span>
        <button
          className="tb-btn"
          title="Précédent (Maj+Entrée)"
          disabled={!info.count}
          onClick={() => goTo(-1)}
        >
          <Icon name="chevron-up" size={14} />
        </button>
        <button
          className="tb-btn"
          title="Suivant (Entrée)"
          disabled={!info.count}
          onClick={() => goTo(1)}
        >
          <Icon name="chevron-down" size={14} />
        </button>
        <button className="tb-btn" title="Fermer (Échap)" onClick={close}>
          <Icon name="x" size={14} />
        </button>
      </div>
      {withReplace && (
        <div className="find-row">
          <Icon name="replace" size={14} />
          <input
            type="text"
            value={replacement}
            placeholder="Remplacer par…"
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                editor.commands.replaceCurrent(replacement)
                goTo(1)
              }
            }}
          />
          <button
            className="btn-small"
            disabled={!info.count}
            onClick={() => {
              editor.commands.replaceCurrent(replacement)
              goTo(1)
            }}
          >
            Remplacer
          </button>
          <button
            className="btn-small"
            disabled={!info.count}
            onClick={() => editor.commands.replaceAll(replacement)}
          >
            Tout ({info.count})
          </button>
        </div>
      )}
    </div>
  )
}
