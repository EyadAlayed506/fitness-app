# Hosting and iPhone build route — assessment for a group decision

Owner: Alzoman (with Nawaf for hosting/AI, Badr for iPhone/HealthKit). Status: **draft, BE-01**.
Researched November 5, 2026. Prices and free tiers change; re-check the linked pages before acting.
**Nothing here has been bought, deployed or signed up for.** Labels: *Confirmed* (primary source),
*Reported* (secondary source), *Inference* (my reasoning), *Untested* (needs a spike).

## 1. What the backend actually needs

From `README.md`, `app/config.py` and the model folders at commit `dfd5df0`:

| Part | Resource | Where it can run |
|---|---|---|
| FastAPI + SQLite | Small (well under 1 GB RAM for 5–7 users — *inference*) | Anywhere |
| Machine classifier (MobileNet ONNX, ~12 MB) | CPU | Anywhere |
| Photo matching (CLIP ViT-B/32 ONNX, 351 MB download) | CPU, ~50 ms/photo on a 4-core laptop (README measurement) | Anywhere with ~1 GB spare RAM |
| Voice (faster-whisper `small`, ~500 MB) | CPU | Anywhere with ~1–2 GB spare RAM |
| Coach + vision via Ollama (`qwen3:8b` ~5 GB, `qwen3-vl:8b` ~6 GB) | README sizes them for a 12 GB GPU | A teammate PC with a GPU. CPU-only on a small cloud VM will be slow (*inference*) |
| Coach via Claude (optional, paid) | Network only | Anywhere; needs a group cost decision |
| Persistent data | `fitness.db` + `data/photos/` + `models/` | Must survive restarts and be backed up |

**Consequence:** free PaaS tiers with ~512 MB RAM and no persistent disk cannot run this backend as it is.
The realistic free choices are a team-owned PC or a free VM.

## 2. Hosting options (5–7 users, Nov 8–14)

| | A. Team PC + Tailscale Funnel | B. Oracle Cloud Always Free VM | C. Paid small VPS |
|---|---|---|---|
| Cost | $0 | $0 (card required at sign-up — *reported*) | Not proposed |
| Public HTTPS URL | Stable `https://<machine>.<tailnet>.ts.net`, no domain needed (*confirmed*, Tailscale docs) | Public IP; HTTPS still needs a tunnel or domain | — |
| Ollama coach | Yes, on the PC's GPU | CPU-only → slow; pair with Claude (paid) or tunnel to a PC | — |
| Availability | Only while that PC is on, awake and online | 24/7 if capacity is obtained | — |
| Data location | Team hardware | Oracle region | — |
| Main risks | PC sleep/reboot/Windows updates; Funnel bandwidth limits are unpublished (*confirmed*); single machine = single point of failure | ARM capacity often unavailable (*reported*); **free allowance is disputed**: Oracle's page has been quoted as 4 OCPU/24 GB, while several 2026 reports say it was cut to 2 OCPU/12 GB in June 2026 — check the console before relying on it | — |

Cloudflare Tunnel is also free, but a stable hostname needs a domain on Cloudflare DNS; the no-account
"quick tunnel" URL changes every restart, which breaks a URL baked into the app build (*confirmed* by
Cloudflare-tunnel guides; see sources).

**Recommendation: A for the pilot**, on whichever teammate PC has a ≥12 GB GPU and can stay on
Nov 8–14 (who has that PC is **unknown — needs an answer**). Reasons: free, no new cloud account,
keeps the existing Ollama path working, data stays on team hardware, smallest change. Mitigations:
disable sleep, pause Windows Update for the week, run the backend as a service that restarts on boot,
nightly backup (§4). Keep B as the fallback if no PC can stay on.

Coach provider: keep **Ollama as the default** (free). Claude remains optional behind
`ASSISTANT_DAILY_LIMIT`. If the group wants Claude for quality, Nawaf should bring a measured cost per
question; the README's "a few US cents" × e.g. 10 questions × 7 testers × 7 days ≈ 490 questions is
roughly $10–25 for the week (*inference from the README figure, not a quote*).

WHOOP: its redirect URL must exactly match the hosted URL
(`https://<host>/api/whoop/callback`) and be updated in the WHOOP developer dashboard — Badr.

## 3. iPhone build route (no Mac, no paid Apple membership)

