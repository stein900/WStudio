// Élément <webview> d'Electron dans le JSX React.
import type * as React from 'react'

type WebviewProps = React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
  src?: string
  partition?: string
  allowpopups?: string
  webpreferences?: string
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: WebviewProps
    }
  }
}

declare module 'react/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements {
      webview: WebviewProps
    }
  }
}
