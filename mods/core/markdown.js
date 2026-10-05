/**
 * markdown.js: a small, safe markdown renderer.
 *
 *   ModAPI.renderMarkdown(text)      -> HTML string
 *   ModAPI.setMarkdown(element, text) -> renders into element and makes links open in the OS browser
 *
 * Every piece of text is HTML-escaped before any tag is added, and the only tags
 * produced are the ones below, so the output is safe to assign to innerHTML even
 * for untrusted text such as a release body. Links are limited to http, https and
 * mailto. Supported: headings, paragraphs, bold, italic, strikethrough, inline
 * code, fenced code, links, bullet and numbered lists (nested), blockquotes,
 * horizontal rules and simple tables.
 */
(function () {
  'use strict';

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ESC[c]);

  const FENCE_RE = /^\s*(```|~~~)\s*[\w+-]*\s*$/;
  const HEADING_RE = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
  const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
  const QUOTE_RE = /^\s*>/;
  const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+/;
  const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

  const indentOf = (line) => /^\s*/.exec(line)[0].length;

  function inline(raw) {
    const codes = [];
    let text = esc(raw).replace(/`([^`\n]+)`/g, (_m, code) => {
      codes.push(`<code>${code}</code>`);
      return `\u0000${codes.length - 1}\u0000`;
    });

    text = text
      .replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/gi, (_m, label, url) => {
        // Stash the tags like code spans so the emphasis passes below can't mangle URLs containing * _ or ~~.
        codes.push(`<a href="${url}" data-md-link rel="noopener noreferrer">`);
        const open = codes.length - 1;
        codes.push('</a>');
        return `\u0000${open}\u0000${label}\u0000${codes.length - 1}\u0000`;
      })
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<![\w_])__(?=\S)([\s\S]*?\S)__(?![\w_])/g, '<strong>$1</strong>')
      .replace(/(?<![*\w])\*(?![\s*])([^*\n]+?)(?<!\s)\*(?!\*)/g, '<em>$1</em>')
      .replace(/(?<![\w_])_(?![\s_])([^_\n]+?)(?<!\s)_(?![\w_])/g, '<em>$1</em>')
      .replace(/~~(?=\S)([^~\n]*?\S)~~/g, '<del>$1</del>');

    return text.replace(/\u0000(\d+)\u0000/g, (_m, index) => codes[Number(index)]).replace(/ {2,}\n/g, '<br>');
  }

  function splitRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
  }

  // A table is a row with pipes followed by a delimiter row that also has pipes.
  function isTableStart(lines, i) {
    return lines[i].includes('|') && i + 1 < lines.length
      && lines[i + 1].includes('|') && TABLE_SEP_RE.test(lines[i + 1]);
  }

  function startsBlock(lines, i) {
    const line = lines[i];
    return FENCE_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line) || QUOTE_RE.test(line)
      || LIST_RE.test(line) || isTableStart(lines, i);
  }

  function parseList(lines, start) {
    const first = LIST_RE.exec(lines[start]);
    const baseIndent = first[1].length;
    const ordered = /\d/.test(first[2]);
    const items = [];
    let i = start;

    while (i < lines.length) {
      const m = LIST_RE.exec(lines[i]);
      if (!m || m[1].length !== baseIndent || /\d/.test(m[2]) !== ordered) break;
      const body = [lines[i].slice(m[0].length)];
      i++;
      while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) {
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length && indentOf(lines[j]) > baseIndent) { body.push(''); i++; continue; }
          break;
        }
        const indent = indentOf(line);
        if (indent > baseIndent) { body.push(line.slice(Math.min(indent, baseIndent + 2))); i++; continue; }
        // lazy continuation of the item's text
        if (body[body.length - 1].trim() && !startsBlock(lines, i)) { body.push(line.trim()); i++; continue; }
        break;
      }
      items.push(body);
    }

    const tag = ordered ? 'ol' : 'ul';
    const html = items
      .map((body) => `<li>${blocks(body).replace(/^<p>([\s\S]*?)<\/p>/, '$1')}</li>`)
      .join('');
    return { html: `<${tag}>${html}</${tag}>`, next: i };
  }

  function blocks(lines) {
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }

      if (FENCE_RE.test(line)) {
        const fence = FENCE_RE.exec(line)[1];
        const code = [];
        i++;
        while (i < lines.length && lines[i].trim() !== fence) code.push(lines[i++]);
        i++; // closing fence (or end of text)
        out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
        continue;
      }

      const heading = HEADING_RE.exec(line);
      if (heading) {
        const level = heading[1].length;
        out.push(`<h${level} class="md-h${level}">${inline(heading[2])}</h${level}>`);
        i++;
        continue;
      }

      if (HR_RE.test(line)) { out.push('<hr>'); i++; continue; }

      if (QUOTE_RE.test(line)) {
        const inner = [];
        while (i < lines.length && QUOTE_RE.test(lines[i])) inner.push(lines[i++].replace(/^\s*> ?/, ''));
        out.push(`<blockquote>${blocks(inner)}</blockquote>`);
        continue;
      }

      if (isTableStart(lines, i)) {
        const head = splitRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
        out.push(
          '<div class="md-table-wrap"><table><thead><tr>'
          + head.map((cell) => `<th>${inline(cell)}</th>`).join('')
          + '</tr></thead><tbody>'
          + rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')
          + '</tbody></table></div>',
        );
        continue;
      }

      if (LIST_RE.test(line)) {
        const list = parseList(lines, i);
        out.push(list.html);
        i = list.next;
        continue;
      }

      const paragraph = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) paragraph.push(lines[i++]);
      out.push(`<p>${inline(paragraph.join('\n')).replace(/\n/g, ' ')}</p>`);
    }

    return out.join('');
  }

  function renderMarkdown(text) {
    // NUL is the placeholder delimiter in inline(), so it must not appear in the input.
  return blocks(String(text ?? '').replace(/\0/g, '').replace(/\r\n?/g, '\n').split('\n'));
  }

  function openLink(href) {
    if (window.electronAPI?.openExternal) window.electronAPI.openExternal(href).catch(() => {});
    else window.open(href, '_blank', 'noopener');
  }

  function setMarkdown(element, text) {
    element.classList.add('md');
    element.innerHTML = renderMarkdown(text);
    // Links must never navigate the app window itself.
    if (element.dataset.mdLinks) return;
    element.dataset.mdLinks = '1';
    element.addEventListener('click', (event) => {
      const link = event.target.closest?.('a[data-md-link]');
      if (!link) return;
      event.preventDefault();
      openLink(link.getAttribute('href'));
    });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { renderMarkdown };
  if (typeof window !== 'undefined' && window.ModAPI) Object.assign(window.ModAPI, { renderMarkdown, setMarkdown });
})();