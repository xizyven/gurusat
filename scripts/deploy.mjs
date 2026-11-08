// Build the site and publish dist/ to the gh-pages branch (GitHub Pages serves that branch).
// Usage: npm run deploy
import { execSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const run = (cmd, cwd) => execSync(cmd, { stdio: 'inherit', cwd });
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

const remote = out('git remote get-url origin');
const name = out('git config user.name');
const email = out('git config user.email');
const rev = out('git rev-parse --short HEAD');

run('npm run build');
const dist = join(process.cwd(), 'dist');
writeFileSync(join(dist, '.nojekyll'), '');
rmSync(join(dist, '.git'), { recursive: true, force: true });

run('git init -q -b gh-pages', dist);
run(`git config user.name "${name}"`, dist);
run(`git config user.email "${email}"`, dist);
run('git add -A', dist);
run(`git commit -q -m "Deploy ${rev}"`, dist);
run(`git push -f "${remote}" gh-pages`, dist);
rmSync(join(dist, '.git'), { recursive: true, force: true });
console.log('\n✓ Deployed. GitHub Pages updates in about a minute.');
