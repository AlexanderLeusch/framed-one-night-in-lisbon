# Security

How we protect *Framed: One Night in Lisbon*: what is worth protecting, what could go wrong, what we did about it, and
which risks we accept on purpose. The starting point was read from GitHub by the repository admin on 20 November 2026;
the changes below were made on 23 November 2026 and read back from GitHub the same day.

## What we protect

| Asset | Why it matters |
|---|---|
| The live game on GitHub Pages | Whatever lands on `main` is published automatically. A bad change reaches every player. |
| The online leaderboard (Supabase) | Player accounts, driver names and times. It should show real runs by real players. |
| Players' browsers | The game runs in them. It must not run foreign code or leak a player's login. |
| The repository | Its history is our graded work and the source of everything above. |

## Repository and deployment

### Where we started (20 November 2026)

- `main` had **no branch protection and no ruleset**: anyone with write access could push to it directly, force-push,
  delete it, or merge without a review or green checks.
- Our team rule already said that a second member reviews every pull request (`AGENTS.md`, rule 2), but nothing
  enforced it; `docs/course-guides.md` marks it ❌.
- The only thing that kept a broken change from going live was CI: the deploy job runs only when all test jobs pass.

### What we changed

**Ruleset on `main`, phase 1 (switched on on 23 November 2026, the day of the deadline).** Chosen so it protects `main`
without blocking the team in the last hours before submission:

| Setting | What it prevents |
|---|---|
| Require a pull request before merging, 0 approvals | Changes reach `main` only through a pull request, never by a direct push. |
| Require review from Code Owners | A pull request touching `.github/` or `supabase/` needs the approval of Alex or his backup, Marco (see `.github/CODEOWNERS`). These two folders decide what gets published and who may write to the database. |
| Dismiss stale approvals; require approval of the most recent push | Nobody can get an approval and then add another change before merging. |
| Require status checks: `test`, `browser (chase-drive)`, `browser (chase-pages)`, `browser (escape)`, `original-solo-project` | Nothing is merged unless every test passes, not only before the deploy. |
| Block force pushes; restrict deletions | The history of `main` cannot be rewritten or deleted. |
| Bypass: repository admin only | Alex can still merge in an emergency. We accept this and keep it to one person. |

**Phase 2 (after the deadline).** Every pull request needs one approval: the `*` line in `.github/CODEOWNERS` is
switched on, with Alex as owner and Marco as backup, because GitHub does not let anyone approve their own pull request:
Marco reviews Alex's changes, Alex reviews everyone else's.

**Access.** One admin (Alex); the other four members have write access. Only an admin can change or switch off the
ruleset, so we keep a single admin. Every member is asked to keep two-factor authentication on, so a stolen password
alone cannot get around these rules; on a personal repository GitHub cannot enforce or show this, so it is a team rule.

**Already in place:**

- Secret scanning and push protection are on, and `tests/project/page.test.js` fails if a key or token appears in any file.
- The workflow token is read-only by default (`contents: read`); only the deploy job may write to Pages, and Actions
  cannot approve pull requests.
- Every action in `.github/workflows/ci.yml` is pinned to a full commit hash, so a moved tag cannot change what runs.
- The `github-pages` environment has a branch policy, and the deploy job runs only on `main`.
- Dependabot alerts are on; `.github/dependabot.yml` also opens update pull requests for the pinned actions and the
  Python project, and Dependabot security updates are on.

## The code

| Risk | Measure |
|---|---|
| A player writes someone else's runs or changes the board | Row Level Security and column grants in `supabase/schema.sql`: everyone may read; a signed-in player may only add their own name and runs; no one may change or delete a run; the database adds up heist totals itself. `supabase/rule-check.sql` tests every rule against two made-up accounts. |
| Secret keys in the page | The page holds only Supabase's publishable key, which is meant to be public. The rules above decide what it may do. |
| Injected scripts | A Content Security Policy on every page: scripts only from this site and the exact three.js folders on two CDNs, no inline scripts, no plugins, no forms, network calls only to Supabase (and the Openverse sound API in room 1). |
| A CDN serves a changed library | Exact versions plus Subresource Integrity hashes; the browser refuses a file that differs. `npm run test:sri` re-checks them. |
| Tampered saved data | Everything read back from `localStorage` is checked and replaced by defaults when invalid, including picks like `__proto__`. |
| Outside data shown as HTML | Text from Supabase and the Openverse API is inserted as text or escaped; driver names refuse `< > " & / \` and control characters. |
| The two game frames trick each other | `postMessage` messages are accepted only from the game's own origin. |
| The local dev server leaks files | It serves only known file types inside the project: no hidden files, no `../`, GET and HEAD only. |
| Vulnerable Python packages | `uv.lock` pins every package; CI runs `pip-audit` and a known vulnerability stops the deploy. |

## Known risks we accept

| Risk | Why we accept it (for now) |
|---|---|
| **Leaderboard times come from the player's browser.** Someone with technical skill can send a time between the database's limits (10 s for a drive, 1 s for an escape) without playing, or edit the escape time kept in the browser. | Proving a run is real needs a game server that replays it, which is out of scope. Raising the minimum times to what a real run can reach would close the easiest cheat. |
| One person can create many anonymous accounts. The 10-second limit applies per account. | Joining with a name only, without an email, is a feature we want. Supabase's sign-up rate limits apply; CAPTCHA can be switched on in the Supabase dashboard if spam appears. |
| Look-alike driver names. | Names are unique without case. The page allows only letters, digits and `. _ ' -`, but letters from other alphabets (a Cyrillic "А" next to a Latin "A") pass, and a request sent around the page is checked only by the database's rule. Allowing only Latin letters there would fix it. |
| The page cannot forbid being shown inside another site's frame. | GitHub Pages does not let us send that header. A framing site could at most trick a player into clicking a game button; it cannot read the player's login or data. |
| Players cannot delete their account themselves. | On request, the admin deletes the account in the Supabase dashboard; the database removes its name and runs with it (`on delete cascade`). |
| three.js 0.128.0 (2021) is old. | It has no known vulnerabilities (npm audit, 4 November 2026). Dependabot cannot see CDN files, so we check it by hand. |

## Reporting a problem

Please do not open a public issue for a security problem. Use GitHub's **Report a vulnerability** button on the
repository's Security tab (private vulnerability reporting is switched on), or contact a team member directly.
