import { isValidElement, type ReactNode } from 'react';

import { useLocale, type Locale } from './locale';

/*
 * Which writing system a piece of text is in, so the Text atom can pick a font that
 * has the glyphs (Inter has no Devanagari) and a line height that does not clip matras.
 */
export type Script = 'latin' | 'devanagari';

const DEVANAGARI = /[ऀ-ॿ꣠-ꣿ]/;

export function containsDevanagari(text: string): boolean {
  return DEVANAGARI.test(text);
}

// Plain text children, flattened; null when the children include elements we cannot read.
function plainText(content: ReactNode): string | null {
  if (content === null || content === undefined || typeof content === 'boolean') return '';
  if (typeof content === 'string' || typeof content === 'number' || typeof content === 'bigint') {
    return String(content);
  }
  if (Array.isArray(content)) {
    let joined = '';
    for (const part of content) {
      const text = plainText(part as ReactNode);
      if (text === null) return null;
      joined += text;
    }
    return joined;
  }
  if (isValidElement(content)) return null;
  return null;
}

// Readable text decides by its characters; nested elements fall back to the active locale.
export function scriptOf(content: ReactNode, locale: Locale): Script {
  const text = plainText(content);
  if (text === null) return locale === 'hi' ? 'devanagari' : 'latin';
  return containsDevanagari(text) ? 'devanagari' : 'latin';
}

// The script for some content under the active locale.
export function useScriptOf(content: ReactNode): Script {
  return scriptOf(content, useLocale());
}