Facts (as of the Oct 25 baseline check and today's search):
- HealthKit is available to free Apple developer accounts; free "Personal Team" signing gives short-lived
  provisioning, not TestFlight (*confirmed*, Apple pages cited in the baseline).
- EAS cloud builds for a physical iPhone need paid Apple signing credentials (*confirmed*, baseline).
  The EAS Free plan includes up to 15 iOS and 15 Android builds a month on a low-priority queue
  (*reported*, several 2026 pricing summaries; expo.dev/pricing).
- Apple Developer Program: USD 99/year (*confirmed*, baseline).
- GitHub-hosted **macOS runners are free and unlimited for public repositories** (*confirmed*, GitHub docs).
  `EyadAlayed506/fitness-app` is public.
- Windows tools (Sideloadly, AltStore) can sign and install an `.ipa` with a free Apple ID; apps expire
  after 7 days, a free account allows 3 active sideloaded apps and 3 devices, and 10 App IDs per 7 days
  (*reported*, tool docs and guides).

| Route | Cost | Effort / time | Risks |
|---|---|---|---|
| 1. Borrow a Mac + Xcode + free Apple ID | $0 | Needs the Mac again every 7 days | Depends on finding a Mac |
| 2. Apple Developer Program + EAS internal (ad hoc) build | $99/yr + $0 EAS free tier | Enrollment must complete first; then `eas build -p ios --profile preview`, register each tester's iPhone | Enrollment approval time is unknown for Nov 8; costs money → group decision |
| 3. **No-Mac spike:** GitHub Actions macOS runner builds an **unsigned** release `.ipa` (`expo prebuild` + `xcodebuild … CODE_SIGNING_ALLOWED=NO`), then Sideloadly/AltStore on Windows signs it with a free Apple ID | $0 | ~half a day to try | *Untested.* Not an Apple-documented flow; third-party tool asks for Apple ID credentials (use a separate, dedicated Apple ID, never a personal one); 7-day expiry; whether the HealthKit entitlement survives free re-signing is unknown until tried on the iPhone |

**Recommendation (time-boxed, given today is Nov 5):**
1. Today: run route 3 as a spike (I can write the workflow; it needs no secrets). Success criterion: the app
   installs on the team iPhone, signs in to the hosted API, and — once Badr's HealthKit code exists — reads steps/sleep.
2. Today, in parallel: Nawaf asks the group to pre-approve route 2 ($99) **only as a fallback**, decided by Nov 6 evening.
3. If neither works by Nov 7: the Nov 8 candidate ships Android + iPhone-pending, with Apple Health listed as a
   visible known issue and a dated decision record. Do not silently drop it or claim a simulator test replaces it.

**Blocker you may be overlooking:** a build route alone does not deliver Apple Health. At `dfd5df0` there is no
HealthKit library or entitlement in `mobile/app.json`, and the app has only Android Health Connect sleep code.
Badr needs to confirm the HealthKit integration status today.

## 4. Backup and restore (minimum for the pilot; detailed in BE-03)

- What: `fitness.db` and `data/photos/` (and `.env`, stored separately and privately).
- When: nightly and before every backend upgrade.
- How (SQLite, safe while running): `sqlite3 fitness.db ".backup backups/fitness-YYYYMMDD.db"`, then copy `data/photos/`.
- Restore rehearsal before Nov 8: restore into a fresh folder, start the backend, log in as two test accounts and check their records.

## Sources

- [GitHub — Actions billing (free for standard runners on public repos)](https://docs.github.com/actions/learn-github-actions/usage-limits-billing-and-administration)
- [GitHub — Hosted runners (macOS labels; free and unlimited on public repos)](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [Tailscale — Funnel (ts.net names, ports 443/8443/10000, bandwidth limits)](https://tailscale.com/kb/1223/tailscale-funnel)
- [Oracle — Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm) and a report of the June 2026 reduction: [terminalbytes.com](https://terminalbytes.com/oracle-cloud-free-tier-changes-2026)
- [Expo — Pricing](https://expo.dev/pricing) and [usage-based pricing](https://docs.expo.dev/billing/usage-based-pricing.md)
- [Sideloadly FAQ (7-day free signing; App ID limit)](https://sideloadly.io/faq)
- [Cloudflare Tunnel guide (free; domain on Cloudflare DNS needed for a named tunnel)](https://flaviocopes.com/cloudflare-tunnel.md)
- Apple pages already cited in the Oct 25 baseline: supported capabilities, developer account basics, program enrollment.
