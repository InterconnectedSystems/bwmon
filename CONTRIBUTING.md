# Contributing to bwmon

Patches, bug reports, and "tested on …" PRs all welcome. The project is small
on purpose — a few collector scripts, one PHP/JS web app, one installer. If a
change adds a build step or a runtime dependency it'll be a hard sell.

## Reporting bugs

Open an issue with:

- OS + kernel version (`uname -a`, `lsb_release -d`).
- PHP version (`php -v`) and nginx version (`nginx -v`).
- Output of `systemctl status bwprocs@<iface>.service` and the last 50 lines
  of `journalctl -u bwprocs@<iface>.service`.
- Steps to reproduce, and what you saw vs. what you expected.

Redact IPs / hostnames as appropriate.

## Local development

There's no build pipeline. Editing files in place and reloading the browser
is the loop.

Quick syntax checks before pushing:

```bash
bash -n setup.sh uninstall.sh
node --check web/bwmon.js
for f in web/index.php web/api/*.php; do php -l "$f"; done
python3 -m py_compile bin/bwcollect bin/bwprocs bin/bwhistory bin/bwmon bin/bwweekly bin/bwmonthly
```

If you change `setup.sh`, run it on a throwaway VM (a Debian or Ubuntu LXC
container is enough) and confirm the dashboard comes up at `http://<host>:8080/`.

## Code style

- **Bash:** `set -euo pipefail`; quote variables; prefer `[ ]` over `[[ ]]` for
  portability; no functions over ~25 lines without a comment explaining *why*.
- **Python:** stdlib only. The point of `bwcollect` and friends is that they
  drop into any host with Python 3.9+ and nothing else.
- **PHP:** stdlib only. No frameworks. Strict input validation on every
  query parameter (look at the existing `preg_match('/^[a-z][a-z0-9]{1,14}$/i', $iface)`
  pattern — copy it).
- **JS:** vanilla ES2020+. The one runtime dep is Plotly, vendored. No build.
- **Comments:** explain *why*, not *what*. Don't restate the line above.

## Pull request checklist

- [ ] Syntax-check commands above all pass.
- [ ] `setup.sh` still installs cleanly on a fresh Debian/Ubuntu VM.
- [ ] `CHANGELOG.md` has a one-line entry under `[Unreleased]`.
- [ ] If you added a CLI flag or env var, the README's options table is updated.
- [ ] No new runtime dependency unless it's already on a default Debian install.

## Security

Don't open a public issue for security reports. Email the address in `LICENSE`
or open a private security advisory on the repository.
