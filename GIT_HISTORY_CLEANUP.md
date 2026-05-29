# Git History Secret Cleanup — Optional but Recommended

**Status:** ⚠️ DISRUPTIVE — read entire document before running

**What this does:** Permanently removes leaked secrets from every commit in git history.

**What this breaks:** Every clone/fork of the repository must re-clone. Commit SHAs change.

---

## Prerequisites — DO FIRST

### 1. ✅ Rotate ALL secrets FIRST

See `FIREBASE_KEY_ROTATION.md`. Even after history cleanup, the secrets exist in:
- Cached forks on GitHub
- Local clones on contributor machines
- GitHub PR archives
- Wayback Machine / GitHub search cache

**The rotation in active services is what actually protects you.** History cleanup is cosmetic / passes future Gitleaks scans.

### 2. ✅ Communicate with the team

If anyone has the repo cloned, they MUST:
- Push any uncommitted work
- Wait for the rewrite
- Re-clone the repo after rewrite
- They CANNOT just `git pull` — the histories diverge

### 3. ✅ Backup the repo

```powershell
cd C:\Users\user\Downloads
Copy-Item -Recurse sosphere-platform sosphere-platform-backup-2026-05-29
```

---

## The Cleanup — git-filter-repo

`git filter-repo` is the modern tool. Install:

```powershell
pip install git-filter-repo
```

### Step 1 — Create the secrets file

Create `secrets-to-remove.txt` in the repo root:

```
AIzaSy[REDACTED-OLD-ANDROID-KEY]==>***REDACTED-FIREBASE-KEY***
```

(Add one line per known secret string. Format: `actual==>replacement`.)

### Step 2 — Run the rewrite

```powershell
cd C:\Users\user\Downloads\sosphere-platform
git filter-repo --replace-text secrets-to-remove.txt --force
```

This rewrites every commit. Takes 5-30 minutes depending on history size.

### Step 3 — Force-push to GitHub

```powershell
git push origin --force --all
git push origin --force --tags
```

**WARNING:** This destroys the remote history. Anyone with a fork/clone gets diverged.

---

## Alternative: BFG Repo-Cleaner

Simpler but Java-required:

```powershell
# Download from https://rtyley.github.io/bfg-repo-cleaner/
java -jar bfg.jar --replace-text secrets-to-remove.txt sosphere-platform.git
cd sosphere-platform
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git push --force
```

---

## Verifying the cleanup

After the rewrite:

```powershell
# Should return ZERO results
git log --all -p | Select-String "AIzaSy[REDACTED-OLD-ANDROID-KEY]"
```

Then run gitleaks locally:

```powershell
# Install gitleaks (https://github.com/gitleaks/gitleaks)
gitleaks detect --source=. --redact
```

Should report 0 leaks.

---

## After cleanup checklist

- [ ] Re-clone the repo to verify it works
- [ ] Update any internal docs that reference old commit SHAs
- [ ] Notify all contributors to re-clone
- [ ] Run CI to verify build still works
- [ ] Check Vercel deployment (it will see the new tree)

---

## Should I actually do this?

**Honestly, often NO.** Reasons to skip:

1. **The secret is already public** — anyone who wanted it copied it months ago
2. **Forks already cached the old history** — your cleanup doesn't reach them
3. **GitHub may keep the original SHAs accessible via direct URL** for some time
4. **Disruption to the team** is real

**Reasons to do it:**

- Compliance/audit requirement that bans secrets in any reachable commit
- You're about to make the repo public for the first time
- A specific high-value secret needs to be unreachable to lazy attackers

**For SOSphere right now:**
- Firebase key: ROTATE in console (Step 4 of `FIREBASE_KEY_ROTATION.md`). After deletion, the key in git history is dead. **Cleanup is optional cosmetic.**
- Twilio test keys: same — rotate in Twilio, history becomes harmless.

**My recommendation:** Do the rotation. Skip the history cleanup unless an external auditor demands it.

---

**Generated:** 2026-05-29 by SOSphere audit session
