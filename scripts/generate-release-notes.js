const { execFileSync } = require('child_process');
const fs = require('fs');

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function commitRange() {
  try {
    const previous = git('describe', '--tags', '--abbrev=0', 'HEAD^');
    return `${previous}..HEAD`;
  } catch {
    return 'HEAD';
  }
}

const range = commitRange();
const log = git('log', range, '--pretty=format:%s|%h');
const groups = {
  'Features': [],
  'Fixes': [],
  'Performance': [],
  'Documentation': [],
  'Other': [],
};

for (const line of log ? log.split('\n') : []) {
  const separator = line.lastIndexOf('|');
  const subject = line.slice(0, separator);
  const hash = line.slice(separator + 1);
  const match = subject.match(/^(feat|fix|perf|docs)(?:\(.+\))?!?:\s*(.+)$/i);
  const type = match ? match[1].toLowerCase() : 'other';
  const text = match ? match[2] : subject;
  const group = type === 'feat' ? 'Features' : type === 'fix' ? 'Fixes' : type === 'perf' ? 'Performance' : type === 'docs' ? 'Documentation' : 'Other';
  groups[group].push(`- ${text} ([${hash}](https://github.com/${process.env.GITHUB_REPOSITORY || 'modapp/modapp'}/commit/${hash}))`);
}

const version = process.env.RELEASE_VERSION || git('describe', '--tags', '--always');
let output = `## ${version}\n\n`;
for (const [title, entries] of Object.entries(groups)) {
  if (entries.length) output += `### ${title}\n${entries.join('\n')}\n\n`;
}
output += '## Verification\n\n- Built by the GitHub Actions release workflow.\n- Linux packages: `.deb` and `.rpm`.\n';
fs.writeFileSync('release-notes.md', output);
console.log(output);
