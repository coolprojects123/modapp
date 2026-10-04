// Release-note helpers for the updater (main process).
//
// electron-updater's GitHub provider hands back release notes as rendered HTML
// (from the releases atom feed). The renderer wants markdown, so we fetch the raw
// release body from the GitHub API and fall back to converting the HTML.
const fs = require('fs');
const path = require('path');

const FALLBACK_REPO = 'coolprojects123/modapp';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

const stripTags = (html) => html.replace(/<[^>]+>/g, '');

function htmlToMarkdown(html) {
  const text = String(html)
    .replace(/\r/g, '')
    .replace(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_m, code) => `\n\`\`\`\n${stripTags(code)}\n\`\`\`\n`)
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => `[${stripTags(label)}](${href})`)
    .replace(/<(strong|b)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi, '**$3**')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, label) => `\n${'#'.repeat(Number(level))} ${stripTags(label).trim()}\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, item) => `\n- ${stripTags(item).trim()}`)
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|ul|ol|div)>/gi, '\n\n');
  return decodeEntities(stripTags(text))
    .replace(/^(- [^\n]*)\n{2,}(?=- )/gm, '$1\n') // keep list items together
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// electron-updater gives a string, or an array of { version, note }.
function normalizeNotes(notes) {
  const raw = typeof notes === 'string'
    ? notes
    : Array.isArray(notes) ? notes.map((entry) => entry?.note || '').join('\n\n') : '';
  return /<\/?[a-z][a-z0-9]*[\s>/]/i.test(raw) ? htmlToMarkdown(raw) : raw.trim();
}

// "owner/repo" from the app-update.yml electron-builder bakes into the package.
function repoFromConfig(resourcesPath, fallback = FALLBACK_REPO) {
  try {
    const text = fs.readFileSync(path.join(resourcesPath, 'app-update.yml'), 'utf8');
    const read = (key) => new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(text)?.[1].trim().replace(/^['"]|['"]$/g, '');
    const owner = read('owner');
    const repo = read('repo');
    if (owner && repo) return `${owner}/${repo}`;
  } catch { /* not packaged, or no config: use the fallback */ }
  return fallback;
}

// The release's raw markdown body, or null if it can't be fetched.
async function fetchReleaseBody({ repo, version, fetchImpl = fetch, timeoutMs = 8000 }) {
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases/tags/v${version}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'modapp-updater' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const release = await response.json();
    if (typeof release?.body !== 'string' || !release.body.trim()) return null;
    return {
      body: release.body.replace(/\r\n/g, '\n').trim(),
      url: typeof release.html_url === 'string' ? release.html_url : null,
      name: typeof release.name === 'string' ? release.name : null,
    };
  } catch {
    return null;
  }
}

module.exports = { htmlToMarkdown, normalizeNotes, repoFromConfig, fetchReleaseBody, FALLBACK_REPO };   