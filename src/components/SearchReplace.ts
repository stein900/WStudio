import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface SearchMatch {
  from: number
  to: number
}

export interface SearchState {
  query: string
  matches: SearchMatch[]
  active: number
}

export const searchKey = new PluginKey<SearchState>('searchReplace')

/** Recherche texte simple (insensible à la casse), sans franchir les nœuds. */
function findMatches(doc: PMNode, query: string): SearchMatch[] {
  if (!query) return []
  const out: SearchMatch[] = []
  const q = query.toLowerCase()
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const text = node.text.toLowerCase()
    let i = 0
    for (;;) {
      const idx = text.indexOf(q, i)
      if (idx === -1) break
      out.push({ from: pos + idx, to: pos + idx + q.length })
      i = idx + q.length
    }
  })
  return out
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    searchReplace: {
      setSearch: (query: string) => ReturnType
      clearSearch: () => ReturnType
      findNext: (direction?: 1 | -1) => ReturnType
      replaceCurrent: (replacement: string) => ReturnType
      replaceAll: (replacement: string) => ReturnType
    }
  }
}

export const SearchReplace = Extension.create({
  name: 'searchReplace',

  addCommands() {
    return {
      setSearch:
        (query) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(searchKey, { type: 'set', query }))
          return true
        },
      clearSearch:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(searchKey, { type: 'set', query: '' }))
          return true
        },
      findNext:
        (direction = 1) =>
        ({ state, tr, dispatch }) => {
          const s = searchKey.getState(state)
          if (!s || s.matches.length === 0) return false
          const from = state.selection.from
          let index: number
          if (direction === 1) {
            index = s.matches.findIndex((m) => m.from > from)
            if (index === -1) index = 0 // reboucler au début
          } else {
            index = s.matches.length - 1
            for (let i = s.matches.length - 1; i >= 0; i--) {
              if (s.matches[i].from < from) {
                index = i
                break
              }
              if (i === 0) index = s.matches.length - 1 // reboucler à la fin
            }
          }
          const m = s.matches[index]
          if (dispatch) {
            dispatch(
              tr
                .setSelection(TextSelection.create(tr.doc, m.from, m.to))
                .setMeta(searchKey, { type: 'active', index })
                .scrollIntoView()
            )
          }
          return true
        },
      replaceCurrent:
        (replacement) =>
        ({ state, tr, dispatch }) => {
          const s = searchKey.getState(state)
          if (!s) return false
          const sel = state.selection
          const current = s.matches.find((m) => m.from === sel.from && m.to === sel.to)
          if (!current) return false
          if (dispatch) dispatch(tr.insertText(replacement, current.from, current.to).scrollIntoView())
          return true
        },
      replaceAll:
        (replacement) =>
        ({ state, tr, dispatch }) => {
          const s = searchKey.getState(state)
          if (!s || s.matches.length === 0) return false
          if (dispatch) {
            // de la fin vers le début : les positions précédentes restent valides
            for (let i = s.matches.length - 1; i >= 0; i--) {
              tr.insertText(replacement, s.matches[i].from, s.matches[i].to)
            }
            dispatch(tr)
          }
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => ({ query: '', matches: [], active: -1 }),
          apply(tr, old) {
            const meta = tr.getMeta(searchKey) as
              | { type: 'set'; query: string }
              | { type: 'active'; index: number }
              | undefined
            if (meta?.type === 'set') {
              return { query: meta.query, matches: findMatches(tr.doc, meta.query), active: -1 }
            }
            if (meta?.type === 'active') return { ...old, active: meta.index }
            if (tr.docChanged && old.query) {
              return { ...old, matches: findMatches(tr.doc, old.query), active: -1 }
            }
            return old
          },
        },
        props: {
          decorations(state) {
            const s = searchKey.getState(state)
            if (!s || s.matches.length === 0) return DecorationSet.empty
            return DecorationSet.create(
              state.doc,
              s.matches.map((m, i) =>
                Decoration.inline(m.from, m.to, {
                  class: i === s.active ? 'search-hit search-hit-active' : 'search-hit',
                })
              )
            )
          },
        },
      }),
    ]
  },
})
