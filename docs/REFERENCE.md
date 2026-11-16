# Who's With Pop

Family sign-up for day coverage watching Pop (9 AM to 9 PM). Memo has overnight. Live at `pop.miguelloza.com`.

## Stack (Luis' stack)
- Static `index.html` + `styles.css` + `app.js`, no build. GitHub Pages from `main`, `CNAME` = `pop.miguelloza.com`.
- DNS: `~/.claude/scripts/cf-dns.sh add CNAME pop groundworkhq.github.io` (overrides the Vercel wildcard).
- Backend: Supabase Edge Function `pop-shifts` on internal-prod (`kdgbivcufoarmvckworj`), `verify_jwt: false`, does its own auth.
- Table `public.pop_shifts`, scoping column `household_id` (`'pop'`). RLS on, no policies, anon/authenticated revoked. Service role only, via the function.

## Caregiver Hours (Martha)
- Tables `pop_helpers` (name, hourly_rate) and `pop_hours` (helper_id, work_date, start/end, minutes, note, paid). Same lockdown as `pop_shifts`. Martha is seeded by the migration.
- Whole section is behind the family code, including reads (`hours_list` is a POST with the code). Viewers without the code see only an unlock box.
- End time earlier than start = overnight; `minutes` is computed server-side.
- "Mark Week Paid" flips `paid` on every entry for that helper in the visible Mon to Sun week. Owed = unpaid minutes x rate.
- "+ Add Caregiver" adds a caregiver (name, optional rate; names unique per household). "Remove Caregiver" only shows, and the function only allows it, when that caregiver has no hours ever logged.
- Front end lives in `hours.js`, which uses `window.PopBoard` exported by `app.js`.

## Access
- Anyone with the link can view. Add, edit and delete need the family code (`x-family-code` header).
- Code lives only in the Edge Function secret `POP_FAMILY_CODE`. Compared case-insensitively. Change it by updating that secret; phones that saved the old code get prompted again.
- The site remembers the code per phone in localStorage. "Sign out of editing on this phone" clears it.

## Local preview
`python3 -m http.server 8787` then open `http://localhost:8787/?mock`. Mock mode keeps data in memory; mock code is `pop`.

## Gotchas
- No `[hidden]` reset from a host page: `styles.css` carries `[hidden]{display:none!important}` or the form sheet shows on load.
- CORS allowlist is in the function (`pop.miguelloza.com`, `localhost:8787`). Add origins there if the domain changes.
